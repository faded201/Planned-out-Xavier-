from pathlib import Path
from huggingface_hub import snapshot_download

model_dir = Path.home() / "CosyVoice" / "pretrained_models" / "Fun-CosyVoice3-0.5B"
model_dir.mkdir(parents=True, exist_ok=True)

snapshot_download(
    repo_id="FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
    local_dir=str(model_dir),
    allow_patterns=[
        "llm.pt",
        "flow.pt",
        "hift.pt",
        "speech_tokenizer_v3.onnx",
        "campplus.onnx",
        "cosyvoice3.yaml",
        "config.json",
        "configuration.json",
        "spk2info.pt",
        "CosyVoice-BlankEN/*",
    ],
)

print(f"CosyVoice 3 inference model ready: {model_dir}")
