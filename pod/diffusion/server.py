"""Nex image service: one open diffusion model behind a small, key-locked HTTP API.

Runs on the Nex pod next to the vLLM brain (default port 8001). The site and agents never call
this directly: lib/imageGen.js does, through the pod's proxy URL, with the pod key.

UNTESTED on a GPU. Check the diffusers pipeline class and call arguments against the model
card on first start (see docs/pod/IMAGES.md).

Env:
  NEX_POD_KEY        required. Bearer key for POST requests (same secret as the brain).
  IMAGE_MODEL_DIR    model folder on the volume (default /workspace/models/z-image-turbo).
  IMAGE_PORT         default 8001.
  IMAGE_STEPS        default steps (default 8, the Turbo setting).
"""
import base64
import hmac
import io
import os
import random
import threading

import torch
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from PIL import Image

MODEL_DIR = os.environ.get("IMAGE_MODEL_DIR", "/workspace/models/z-image-turbo")
POD_KEY = os.environ.get("NEX_POD_KEY", "")
DEFAULT_STEPS = int(os.environ.get("IMAGE_STEPS", "8"))
# The image library accepts a data URI up to 140000 characters. Base64 adds a third,
# so keep the raw file under 100000 bytes.
MAX_RAW_BYTES = 100_000

app = FastAPI(title="Nex image service")
_pipe = None
_lock = threading.Lock()  # one picture at a time: diffusion uses the whole GPU share


def load_pipeline():
    global _pipe
    if _pipe is None:
        from diffusers import ZImagePipeline  # check the class name on the model card

        _pipe = ZImagePipeline.from_pretrained(MODEL_DIR, torch_dtype=torch.bfloat16).to("cuda")
    return _pipe


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=1000)
    width: int = Field(default=1024, ge=256, le=1024, multiple_of=16)
    height: int = Field(default=1024, ge=256, le=1024, multiple_of=16)
    steps: int | None = Field(default=None, ge=1, le=50)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)


def require_key(authorization: str | None):
    if not POD_KEY:
        raise HTTPException(503, "image service has no key configured")
    expected = f"Bearer {POD_KEY}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(401, "unauthorized")


def encode_small_webp(image: Image.Image) -> bytes:
    """Smallest-effort WebP under the size ceiling: lower quality first, then shrink."""
    work = image.convert("RGB")
    for _ in range(4):
        for quality in (90, 82, 74, 66, 58, 50, 42):
            buf = io.BytesIO()
            work.save(buf, format="WEBP", quality=quality, method=6)
            if buf.tell() <= MAX_RAW_BYTES:
                return buf.getvalue()
        work = work.resize((int(work.width * 0.85) // 16 * 16 or 16, int(work.height * 0.85) // 16 * 16 or 16))
    raise HTTPException(500, "could not make the picture small enough")


@app.get("/health")
def health():
    # Open on purpose (like vLLM's /health): reports only whether the service is up.
    return {"ok": True, "model_dir": os.path.basename(MODEL_DIR), "loaded": _pipe is not None}


@app.post("/v1/images/generate")
def generate(req: GenerateRequest, authorization: str | None = Header(default=None)):
    require_key(authorization)
    seed = req.seed if req.seed is not None else random.randint(0, 2**31 - 1)
    with _lock:
        pipe = load_pipeline()
        generator = torch.Generator("cuda").manual_seed(seed)
        result = pipe(
            prompt=req.prompt,
            width=req.width,
            height=req.height,
            num_inference_steps=req.steps or DEFAULT_STEPS,
            guidance_scale=0.0,  # Turbo is distilled and runs without guidance
            generator=generator,
        )
    raw = encode_small_webp(result.images[0])
    # Report the real size: encode_small_webp may have shrunk it to fit the ceiling.
    out = Image.open(io.BytesIO(raw))
    return {
        "data_uri": "data:image/webp;base64," + base64.b64encode(raw).decode("ascii"),
        "width": out.width,
        "height": out.height,
        "seed": seed,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("IMAGE_PORT", "8001")))
