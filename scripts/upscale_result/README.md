# Upscale result command

This computer-side command accepts an image URL, sends one whole image through the AuraLens Creative Upscale flow, publishes the before/after pair for 3 or 7 days, and prints the result-page URL.

It makes exactly one paid upscale request. It does not tile the image or fall back to another provider.

## Setup

Install the small command-only dependency set:

```sh
python3 -m pip install -r scripts/upscale_result/requirements.txt
```

Copy `.env.example` to `.env`. Set `UPSCALER_TOOL_API_KEY` to the same long random secret configured on the AuraLens server. The real `.env` file is ignored by Git and is never included in the website build.

## Run

```sh
python3 scripts/upscale_result/upscale_result.py \
  'https://example.com/photo.jpg' \
  --retention 7
```

Optional settings are `--creativity -2..2` and `--resolution 2k|4k|8k`. Set `AURALENS_API_BASE_URL` in `.env` or pass `--api-base-url` to use another server.

HTTP URLs are rejected by default. `--allow-http` exists only for local development.
