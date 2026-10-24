# Nex image service

One open image model on the pod, behind a key-locked HTTP service, and one tool agents use to call it. This is the "diffusion system" part of Nex's brain. Code-made ads and previews stay the main way Nexus makes visuals; this is for pictures that code cannot draw (photo-style backgrounds, product shots, textures).

## How a picture gets made

```
agent (Claude connector / Nex)
  -> generate_nexus_image   (owner only, lib/workspaceConnector.js action generate_image)
  -> lib/imageGen.js        finds the running pod, checks the service, sends the pod key
  -> pod/diffusion/server.py on port 8001 (Z-Image Turbo)
  -> small WebP (under 100KB) back as a data URI
  -> saved to the Ad Maker image library as ai_generated; the tool returns the image_id and seed
```

The agent then uses the `image_id` as a `photo_focus` scene's `imageId`, like any uploaded picture.

## Model choice

| Model | Size | License (per third-party summaries, check the model card) | Use |
|---|---|---|---|
| **Z-Image Turbo** | 6B | Apache 2.0 | First pick. 8 steps, no guidance, fits well under 16GB in Turbo form. |
| Z-Image (base) | 6B | Apache 2.0 | Use later for LoRA training: it is undistilled and meant for fine-tuning. |
| FLUX.2 [klein] 4B | 4B | Apache 2.0 | Alternative. |
| FLUX.2 [dev], Ideogram 4.0, Qwen-Image 2.1 | 32B / 9.3B / 7B | Non-commercial or needs a separate license | Do not use for customer work. |

Apache 2.0 covers the model code and weights. It does not clear the rights in prompts, brands, people or reference images, so keep prompts away from real brands and people.

## Setup on the pod (first time)

Not done yet and not tested. Do this with the pod running and the brain stopped or still up (the image part needs its own GPU share).

```bash
python -m venv /workspace/venv-image          # separate from the vLLM venv on purpose
/workspace/venv-image/bin/pip install torch diffusers transformers accelerate fastapi uvicorn pillow
# Z-Image may need a newer diffusers than the release on PyPI: check the model card.
source /workspace/venv/bin/activate
hf download Tongyi-MAI/Z-Image-Turbo --local-dir /workspace/models/z-image-turbo   # confirm the repo name
mkdir -p /workspace/brain/diffusion && cp pod/diffusion/server.py /workspace/brain/diffusion/
```

Then in `/workspace/brain/manifest.json` set `nex-main` `gpu_mem` to 0.70 (on an 80GB card), set `nex-image` `enabled` to `true`, and run `start.sh` as in `BRAIN.md`. The pod needs port 8001 exposed over HTTP next to 8000 (RunPod template settings), because `lib/imageGen.js` calls `https://<pod id>-8001.proxy.runpod.net`.

## First-start checks

1. `curl localhost:8001/health` answers `ok`.
2. A POST without the key returns 401; with the key it returns a `data_uri`.
3. The first request is slow (the model loads then). Later ones should take a few seconds.
4. Read `server.py`'s comments: the pipeline class name and the call arguments (`width`, `height`, `guidance_scale`) are from the model card summary and must be checked against the real card.

## The tool

`generate_nexus_image` (action `generate_image`): `prompt` (3-1000 characters), optional `name`, `description`, `width` and `height` (256-1024, steps of 16, default 1024), `steps` (1-50), `seed`.

- Owner only, and hidden from the customer MCP endpoint, because it spends pod time.
- If the pod or the image service is off it fails with `IMAGE_POD_OFFLINE`. It never starts a pod.
- Pictures should not contain words, logos or prices; image models spell badly. Ads put text on with scenes.

## Not built yet

- **Video.** Open options named in third-party summaries are Wan 2.2 (Apache 2.0) and LTX-2.5 (license not checked). Video needs a lot more GPU than images, so it should be a separate part and a separate decision.
- **A style LoRA** for the house look, trained on Z-Image base.
- **A critique step** where Qwen3.8-27B looks at the picture and asks for a remake.
- **Spend tracking** for image time. The pod is a flat hourly cost, so pictures are free per call but share the GPU with the brain.
