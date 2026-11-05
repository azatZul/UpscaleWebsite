# Photo 4×: Nomos evaluation and release gate

Dates: 2026-11-02–03. Evaluation history and model provenance. The subsequent
integration is described in [photo4x-integration.md](photo4x-integration.md).

## Decision

The user selected **C** in the blind primary-image review on 2026-11-02. The
separate reveal key maps C to **NomosWebPhoto RealPLKSR FP32, tile 256, overlap
16, no face enhancement**. This is an initial preference for that input, not a
final quality winner. On 2026-11-03 the user described the primary comparison as
ambiguous: Crisp can preserve better texture in places and invent excess detail
elsewhere. They rejected the original six tiny, degraded fixtures as
unrepresentative. Do not treat that corpus or the earlier C choice as approval
for general rollout. FP16 and overlaps 16/32 have passed numerical consistency
checks. The completed expanded review below supersedes that initial preference.

The user returned all 19 ratings on 2026-11-03. **NomosWebPhoto RealPLKSR FP16,
tile 256, overlap 32, GPU-only graph** is the quality winner: 14 outright
preferences, compared with two for ESRGAN and three explicit ties between the
two Nomos. SRVGG received no outright preference. This closes the quality-choice
stage. The subsequently approved integration uses local capability and timing
validation instead of requiring a pre-recorded physical-device allowlist.

The build now includes only the selected 15,021,513-byte graph, pinned by its
full SHA-256. Chrome/Edge desktop admission is enabled through local GPU checks,
inference and measured output-path costs. Safari has an independent disabled
gate because actual-Safari acceptance could not be completed. No deployment
was performed. Personal images, comparison artifacts and losing models remain
excluded from the deployment package. M1/8 GB and Windows remain physically
unmeasured; local validation, rather than an assumed hardware guarantee,
controls their admission.

The new path applies only to desktop Photo 4× on a compatible hardware WebGPU
configuration. A first-use warm-up and measured tiles precede the time decision;
a seven-day profile skips the separate warm-up on returning visits.
The budget is 300,000 ms for upscale and export, excluding model preparation and
face enhancement. The estimate is max(probes) × tile count × margin + measured
assembly/export overhead; margin starts at 1.25 and never decreases on calibration.
Missing overhead evidence triggers bounded local calibration. Saved measurements
match the device, exact output dimensions, format, alpha and face-base export.
A failure or rejected forecast restarts
the complete input with the current model in a new worker, never mixes tiles and
never runs Nomos on CPU. Cancellation does not start a fallback.

## License and provenance

Author: Philip Hofmann (Helaman). Exact upstream artifacts:

| Model | Original bytes | Original SHA-256 |
| --- | ---: | --- |
| ESRGAN FP32 opset17 | 67,003,044 | `e29f473727ee0e32416d3a2d2642568e0159e2608d67236193772fced8696121` |
| RealPLKSR FP32 opset17 | 29,805,849 | `146669e66cd3b22a4b97b0cf83f9bb2bcf20cd4ffd51fe76f91b95a4a8002df6` |

- [ESRGAN author release](https://github.com/Phhofm/models/releases/tag/4xNomosWebPhoto_esrgan)
  and [download list](https://github.com/Phhofm/models/releases/expanded_assets/4xNomosWebPhoto_esrgan).
- [RealPLKSR author release](https://github.com/Phhofm/models/releases/tag/4xNomosWebPhoto_RealPLKSR)
  and [download list](https://github.com/Phhofm/models/releases/expanded_assets/4xNomosWebPhoto_RealPLKSR).
- [Author's RealPLKSR model card](https://huggingface.co/Phips/4xNomosWebPhoto_RealPLKSR)
  explicitly identifies `cc-by-4.0`.
- [ESRGAN database entry](https://openmodeldb.info/models/4x-NomosWebPhoto-esrgan)
  identifies CC-BY-4.0 under Rights. The original GitHub descriptions instead say
  `License: CC-BY-0.4`. Treat this as an unresolved spelling discrepancy, not a
  new valid license version. Preserve explicit confirmation before distribution;
  no issue or message has been sent to the author by this experiment.
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits commercial
  use with attribution, a license link and identification of modifications.
  `/licenses/` lists the author, sources, claimed license and the local changes.
  It explicitly states that the candidates are not distributed or enabled.

For the selected **RealPLKSR**, the author's pinned Hugging Face card at `49d5da1`
explicitly declares `license: cc-by-4.0` and links the exact GitHub release. All
**340 floating-point parameter tensors**, including the **284 Conv weight/bias
inputs**, match the fixed official ONNX by their float32 values. The safetensors
SHA-256 is `9be0228f98156a100d6636d99b373ed2785b999723f9adc4cca504329ab157f2`;
the card SHA-256 is `75fdef20126c5feeb4519f7e849a07ee10ba16be397425bd99a394c1475ffccc`.
This directly connects the author's explicit CC BY 4.0 declaration to the
evaluated parameters, resolving the invalid version spelling for this candidate.
The ESRGAN discrepancy is not covered by that proof. `verify_photo4x_provenance.py`
reproduces the comparison without executing pickle files or contacting the author.

Local changes: ONNX simplification with fixed input shapes, constant folding and
shape inference, a numerically checked Softplus decomposition for WebGPU, plus
optional FP16 conversion with FP32 input/output and FP32 Softplus arithmetic.
No training.
The preparation recipe pins the original hashes, records package versions,
operator counts, tensor sizes, generated hashes and source-vs-fixed verification.
Fixed FP32 256×256 outputs matched their original dynamic graphs exactly on the
seeded verification input. This is a conversion check, not a quality metric.

[Crisp](https://crisp.photos/) identifies **4x-UltraSharpV2_Lite** by Kim2091.
The [author's weights](https://huggingface.co/Kim2091/UltraSharpV2) are
CC BY-NC-SA 4.0. This is a **publication gate**, not a finding that every free
browser tool is prohibited. NC concerns the primary purpose of the use, including
commercial advantage, rather than only whether a specific invocation is paid.
The site also offers paid cloud processing and promotes an app, so this scenario
needs clarification before UltraSharp publication; company ownership alone does
not establish a violation. See the [CC definition](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en)
and [NC guidance](https://creativecommons.org/faq/#does-my-use-violate-the-noncommercial-clause-of-the-licenses).
An author permission covering the free local feature within UScale could resolve
this gate. No author has been contacted. Local evaluation is retained.
The service was
not given access to the private photo by the test runner: the user declined
that action and later supplied their own 1864×2800 PNG, SHA-256
`171c2ac92c8fa1ce32835f9ce1dc73d221ca7ce2f60af16379d68fc0169d6301`.
They confirmed that separate face enhancement was not run. The file is a local
external reference, compared primarily with Nomos **without GFPGAN**.

Public JavaScript inspection on 2026-11-02 establishes the current local path:

- [Entrypoint](https://crisp.photos/assets/main-BvhUW6VR.js) selects
  `4x-UltraSharpV2_Lite`; the [worker](https://crisp.photos/assets/photo.worker-wIeXY2E-.js)
  requests `4x-UltraSharpV2_Lite_fp32_op17_webgpu.onnx`, declared 29,759,028 bytes,
  model-cache revision `v3`. It bundles ORT Web 1.27.0.
- Native-size browser Canvas RGB becomes NCHW float32 divided by 255. No input
  enlargement or face detector/restorer is present in the inspected local path.
- Tiles are at most 256×256, with **16 pixels total overlap**, stride 240, and
  variable-size edge tiles. Internal edges discard 8 input pixels from each
  side; there is no feather blending. This differs from our overlap 16
  **per side**, stride 224. The primary input uses 6 Crisp tiles versus 12 of
  our fixed tiles.
- WebGPU uses NCHW and graph optimization `all`; initialization/inference can
  fall back to WASM. Outputs are clamped, rounded to RGB8 and losslessly encoded
  as PNG; the UI restores alpha for transparent inputs. No separate sharpening
  stage was found after inference.

Public source URLs and hashes are saved locally in `crisp-audit.json`. This
removes the earlier broad uncertainty about preprocessing and face enhancement.
Static inspection of today's JS cannot establish the exact model bytes or
browser/backend used in the user's earlier run. No photo was sent during this
inspection. The local comparison is at `/photo4x/results/crisp-comparison/`.

## Reproduce locally

```sh
python3.11 -m venv .web-model-work/photo4x/venv
.web-model-work/photo4x/venv/bin/pip install -r scripts/photo4x-requirements.txt
.web-model-work/photo4x/venv/bin/python scripts/prepare_photo4x_models.py --fp16 --webgpu-softplus
.web-model-work/photo4x/venv/bin/python scripts/prepare_photo4x_inputs.py --photo /absolute/path/to/girls_blured.jpg
npm run build:lab
python3 build/build.py en
node scripts/serve_photo4x_lab.mjs
```

The server binds only `127.0.0.1:4189` and serves weights/private inputs only from
the ignored experiment directory. Set `USCALE_PLAYWRIGHT_MODULE` if Playwright
is supplied by the desktop runtime rather than installed in this checkout.
On this Mac headless Chromium returned no adapter; headed isolated Chromium
151 used hardware Apple/Metal WebGPU without enabling unsafe WebGPU flags.

```sh
node scripts/check_photo4x.mjs --headed --runs 5 --output fp32-five
node scripts/check_photo4x.mjs --headed --models nomos-esrgan --precision fp16 --runs 5 --output fp16-five
node scripts/check_photo4x.mjs --headed --models nomos-esrgan,nomos-realplksr --input girls-crop320.png --size 320 --reference --overlaps 16 --runs 1 --output references
node scripts/check_photo4x.mjs --headed --models nomos-esrgan,nomos-realplksr --input girls-crop320.png --runs 1 --output seams
node scripts/check_photo4x.mjs --headed --models nomos-esrgan,nomos-realplksr --profile --overlaps 32 --runs 1 --output profile
node scripts/check_photo4x.mjs --headed --models nomos-realplksr --precision fp16 --overlaps 32 --runs 5 --output gpu-fp16-five
node scripts/check_photo4x.mjs --headed --models nomos-realplksr --precision fp16 --large --input camera12mp.jpg --overlaps 32 --runs 3 --output large-gpu
node scripts/check_photo4x.mjs --headed --models current,nomos-esrgan,nomos-realplksr --precision fp16 --faces --overlaps 32 --runs 1 --output faces-final
node scripts/check_photo4x_recovery.mjs
python3 scripts/summarize_photo4x.py
```

Run GPU workloads sequentially. Profiling is a separate invocation and its
latencies must not enter timing comparisons. The runner retains completed cases
if a later model fails. A real adapter is required; a software substitute is not
accepted. New workers/sessions per run reflect the product lifecycle; HTTP model
cache may be warm after the first request. These loopback download times do not
measure public hosting/network latency. PNG files retain lossless quality for
small comparisons; large runs deliberately use the normal JPEG path.

For face tests, copy the existing pinned `static/models/face_512.onnx` into the
private `.web-model-work/photo4x/models/face_512.onnx`; the runner verifies its hash
and streams it through the loopback server. It does not republish GFPGAN.

The 12 MP fixture is a native 4032×3024 crop of the existing real photograph
`resources/before_after/film_negative_after.jpg`, not an enlarged small input.
Its crop rectangle and input hash are recorded in `inputs/inputs.json`. The six
additional corpus inputs are existing 256×256 fixtures, not a comprehensive
photographic dataset. Browser JS heap estimates exclude GPU/native memory;
reliable per-process VRAM is unavailable and must not be invented.

For seam consistency, compare fixed 320×320 single-frame references with the same
crop processed using tiles 256 and overlaps 16/32. `analyze_photo4x.py` records
PSNR, MAE, p99 and max errors for seam bands, non-seam interior and outer edges,
plus a difference map amplified 16×. These metrics do not measure fidelity to an
unknown high-resolution original. RealPLKSR contains InstanceNormalization, so
the full-frame reference can differ beyond the seams as tile statistics change.

The blind review generator copies anonymous A/B/C PNGs, 100% crops, fit-to-screen
controls and notes into a private review page, with a separate reveal key. A
human quality choice remains necessary; sharpness alone does not establish a win.
The face pass reuses one detection/enhancement result for both upscalers within
the same browser session. Look at hair, background and mask boundaries as well
as the GFPGAN-replaced facial regions.

Compare a manually obtained Crisp result without exposing the input to its site:

```sh
.web-model-work/photo4x/venv/bin/python scripts/analyze_photo4x.py \
  --comparison .web-model-work/photo4x/results/crisp-comparison \
  --images .web-model-work/photo4x/results/gpu-fp16-five/nomos-realplksr-256-fp16-o32.png \
    .web-model-work/photo4x/results/faces-final/nomos-realplksr-256-fp16-o32-faces.png \
    '/absolute/path/to/crisp-result.png' \
  --labels 'Nomos without GFPGAN' 'Nomos with GFPGAN' 'Crisp without face enhancement'
```

## WebGPU correction discovered during profiling

The upstream RealPLKSR graph falls back to CPU for 28 Softplus nodes per tile,
each processing large feature tensors. FP16 additionally inserts CPU casts. This
invalidates the upstream graph as a production candidate despite its valid output
and the user's quality preference. ESRGAN did not show CPU node events.

`--webgpu-softplus` replaces Softplus with the stable expression
`relu(x) + log(1 + exp(-abs(x)))`, using WebGPU-supported primitives. The first
experimental rewrite used Max and the strict GPU gate rejected it; Relu removes
that unsupported operator. The Softplus subgraph remains FP32 in the FP16 model
to preserve precision, while the other activations and weights use FP16.

The full FP32 graph matches the original seeded reference with maximum absolute
error `1.3709068298339844e-6`. On the primary saved PNG the optimized FP32 differs
from the original same-overlap output by at most 1/255 (PSNR 98.29 dB). Optimized
FP16 vs original FP32 has PSNR 55.75 dB, p99 error 1/255, max 11/255. These are
conversion-consistency checks, not measures of photographic truth.

The corrected FP16 graph passes with `session.disable_cpu_ep_fallback=1`; its
separate profile has 6,645 GPU node events and **zero CPU node events** across
five tile executions. The production preflight requires that strict-GPU flag.
The raw graph and the rejected intermediate rewrite are retained only as local
experimental records and must not be selected for release.

## Acceptance and follow-up

Before setting a winner: record the chosen weights/precision/overlap, the quality
review, all measurement reports, license confirmation, tested configuration
fingerprints and overhead buckets. The full report should link the final images,
not just averages. Upload an approved model to model hosting with content-addressed
URLs after those gates; the existing static package has a 25 MiB per-file limit.
ESRGAN FP16 still exceeds that limit. Do not copy experimental models into static
assets to work around hosting setup.

Run unit tests, production browser regression/recovery checks, and a full build.
Check Photo 2×, Drawing, mobile/iPad: no candidate download. Check PNG alpha,
JPEG large output headers, cancellation, model-specific failure keys, stale
worker messages, GPU loss, memory failure, budget rejection, missing download,
repeat processing and GFPGAN. M1/8 GB and Windows hardware acceptance follows
only after the M4 visual review; Safari/Linux remain disabled until verified.

## M4 Pro screening measurements

Hardware: Apple M4 Pro (14 CPU cores), 48 GiB unified memory. Browser: isolated
headed Chromium 151.0.7922.34 with the real Apple/Metal adapter, no unsafe GPU
flags. ORT Web 1.23.2 requested actual device buffer/storage-binding limits of
4,294,967,292 bytes; shader-f16 was available. These are device limits, not
measured free VRAM. ESRGAN 256 FP32 ran successfully, so the 128 memory fallback
was prepared but did not need a browser acceptance run here.

Median wall time for the primary 466×700 input, no GFPGAN, PNG output, five fresh
worker/session runs per case:

| Variant | Overlap per side | Wall time |
| --- | ---: | ---: |
| Existing SRVGG FP32 | 16 | 4.52 s |
| Nomos ESRGAN FP32 | 16 / 32 | 14.70 / 14.97 s |
| Nomos ESRGAN FP16 | 16 / 32 | 10.76 / 10.91 s |
| Upstream Nomos RealPLKSR FP32, CPU Softplus fallback | 16 / 32 | 52.43 / 53.62 s |
| Upstream Nomos RealPLKSR FP16, CPU fallback | 32 | 52.35 s |
| Corrected GPU-only RealPLKSR FP32 | 32 | 11.00 s |
| Corrected GPU-only RealPLKSR FP16 | 32 | 10.18 s |

For corrected FP16 overlap 32, median upscale/export time excluding preparation
and warm-up was 9.08 s. The saved graph is 15,021,513 bytes, versus 29,688,494
bytes for corrected FP32. FP16 is useful mainly for download size here; its
speed improvement over corrected FP32 is modest. The three recorded probes
include input sampling, inference, readback and RGB conversion.

For the real 4032×3024 fixture, output 16128×12096 (195,084,288 pixels), the normal
JPEG path succeeded and its encoded dimensions were verified:

| Variant | Runs | Wall time, min / median / max |
| --- | ---: | ---: |
| Current SRVGG, 252 tiles | 3 | 76.97 / 78.94 / 82.77 s |
| Corrected RealPLKSR FP16, overlap 32, 336 tiles | 3 | 258.99 / 261.14 / 261.35 s |

Actual corrected-model upscale/export was 257.79–260.05 s. The max-probe estimate
with margin 1.25 and worst observed assembly/composite/export overhead is roughly
336–352 s. Therefore this particular 12 MP input is **rejected by the automatic
five-minute admission**, even though all three laboratory runs finished within
five minutes. The 1.25 margin need not be increased for these observations and
must not be lowered merely to admit the image. Measured assembly was 3.04–3.21 s
and final JPEG encoding 1.01–1.05 s. The losing ESRGAN's large-image runs were not
continued after the human quality choice; do not imply equivalent coverage.

Raw browser reports and lossless primary PNGs are retained in the ignored local
experiment directory. `benchmarks/browser/photo4x-m4-screening.json` records the
measurement summaries, report/artifact hashes, host, runtime, model revisions,
input hashes, failures and measurement limitations. Regenerate it with
`python3 scripts/summarize_photo4x.py`. HTTP cache may be warm after the first
case; loopback timings do not establish public cold-download performance.

## Expanded quality corpus, 2026-11-03

The six old 256×256 degraded fixtures remain diagnostic records only. The user
explicitly rejected them as a basis for choosing a general photo model.

The replacement has **19 cases and 57 PNG model outputs**, all without GFPGAN:

- Three unmodified user inputs: girls 466×700, parrot 494×740, Eiffel Tower
  982×1228. Their source/input hashes are recorded privately; there is no known
  high-resolution ground truth. The supplied parrot WebP is an external result,
  not the input: 1976×2960, exactly the target size. Its service is unconfirmed.
  The supplied girls PNG is the user's Crisp output without separate face work.
- Twelve licensed web photographs: skin/hair, eyes/fabric, beard, cat fur,
  bird feathers, a market, forest/water, a mountain lake, night signage, night
  stone architecture, a smartphone cafe photo and daytime architecture.
  Originals are from Wikimedia Commons; individual source URLs, authors,
  licenses, SHA-1/SHA-256 and color conversion are in the screening JSON.
- Each reference is oriented, converted to sRGB when an ICC profile is present,
  resized to at most 2048 on the long side with dimensions divisible by four,
  then downscaled by four with bicubic filtering. No artificial noise/scratches.
  Four additional cases apply mild Gaussian blur (sigma 0.45 LR pixels) followed
  by JPEG85 4:2:0 and lossless PNG storage. This does not simulate every real
  camera degradation and is not a statistically representative held-out set.

```sh
.web-model-work/photo4x/venv/bin/python scripts/prepare_photo4x_inputs.py \
  --photo /absolute/path/girls_blured.jpg \
  --parrot /absolute/path/parrot.png --eiffel /absolute/path/eiffel_bw.png \
  --parrot-result '/absolute/path/parrot-result.webp' \
  --crisp-result '/absolute/path/crisp-result.png'
.web-model-work/photo4x/venv/bin/python scripts/prepare_photo4x_web_corpus.py
node scripts/check_photo4x_corpus.mjs
.web-model-work/photo4x/venv/bin/python scripts/review_photo4x_corpus.py
python3 scripts/summarize_photo4x.py
```

The local page `/photo4x/results/review-web/` has separate real/clean/mild groups,
anonymous A/B/C mappings per image, synchronized 100% scrolling, a detail jump,
optional HR/external comparisons, per-case ratings and explicit model reveal.
Credits, source/license links and modifications accompany each web photograph;
derived images retain the source license. Private images and originals are not
included in the production package. The browser QA confirmed all 19 entries,
3/12/4 group counts, synchronized pan, correct attribution and no external page
requests. Re-running the review generator preserves the deterministic mappings.

Paired RGB PSNR has 16 valid controlled cases: current SRVGG is highest on nine,
RealPLKSR on seven, ESRGAN on none. Median across these heterogeneous cases is
24.98 / 24.50 / 23.96 dB respectively. These values measure pixel fidelity to
the controlled reference, favor smoother estimates in some cases, and do not
decide visual quality. User photos and third-party outputs are excluded from
that calculation. No final human acceptance is inferred from the metrics.

Visual inspection at 100% shows that Nomos preserves/reconstructs more hair,
fur and masonry texture; fine glyphs can still turn into incorrect strokes.
Blur/JPEG cases make the trade-off more pronounced. Before the completed user
review, this supported keeping the current default pending human preference.
RealPLKSR FP16, tile 256, overlap 32 was the technical candidate for further review
(smaller weights/intermediates and established license provenance), not an
enabled release. Overlap 16 remains available and matches the earlier selected
C within PSNR 55.77 dB, p99 error 1/255 after the GPU/FP16 conversion. The
final FP16 seam-reference PSNR is 39.35 vs 42.64 dB in seam bands at overlap
16 vs 32; InstanceNormalization also changes the non-seam regions.

## Completed user quality review, 2026-11-03

Imported `photo4x-diverse-review.json` with `scripts/import_photo4x_review.py`.
The importer checked the exact corpus protocol, all 19 case IDs and every choice
against the saved per-case blind key. The source export is preserved privately;
its hash, key hash, per-case mappings, exact notes and resolved preferences are
recorded in `benchmarks/browser/photo4x-quality-review.json`.

| Group | RealPLKSR preferences | ESRGAN preferences | Ties between the Nomos |
| --- | ---: | ---: | ---: |
| User inputs (3) | 1 | 2 | 0 |
| Clean downscale (12) | 10 | 0 | 2 |
| Mild blur/JPEG (4) | 3 | 0 | 1 |
| Total (19) | **14** | **2** | **3** |

The notes explicitly identify the tied pairs (B/C, A/C, A/C), which all resolve
to the two Nomos. They are not ties involving all three models and are not
counted as fractional wins. This is one person's subjective review; the four
degraded variants share sources with the clean cases and are not independent
additional photographs. Crisp/external outputs were visible references, not
selectable A/B/C candidates, so these ratings do not establish a win over Crisp.

Real-input exceptions matter: ESRGAN was preferred for Eiffel (better detail,
fewer artifacts) and girls (slightly fewer artifacts, with RealPLKSR also rated
highly); RealPLKSR was preferred for parrot (slightly more natural than ESRGAN).
On the wider corpus the repeated preference is for RealPLKSR's natural detail
and fewer artifacts/overemphasized bokeh. This provides the previously missing
human basis to select **RealPLKSR FP16, 256, overlap 32** as the single candidate.
ESRGAN remains a comparison, rather than a second production download.

```sh
python3 scripts/import_photo4x_review.py \
  --review /absolute/path/photo4x-diverse-review.json
python3 scripts/summarize_photo4x.py
```

The existing M4 measurements still govern time admission: the 12 MP fixture's
post-preparation laboratory time is under five minutes, but its conservative
336–352 s prediction exceeds the budget and selects SRVGG. A quality win does
not justify relaxing that threshold. The integration now applies that budget
using locally measured costs and a persistent profile; see the integration
report for the completed automatic path.

## Completed validation and remaining gates

- Node tool tests: 108 passed. Model-conversion Python checks: 2 passed.
  Localization checks: 27 passed. Full production build and package validation
  passed (346 files, 130.7 MiB). No deployment was performed.
- Browser model recovery: 13 cases passed, including download/hash/requirement
  failure, five-minute forecast rejection, missing evidence, mobile/CPU/drawing/
  2× exclusions before candidate fetch, alpha preservation, cancellation, fresh
  processing after cancellation and accepted heavy-model runs.
- Existing product regressions passed with the locally streamed, hash-verified
  production GFPGAN. The initial network-dependent invocation failed to fetch
  the remote face model; that report is retained separately rather than hidden.
  The local rerun uses the runner's existing `--local-face-model` option.
- Shared GFPGAN patches: two detected/enhanced faces were reused across all
  three models. The separate face preparation run took 1.97 s locally; its
  operations (download, initialization, detection and per-face inference) are
  retained in `faces-final/report.json`. Its preparation time is not included
  in the upscale table. Face comparison does not establish texture fidelity
  inside regions replaced by GFPGAN.

These are the pre-integration screening results. Current integration validation
is recorded in `benchmarks/browser/photo4x-integration.json` and the integration
document. Physical M1/8 GB and NVIDIA/AMD/Intel Windows tests remain unavailable.
The release does not infer support from a hardware name or guessed VRAM. There
is no new product toggle, and no deployment has been performed.
