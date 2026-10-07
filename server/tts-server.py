#!/usr/bin/env python3
import logging
import os
from io import BytesIO

import numpy as np
import scipy.io.wavfile as wavfile
import torch
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from TTS.api import TTS
from trainer import io as trainer_io
import TTS.tts.models.xtts as xtts_module

# XTTS v2 is a large checkpoint. On low-memory Windows PCs, Coqui's default
# fsspec file-handle loader forces PyTorch to materialize the whole checkpoint
# in committed memory before copying it into the model. For local checkpoints,
# use PyTorch mmap loading so the checkpoint stays file-backed while parameters
# are copied into the model. Remote URLs keep Coqui's normal loader.
_ORIGINAL_LOAD_FSSPEC = trainer_io.load_fsspec


def _xavier_low_memory_load_fsspec(path, map_location=None, *, cache=True, **kwargs):
    from pathlib import Path

    local_path = Path(path)
    if local_path.exists():
        kwargs.pop("mmap", None)
        return torch.load(
            str(local_path),
            map_location=map_location,
            weights_only=trainer_io._WEIGHTS_ONLY,
            mmap=True,
            **kwargs,
        )
    return _ORIGINAL_LOAD_FSSPEC(path, map_location=map_location, cache=cache, **kwargs)


xtts_module.load_fsspec = _xavier_low_memory_load_fsspec

# Inference does not need to preserve the parameter objects created before the
# checkpoint is loaded. `assign=True` swaps the mmap-backed checkpoint tensors
# into the module instead of allocating and copying another full parameter set.
# This materially lowers peak committed memory on the 8 GB Surface.
_ORIGINAL_XTTS_LOAD_STATE_DICT = xtts_module.Xtts.load_state_dict


def _xavier_assign_state_dict(self, state_dict, strict=True, assign=False):
    return _ORIGINAL_XTTS_LOAD_STATE_DICT(self, state_dict, strict=strict, assign=True)


xtts_module.Xtts.load_state_dict = _xavier_assign_state_dict

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
PORT = int(os.getenv("XAVIER_TTS_PORT", "5173"))
DEFAULT_LANGUAGE = os.getenv("XAVIER_TTS_LANGUAGE", "en")
PREFERRED_SPEAKER = os.getenv("XAVIER_TTS_PRESET_SPEAKER", "Craig Gutsy")

app = Flask(__name__)
CORS(app)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Loading Coqui XTTS v2 on {DEVICE.upper()}...")
tts = TTS(MODEL_NAME).to(DEVICE)
AVAILABLE_SPEAKERS = list(tts.speakers or [])
OUTPUT_SAMPLE_RATE = int(getattr(tts.synthesizer, "output_sample_rate", 24000) or 24000)


def choose_speaker(requested: str | None) -> str | None:
    if not AVAILABLE_SPEAKERS:
        return None

    aliases = {
        "xavier_warm": PREFERRED_SPEAKER,
        "xavier_calm": PREFERRED_SPEAKER,
        "xavier_energetic": PREFERRED_SPEAKER,
        "xavier_default": PREFERRED_SPEAKER,
    }

    candidate = aliases.get(requested or "xavier_warm", requested or PREFERRED_SPEAKER)
    if candidate in AVAILABLE_SPEAKERS:
        return candidate
    if PREFERRED_SPEAKER in AVAILABLE_SPEAKERS:
        return PREFERRED_SPEAKER
    return AVAILABLE_SPEAKERS[0]


def synthesize_audio(text: str, language: str, speaker_name: str | None):
    kwargs = {
        "text": text,
        "language": language,
        "split_sentences": True,
    }
    if speaker_name:
        kwargs["speaker"] = speaker_name

    wav = tts.tts(**kwargs)
    wav = np.asarray(wav, dtype=np.float32)
    wav = np.clip(wav, -1.0, 1.0)
    return (wav * 32767).astype(np.int16)


def wav_response(wav_16: np.ndarray):
    wave_file = BytesIO()
    wavfile.write(wave_file, OUTPUT_SAMPLE_RATE, wav_16)
    wave_file.seek(0)
    return send_file(
        wave_file,
        mimetype="audio/wav",
        as_attachment=False,
        download_name="xavier_voice.wav",
        max_age=0,
    )


@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "model": "coqui-xtts-v2",
            "device": DEVICE,
            "sample_rate": OUTPUT_SAMPLE_RATE,
            "speaker_count": len(AVAILABLE_SPEAKERS),
        }
    )


@app.get("/speakers")
def speakers():
    return jsonify(
        {
            "default_alias": "xavier_warm",
            "preferred_preset": PREFERRED_SPEAKER,
            "speakers": AVAILABLE_SPEAKERS,
        }
    )


@app.post("/synthesize")
def synthesize():
    payload = request.get_json(silent=True) or {}
    text = (payload.get("text") or "").strip()
    language = (payload.get("language") or DEFAULT_LANGUAGE).strip()
    speaker_name = choose_speaker(payload.get("speaker"))

    if not text:
        return jsonify({"error": "No text provided"}), 400
    if len(text) > 4000:
        return jsonify({"error": "Text is too long; maximum is 4000 characters"}), 400

    try:
        wav_16 = synthesize_audio(text, language, speaker_name)
        return wav_response(wav_16)
    except Exception as exc:
        logging.exception("XTTS synthesis failed")
        return jsonify({"error": str(exc)}), 500


@app.post("/synthesize-stream")
def synthesize_stream():
    # Compatibility endpoint. XTTS generates the utterance first, then this endpoint
    # returns the WAV response. It is not true token-by-token low-latency streaming.
    return synthesize()


if __name__ == "__main__":
    print("\nXavier Planner - Coqui XTTS v2 local TTS server")
    print(f"Device: {DEVICE}")
    print(f"Server: http://0.0.0.0:{PORT}")
    print("Endpoints: /health, /speakers, /synthesize, /synthesize-stream")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=False)
