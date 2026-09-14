# Guarded browser photo preview

The website's **Try online** link, the hero link and the home banner open
`/free-upscale/` (`/<locale>/free-upscale/` on localized pages; the old
`/upscale/` redirects). `build/build.py` renders the page with the site's head,
theme, navigation and footer, and localizes it from `localization/tool.json`.
The tool's runtime messages travel as one JSON table in `#tool-strings`; workers
post message keys and `src/tool/i18n.js` words them, with durations pluralized by
`Intl`. This preview runs the existing Regular 2× and 4× models on JPEG, PNG and
still WebP photos, entirely on the visitor's device. It exports JPEG;
transparency is flattened onto white. Video, animated images and HEIC are
referred to the existing iPhone/iPad app.

The flow handles one photo at a time: choose, check, upscale, then compare.
The card keeps one layout throughout: the drop zone shows the chosen photo and
still accepts a replacement (dropped or picked), and the 2×/4× switch and the
face option stay below it, so changing either re-checks the same photo. The
finished state adds the website's before/after divider under the card, with a
download action and an option to start over. The divider
supports dragging and Arrow Left/Right, Home and End. It resets to the middle
for every new photo. The before side uses the original file, not its thumbnail;
both sides show the entire image at the same aspect ratio. Original-file decoding
for the comparison happens only after the processing Worker has finished.

## Capability guard

The guard combines required browser features, file dimensions, conservative
memory estimates and a real inference/encoding probe. WebGPU is attempted when
an adapter is available; a failure during preparation retries CPU in a fresh
Worker. A missing GPU alone does not reject the device. A network failure is
reported as a download problem, not as an incapable device.

Files are inspected before full decoding. Current admission ceilings are:

| Device signal | Input ceiling | Output side ceiling |
| --- | ---: | ---: |
| Phone or tablet, RAM unknown or over 4 GB | 8 MP | 8192 px |
| Browser reports at most 4 GB RAM | 4 MP | 8192 px mobile / 16384 px desktop |
| Other desktop browsers | 20 MP | 16384 px |

All inputs also have a 50 MiB file cap and an estimated peak-memory budget, so
some very wide images or images near these ceilings are rejected earlier. RAM
signals are hints, not measurements of available memory. Passing the probe
cannot guarantee that a browser will not run out of memory or be closed by the
OS. A normal 12 MP iPhone camera photo intentionally reaches the app fallback
in this first preview. No automatic shrinking or lower-quality model substitution
is performed.

After the probe, the user sees a time estimate and explicitly starts processing.
Estimates over a minute warn about the duration before the Upscale button. Cancel
terminates the Worker, including an in-progress inference. Failed GPU processing
offers a CPU retry; stalled tasks time out. A timestamp in local storage allows
an interruption hint on the next visit; no image or filename is stored there.

The Worker keeps the full decoded input and output canvas, but only two row
bands for stitching, avoiding the lab's additional full output pixel array.
Model memory is released before JPEG encoding. The UI receives only a thumbnail
until the finished JPEG is ready. Model and runtime downloads are versioned and
cacheable. There is no photo upload endpoint or background processing service.

## Build and preview

Use Node 22.12+ and Python 3.12. Run `npm ci`. Restore the approved
`static/models/normal_2x_web.onnx` and `normal_2x_web.ort` artifacts, or regenerate
them with `scripts/prepare_web_models.py` as described in
[BROWSER_IMAGE_PROCESSING.md](BROWSER_IMAGE_PROCESSING.md). These model files
remain outside Git.

- `npm run build:preview` creates `.preview-dist` for Cloudflare Pages.
- `npm run preview:tool` serves it at `http://127.0.0.1:4175/free-upscale/`.
  The `free-upscale` entry in `.claude/launch.json` builds and serves in one step.
- `npm run test:tool` verifies header guards, device policy, and pixel-exact
  stitching against the original tiler, including overlap and edge cases.
- `python3.12 -m unittest discover -s tests` runs the existing site tests.
- `npm run build` also builds the separate engineering lab into `dist`.

The Python-only site build still works without model artifacts. It only renders
the tool page, its navigation/hero links and the home banner when the Vite
manifest from `npm run build:tool` exists. The page stays `noindex` and out of
the sitemap while the tool is a preview.

## Cloudflare deployment

This is a separate direct-upload Pages project, `uscale-photo-preview`, with
`main` as its production branch. Deploy `browser-photo-guard-preview` as a
preview branch. Publish **`.preview-dist`**, not `dist`: packaging excludes the
engineering lab, benchmark fixtures and experimental/face models, validates the
25 MiB per-file limit, and applies `noindex` to the entire preview. It does not
change the production domain or its DNS. Preview URLs are public; noindex is
not access control. Account credentials are not committed.

Both the page and its Worker scripts need `Cross-Origin-Embedder-Policy:
require-corp`; the page also has `Cross-Origin-Opener-Policy: same-origin`.
Without the Worker response header, Chromium can refuse to start the Worker.
The `_headers` file must accompany every Pages deployment.

With Wrangler authenticated to the intended account, redeploy using:

```sh
npx wrangler pages deploy .preview-dist --project-name uscale-photo-preview --branch browser-photo-guard-preview
```

## Validation and release limits

The local Chromium check completed a real 840×560 photo through GPU inference,
12-tile assembly, JPEG encoding and a decoded 1680×1120 result. Oversized and
unsupported files reached the app fallback, and cancelling an active job stopped
it immediately. The generated JPEG link is present; the embedded browser's
automated download-event wait did not report a download, so verify saving to
Files/Photos in the target device browser. A separate check of the same production Worker on CPU also completed the
1680×1120 JPEG (366,099 bytes) in approximately 54 seconds, including preparation.

The handover's iPhone measurements establish individual inference viability;
they do not establish full-size camera-photo reliability. Before raising mobile
limits or adding video/face processing, test real iPhone and Android browsers
through selection, cold download, processing, export, backgrounding and repeat
runs. Time estimates and limits remain deliberately conservative.

## Lessons from SquishyFile

The comparison informed the separate Worker, CPU retry, lazy cached downloads,
and the emphasis on complete-file cost rather than API availability. SquishyFile
uses a much smaller FSRCNN-style model and also offers shader-based scaling, so
its speed is not evidence that our existing Regular 2× weights will perform the
same way. This preview keeps our model and verifies actual tile work.

References: [SquishyFile video upscaler](https://squishyfile.com/video-upscaler),
[Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/),
[ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html).
