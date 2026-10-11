import gc
import io
import logging
import os
import sys
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

PORT = int(os.getenv("XAVIER_TTS_PORT", "5173"))
REPO_ROOT = Path(os.getenv("COSYVOICE_REPO", str(Path.home() / "CosyVoice"))).resolve()
MODEL_DIR = Path(os.getenv("COSYVOICE_MODEL_DIR", str(REPO_ROOT / "pretrained_models" / "Fun-CosyVoice3-0.5B"))).resolve()
PROMPT_WAV = Path(os.getenv("XAVIER_COSYVOICE_PROMPT_WAV", str(REPO_ROOT / "asset" / "zero_shot_prompt.wav"))).resolve()
DEFAULT_STYLE = os.getenv(
    "XAVIER_COSYVOICE_STYLE",
    "You are Xavier, an intelligent personal AI assistant. Speak in a deep, calm, warm, confident, natural conversational voice with measured pacing, clear pauses between ideas, gentle warmth, subtle emotional expression, and a slightly mysterious intelligent presence. Never shout, overact, or sound like a radio announcer.<|endofprompt|>",
).strip()

for required in (REPO_ROOT, MODEL_DIR, PROMPT_WAV):
    if not required.exists():
        raise SystemExit(f"Required CosyVoice path not found: {required}")

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "third_party" / "Matcha-TTS"))

from functools import partial
from hyperpyyaml import load_hyperpyyaml
from matcha.utils.audio import mel_spectrogram
from transformers import Qwen2Config, Qwen2ForCausalLM
from cosyvoice.cli.frontend import CosyVoiceFrontEnd
from cosyvoice.cli.model import CosyVoice3Model
from cosyvoice.llm.llm import Qwen2Encoder
from cosyvoice.tokenizer.tokenizer import get_qwen_tokenizer


def _load_state_mmap(module: torch.nn.Module, checkpoint: str, strip_generator: bool = False) -> None:
    state = torch.load(checkpoint, map_location="cpu", weights_only=True, mmap=True)
    if strip_generator:
        state = {key.replace("generator.", ""): value for key, value in state.items()}
    module.load_state_dict(state, strict=True, assign=True)
    module.eval()
    del state
    gc.collect()


def _xavier_low_memory_load(self, llm_model: str, flow_model: str, hift_model: str) -> None:
    _load_state_mmap(self.llm, llm_model)
    _load_state_mmap(self.flow, flow_model)
    _load_state_mmap(self.hift, hift_model, strip_generator=True)


CosyVoice3Model.load = _xavier_low_memory_load


def _qwen_skeleton_init(self, pretrain_path: str) -> None:
    torch.nn.Module.__init__(self)
    config = Qwen2Config.from_pretrained(pretrain_path, local_files_only=True)
    self.model = Qwen2ForCausalLM(config)


Qwen2Encoder.__init__ = _qwen_skeleton_init


def _prepare_reference_frontend():
    tokenizer_factory = partial(
        get_qwen_tokenizer,
        token_path=str(MODEL_DIR / "CosyVoice-BlankEN"),
        skip_special_tokens=True,
        version="cosyvoice3",
    )
    feat_extractor = partial(
        mel_spectrogram,
        n_fft=1920,
        num_mels=80,
        sampling_rate=24000,
        hop_size=480,
        win_size=1920,
        fmin=0,
        fmax=None,
        center=False,
    )
    print("Preparing Xavier reference voice with CosyVoice ONNX encoders...")
    frontend = CosyVoiceFrontEnd(
        tokenizer_factory,
        feat_extractor,
        str(MODEL_DIR / "campplus.onnx"),
        str(MODEL_DIR / "speech_tokenizer_v3.onnx"),
        str(MODEL_DIR / "spk2info.pt"),
        "all",
    )
    speech_feat, speech_feat_len = frontend._extract_speech_feat(str(PROMPT_WAV))
    speech_token, speech_token_len = frontend._extract_speech_token(str(PROMPT_WAV))
    token_len = min(int(speech_feat.shape[1] / 2), speech_token.shape[1])
    speech_feat = speech_feat[:, : 2 * token_len]
    speech_feat_len[:] = 2 * token_len
    speech_token = speech_token[:, :token_len]
    speech_token_len[:] = token_len
    embedding = frontend._extract_spk_embedding(str(PROMPT_WAV))
    cached = {
        "flow_prompt_speech_token": speech_token,
        "flow_prompt_speech_token_len": speech_token_len,
        "prompt_speech_feat": speech_feat,
        "prompt_speech_feat_len": speech_feat_len,
        "llm_embedding": embedding,
        "flow_embedding": embedding,
    }
    frontend.speech_tokenizer_session = None
    frontend.campplus_session = None
    gc.collect()
    print("Reference voice cached; heavy ONNX sessions released.")
    return frontend, cached

def _load_inference_model():
    frontend, prompt_cache = _prepare_reference_frontend()
    config_path = Path(__file__).with_name("cosyvoice3-inference.yaml")
    previous_dtype = torch.get_default_dtype()
    init_module = torch.nn.init
    init_names = (
        "uniform_", "normal_", "constant_", "ones_", "zeros_",
        "xavier_uniform_", "xavier_normal_", "kaiming_uniform_", "kaiming_normal_",
        "trunc_normal_", "orthogonal_",
    )
    original_inits = {name: getattr(init_module, name) for name in init_names if hasattr(init_module, name)}

    def _skip_parameter_init(tensor, *args, **kwargs):
        return tensor

    print("Building inference-only CosyVoice 3 skeleton in FP16 without temporary weight initialization...")
    torch.set_default_dtype(torch.float16)
    for name in original_inits:
        setattr(init_module, name, _skip_parameter_init)
    try:
        from transformers.modeling_utils import no_init_weights
        with no_init_weights():
            with config_path.open("r", encoding="utf-8") as config_file:
                configs = load_hyperpyyaml(
                    config_file,
                    overrides={"qwen_pretrain_path": str(MODEL_DIR / "CosyVoice-BlankEN")},
                )
    finally:
        for name, function in original_inits.items():
            setattr(init_module, name, function)
        torch.set_default_dtype(previous_dtype)

    model = CosyVoice3Model(configs["llm"], configs["flow"], configs["hift"], False)
    print("Assigning memory-mapped FP32 CosyVoice 3 checkpoints...")
    model.load(
        str(MODEL_DIR / "llm.pt"),
        str(MODEL_DIR / "flow.pt"),
        str(MODEL_DIR / "hift.pt"),
    )
    del configs
    gc.collect()
    print("CosyVoice 3 inference model loaded.")
    return frontend, prompt_cache, model


FRONTEND, PROMPT_CACHE, COSY_MODEL = _load_inference_model()
SAMPLE_RATE = 24000
SYNTH_LOCK = threading.Lock()

app = FastAPI(title="Xavier CosyVoice 3", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    language: str = "en"
    speaker: str | None = None
    style: str | None = None
    speed: float = Field(default=1.0, ge=0.7, le=1.3)


def _style_prompt(style: str | None) -> str:
    prompt = (style or DEFAULT_STYLE).strip()
    if "<|endofprompt|>" not in prompt:
        prompt += "<|endofprompt|>"
    return prompt


def _build_model_input(text: str, style: str | None):
    text_token, text_token_len = FRONTEND._extract_text_token(text)
    prompt_text_token, prompt_text_token_len = FRONTEND._extract_text_token(_style_prompt(style))
    model_input = dict(PROMPT_CACHE)
    model_input.update(
        {
            "text": text_token,
            "text_len": text_token_len,
            "prompt_text": prompt_text_token,
            "prompt_text_len": prompt_text_token_len,
        }
    )
    return model_input


def _render_wav(payload: SynthesisRequest) -> bytes:
    pieces: list[torch.Tensor] = []
    segments = FRONTEND.text_normalize(payload.text.strip(), split=True, text_frontend=True)
    with SYNTH_LOCK, torch.inference_mode():
        for segment in segments:
            model_input = _build_model_input(segment, payload.style)
            for output in COSY_MODEL.tts(
                **model_input,
                stream=False,
                speed=float(payload.speed),
            ):
                pieces.append(output["tts_speech"].detach().cpu())

    if not pieces:
        raise RuntimeError("CosyVoice returned no audio")

    audio = torch.cat(pieces, dim=1).squeeze(0).numpy().astype(np.float32, copy=False)
    buffer = io.BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buffer.getvalue()

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "Fun-CosyVoice3-0.5B",
        "engine": "cosyvoice3",
        "device": "cpu",
        "sample_rate": SAMPLE_RATE,
        "prompt_wav": PROMPT_WAV.name,
    }


@app.get("/speakers")
def speakers():
    return {
        "mode": "reference_voice",
        "speaker": "xavier",
        "prompt_wav": PROMPT_WAV.name,
        "style": DEFAULT_STYLE,
    }


@app.post("/synthesize")
def synthesize(payload: SynthesisRequest):
    try:
        wav_bytes = _render_wav(payload)
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store", "X-Xavier-TTS-Engine": "cosyvoice3"},
        )
    except Exception as exc:
        logging.exception("CosyVoice 3 synthesis failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/synthesize-stream")
def synthesize_stream(payload: SynthesisRequest):
    return synthesize(payload)


if __name__ == "__main__":
    import uvicorn

    print("Xavier Planner - CosyVoice 3 local TTS server")
    print(f"Model: {MODEL_DIR}")
    print(f"Reference voice: {PROMPT_WAV}")
    print(f"Server: http://0.0.0.0:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
