# Temporary Upscale results: developer handover

This is the production handover for the internal computer command that runs an AuraLens image flow and creates a temporary before/after page on `upscales.app`. It is developer tooling, not an end-user upload product.

## Pull requests

- Website, result page, and command: [UpscaleWebsite PR #2](https://github.com/azatZul/UpscaleWebsite/pull/2)
- Backend, processing endpoint, and storage: [auralens-server PR #3](https://github.com/AlexandrGraschenkov/auralens-server/pull/3)

Deploy the backend first, then the website.

## Architecture

There are only two AuraLens application endpoints:

1. `POST /internal/v1/results` is authenticated. The command sends the source URL, flow parameters, 3- or 7-day retention, bearer key, and idempotency key in this one request. AuraLens authenticates first, then downloads the source, runs one provider request, stores the two images, and returns the UUID and website URL.
2. `GET /public/v1/results/<UUID>` is public-by-link. AuraLens returns `404` for an unknown, deleted, or expired UUID. For an active UUID it returns metadata and signed Google Cloud Storage URLs.

There are no public AuraLens media or download endpoints. The browser renders the signed URLs directly. The JSON has before and after URLs plus `download_url`, which is only another signature for the same after object with an attachment filename. It is not a third object or another backend request during page load.

Creative Upscale submits the whole image in one WaveSpeed request (`tile_count: 1`). Photo Restoration submits one Replicate request to `flux-kontext-apps/restore-image`.

```text
developer command
  └─ one authenticated POST
       ├─ authenticate before remote I/O
       ├─ fetch and validate source URL
       ├─ one WaveSpeed or Replicate call
       ├─ store before + after + manifest in private GCS
       └─ return https://upscales.app/results/<UUID>

result page
  └─ one GET /public/v1/results/<UUID>
       ├─ reject expired/unknown as 404
       └─ return signed before/after URLs for direct browser rendering
```

## UUID-to-image mapping

AuraLens creates the UUID after processing. It is not a provider prediction ID or idempotency key. Objects use these prefixes:

```text
results/3d/<UUID>/before.<extension>
results/3d/<UUID>/after.<extension>
results/3d/<UUID>/manifest.json

results/7d/<UUID>/before.<extension>
results/7d/<UUID>/after.<extension>
results/7d/<UUID>/manifest.json

idempotency/<SHA-256 of Idempotency-Key>.json
```

The manifest connects the UUID to object names, dimensions, types, processing parameters, creation time, and exact expiry. A completed retry with the same idempotency key returns the existing result without another paid provider call. Concurrent identical requests are not currently serialized and can still duplicate work.

## API contract

Creative Upscale request:

```http
POST /internal/v1/results
Authorization: Bearer <UPSCALER_TOOL_API_KEY>
Idempotency-Key: <8-128 safe characters>
Content-Type: application/json

{
  "image_url": "https://example.com/source.jpg",
  "flow": "creative-upscale",
  "retention_days": 7,
  "creativity": 0,
  "target_resolution": "4k"
}
```

Photo Restoration body:

```json
{
  "image_url": "https://example.com/old-photo.jpg",
  "flow": "photo-restoration",
  "retention_days": 3,
  "output_format": "jpg",
  "safety_tolerance": 2,
  "seed": 42
}
```

The POST is synchronous and returns after provider processing and storage:

```json
{
  "result_id": "2d51c93a-af14-4ca8-a216-650885fd76bf",
  "result_url": "https://upscales.app/results/2d51c93a-af14-4ca8-a216-650885fd76bf",
  "expires_at": "2026-09-11T12:00:00Z"
}
```

The page calls `GET /public/v1/results/<UUID>` once. Its JSON contains `before.url`, `after.url`, dimensions, processing metadata, `expires_at`, and the processed-image `download_url`. All signed URLs expire at the manifest's absolute expiry, never later. Google V4 signatures support at most seven days. Anyone with a signed URL can use it while active. See [Cloud Storage signed URLs](https://cloud.google.com/storage/docs/access-control/signed-urls).

## Security

- FastAPI's bearer dependency succeeds before the processing handler can download the source, contact a provider, or write storage.
- Missing/wrong bearer keys return `401`.
- A missing server key, or one shorter than 32 characters, disables the endpoint with `503`; it cannot accidentally become an open paid API.
- The comparison uses `secrets.compare_digest`.
- The key is separate from mobile HMAC credentials and is held only by trusted developers.
- The server value lives in Google Secret Manager and is exposed only to Cloud Run as `UPSCALER_TOOL_API_KEY`.
- Developer copies live only in the website repository's ignored `.env`; the static site and Cloudflare never receive it.
- The GCS bucket remains private. AuraLens uses its Cloud Run identity for object access and `signBlob`; no service-account JSON key is created.
- The public metadata route is capability sharing: the random UUID is unguessable in normal use, but anyone given it can view the result until expiry.
- HTTPS source URLs are required in production. Downloads and redirects are bounded and validated. `PROXY_IMAGE_ALLOW_HTTP=true` is local-test-only.

A fixed key does not provide per-developer revocation, attribution, rate limits, or quotas. Add those before expanding beyond a small trusted group. With `PROXY_IMAGE_ALLOWED_HOST_SUFFIXES` unset, trusted developers may submit any public HTTPS host; see Known issues.

## Run the command

From `UpscaleWebsite`:

```sh
python3 -m pip install -r scripts/upscale_result/requirements.txt
cp .env.example .env
```

```dotenv
UPSCALER_TOOL_API_KEY=replace-with-the-real-long-random-secret
AURALENS_API_BASE_URL=https://auralens-406817559814.us-central1.run.app
```

`.env` and `.env.*` are ignored; only `.env.example` is tracked. Verify with `git check-ignore .env` and `git status --short`.

```sh
# Creative Upscale
python3 scripts/upscale_result/upscale_result.py \
  'https://example.com/photo.jpg' \
  --retention 7 --creativity 0 --resolution 4k

# Photo Restoration
python3 scripts/upscale_result/upscale_result.py \
  'https://example.com/old-photo.jpg' \
  --flow photo-restoration --retention 3 \
  --output-format jpg --safety-tolerance 2 --seed 42
```

The command validates syntax locally, makes exactly one POST to AuraLens, and prints the result page URL. It never directly downloads the image or calls a paid provider.

## Local mocked end-to-end test

Start AuraLens from `auralens-server`:

```sh
export UPSCALER_TOOL_API_KEY='local-test-key-that-is-at-least-32-characters'
export RESULTS_STORAGE_BACKEND='local'
export RESULTS_LOCAL_STORAGE_DIR='/tmp/auralens-result-test'
export RESULTS_SITE_BASE_URL='http://127.0.0.1:8080'
export RESULTS_ALLOWED_ORIGINS='http://127.0.0.1:8080'
export WAVESPEED_MOCK_MODE='true'
export PROXY_IMAGE_ALLOW_HTTP='true'
.venv/bin/uvicorn auralens_server.main:app --host 127.0.0.1 --port 8000
```

Start the website from `UpscaleWebsite`:

```sh
python3 scripts/serve_local.py --port 8080
```

Run the command:

```sh
UPSCALER_TOOL_API_KEY='local-test-key-that-is-at-least-32-characters' \
python3 scripts/upscale_result/upscale_result.py \
  'http://127.0.0.1:8080/resources/competitors/remini.jpg' \
  --retention 3 \
  --api-base-url 'http://127.0.0.1:8000' \
  --allow-http
```

Open the printed URL. This path uses HTTP end to end but replaces the paid WaveSpeed request with a deterministic local transform. Never set `PROXY_IMAGE_ALLOW_HTTP=true` in Cloud Run.

## Production setup

The current local Google identity could not read project `auralens-472014`. A project administrator must grant access or perform this setup. Do not silently create the production bucket in another project.

### 1. Set the target and enable services

```sh
export RESULT_PROJECT_ID='auralens-472014'
export RESULT_REGION='us-central1'
export RESULT_SERVICE='auralens'
export RESULT_BUCKET='<globally-unique-private-bucket-name>'

gcloud services enable \
  run.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com artifactregistry.googleapis.com \
  --project="${RESULT_PROJECT_ID}"
```

`iamcredentials.googleapis.com` is needed for `iam.serviceAccounts.signBlob` without a private-key file.

### 2. Identify the existing Cloud Run identity

```sh
gcloud run services describe "${RESULT_SERVICE}" \
  --project="${RESULT_PROJECT_ID}" --region="${RESULT_REGION}" \
  --format='yaml(spec.template.spec.serviceAccountName,status.url)'
export RESULT_RUNTIME_SA='<exact-service-account-email-returned-above>'
```

Do not guess or replace this identity before auditing its existing provider-secret access. Never set `GOOGLE_APPLICATION_CREDENTIALS` on Cloud Run and never download a service-account key. See [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity) and [environment variable guidance](https://cloud.google.com/run/docs/configuring/services/environment-variables).

### 3. Create the private bucket

```sh
gcloud storage buckets create "gs://${RESULT_BUCKET}" \
  --project="${RESULT_PROJECT_ID}" \
  --location="${RESULT_REGION}" \
  --default-storage-class=STANDARD \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --soft-delete-duration=0
```

Use a regional Standard bucket because objects live only 3 or 7 days. Uniform access and public access prevention avoid accidental object ACL exposure. Soft delete is disabled so deleted media is not kept for an extra default period.

For an existing bucket, inspect it and disable soft delete if necessary:

```sh
gcloud storage buckets describe "gs://${RESULT_BUCKET}" \
  --format='yaml(location,storage_class,uniform_bucket_level_access,public_access_prevention,soft_delete_policy,retention_policy,versioning_enabled,lifecycle_config)'
gcloud storage buckets update --clear-soft-delete "gs://${RESULT_BUCKET}"
```

Do not use a bucket retention policy, object holds, or versioning that defeats deletion. References: [create buckets](https://cloud.google.com/sdk/gcloud/reference/storage/buckets/create), [uniform access](https://cloud.google.com/storage/docs/uniform-bucket-level-access), [public access prevention](https://cloud.google.com/storage/docs/public-access-prevention), and [disable soft delete](https://cloud.google.com/storage/docs/disable-soft-delete).

### 4. Grant object and signing permissions

```sh
gcloud storage buckets add-iam-policy-binding "gs://${RESULT_BUCKET}" \
  --member="serviceAccount:${RESULT_RUNTIME_SA}" \
  --role='roles/storage.objectUser'

gcloud iam service-accounts add-iam-policy-binding "${RESULT_RUNTIME_SA}" \
  --project="${RESULT_PROJECT_ID}" \
  --member="serviceAccount:${RESULT_RUNTIME_SA}" \
  --role='roles/iam.serviceAccountTokenCreator'
```

The first grant is limited to this bucket. The second is limited to this service-account resource and supplies `signBlob`. Do not grant `allUsers`, `allAuthenticatedUsers`, Storage Admin, or project-wide Token Creator. See [Storage IAM roles](https://cloud.google.com/storage/docs/access-control/iam-roles), [signed-URL helper requirements](https://cloud.google.com/storage/docs/access-control/signing-urls-with-helpers), and [service-account policy binding](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/add-iam-policy-binding).

### 5. Configure deletion

From `auralens-server`:

```sh
gcloud storage buckets update "gs://${RESULT_BUCKET}" \
  --lifecycle-file='deploy/result-storage-lifecycle.json'
gcloud storage buckets describe "gs://${RESULT_BUCKET}" \
  --format='yaml(lifecycle_config,soft_delete_policy,retention_policy,versioning_enabled)'
```

The rules delete `results/3d/` at 3 days, `results/7d/` and `idempotency/` at 7 days, and `_healthcheck/` probes at 1 day. GCS lifecycle deletion is asynchronous. Exact access stops at `expires_at`: AuraLens stops issuing links, existing signed URLs expire, and objects use `Cache-Control: private, no-store`. Physical removal can lag. If exact physical erasure at the minute becomes mandatory, add a scheduled deletion job and keep lifecycle as fallback. See [Object Lifecycle Management](https://cloud.google.com/storage/docs/lifecycle).

### 6. Create and attach the bearer secret

```sh
umask 077
export RESULT_SECRET_FILE="$(mktemp)"
openssl rand -hex 32 > "${RESULT_SECRET_FILE}"
gcloud secrets create upscaler-tool-api-key \
  --replication-policy='automatic' --project="${RESULT_PROJECT_ID}"
gcloud secrets versions add upscaler-tool-api-key \
  --data-file="${RESULT_SECRET_FILE}" --project="${RESULT_PROJECT_ID}"

gcloud secrets add-iam-policy-binding upscaler-tool-api-key \
  --member="serviceAccount:${RESULT_RUNTIME_SA}" \
  --role='roles/secretmanager.secretAccessor' \
  --project="${RESULT_PROJECT_ID}"
```

If the secret exists, skip creation and add a version. Attach the printed numbered version:

```sh
export RESULT_TOOL_SECRET_VERSION='<new-version-number>'
gcloud run services update "${RESULT_SERVICE}" \
  --project="${RESULT_PROJECT_ID}" --region="${RESULT_REGION}" \
  --update-secrets="UPSCALER_TOOL_API_KEY=upscaler-tool-api-key:${RESULT_TOOL_SECRET_VERSION}"
```

Copy the same file value to authorized developers' ignored `UpscaleWebsite/.env`, then `rm "${RESULT_SECRET_FILE}"` and unset both temporary variables. Never paste it into a command argument, PR, issue, chat, build log, Cloudflare, or tracked file. See [Secret Manager](https://cloud.google.com/secret-manager/docs/creating-and-accessing-secrets) and [Cloud Run secrets](https://cloud.google.com/run/docs/configuring/services/secrets).

### 7. Configure and deploy AuraLens

```sh
gcloud run services update "${RESULT_SERVICE}" \
  --project="${RESULT_PROJECT_ID}" --region="${RESULT_REGION}" \
  --timeout='10m' \
  --update-env-vars="RESULTS_STORAGE_BACKEND=gcs,RESULTS_GCS_BUCKET=${RESULT_BUCKET},RESULTS_SIGNING_SERVICE_ACCOUNT=${RESULT_RUNTIME_SA},RESULTS_SITE_BASE_URL=https://upscales.app,RESULTS_ALLOWED_ORIGINS=https://upscales.app,PROXY_IMAGE_ALLOW_HTTP=false"
```

Use `--update-env-vars`, not `--set-env-vars`, so provider settings remain intact. The 10-minute timeout covers the synchronous provider operation; Cloud Run defaults to 5 minutes. See [request timeouts](https://cloud.google.com/run/docs/configuring/request-timeout).

Deploy through the repository's existing `./build_and_deploy.sh`. With GCS enabled, each instance performs a write/read/sign/delete startup probe under `_healthcheck/`. Wrong bucket/IAM/signing configuration prevents the revision from becoming ready.

Optional bounds are `PROXY_IMAGE_MAX_BYTES` (50 MiB), `PROXY_IMAGE_TIMEOUT_SECONDS` (120 seconds), `RESULTS_MAX_IMAGE_BYTES` (40 MiB per object), and `RESULTS_MAX_IMAGE_PIXELS` (100 million). `PROXY_IMAGE_ALLOWED_HOST_SUFFIXES` can restrict all source/provider redirects to known suffixes.

### 8. Deploy the website and smoke test

Build `UpscaleWebsite` with `python3 build/build.py` and publish `dist/` through its existing Cloudflare Pages integration. Cloudflare needs no bearer key or Google credential. The result CSP permits `storage.googleapis.com` images.

Smoke test in this order:

1. POST valid JSON without Authorization and with a deliberately wrong key; both must return `401` without provider jobs.
2. Run one small Creative Upscale with `--retention 3`; this intentionally spends one WaveSpeed call.
3. Confirm the printed page makes one AuraLens metadata GET, renders both signed GCS images, and downloads the result.
4. Run one small Photo Restoration; this intentionally spends one Replicate call.
5. Confirm each UUID prefix has only before, after, and manifest objects, while bare unsigned GCS URLs are denied.
6. Confirm signed expirations do not exceed manifest expiry and object responses are `private, no-store`.
7. Inspect Cloud Run errors/latency, provider spend, and bucket object/byte counts.

## Known issues

### Image size and memory

There is no multipart upload now. The backend downloads compressed source/output bytes, decodes and normalizes the source, and holds images in memory. Decoded 8K images can be much larger than their files, and concurrency multiplies memory use. Load-test realistic inputs before increasing the existing byte/pixel limits; tune Cloud Run memory and concurrency. Streaming provider output to GCS is a possible later optimization.

### Long synchronous requests

The simple POST stays open throughout provider work. A network interruption can trigger a retry while the first request is still running. Completed retries are free through idempotency, but simultaneous retries can duplicate spend. Move work behind a durable job only if real latency/reliability requires it.

### Source URL / SSRF hardening

The route is bearer-protected, production is HTTPS-only, URL credentials are rejected, redirects are revalidated, and a suffix allowlist is available. With that allowlist unset, a trusted developer can request any HTTPS hostname. Before distributing keys more broadly or accepting untrusted URLs, enforce known source hosts or add private-address/egress controls robust against DNS rebinding.

### Deletion timing

Logical/signed access ends exactly at expiry; lifecycle-based physical deletion is asynchronous. Keep soft delete, versioning, holds, and retention disabled; monitor stale objects. Add an exact-time scheduled deleter if physical erasure timing becomes contractual.

## Release checklist

- [ ] Backend merges/deploys before website.
- [ ] Deployer has access to the real AuraLens project/service.
- [ ] Runtime service account is identified; IAM Credentials API is enabled.
- [ ] Private regional Standard bucket has uniform access and public access prevention.
- [ ] Soft delete, versioning, holds, and conflicting retention are absent.
- [ ] Lifecycle JSON is applied.
- [ ] Runtime identity has bucket `roles/storage.objectUser` and narrowly scoped Token Creator on the signer.
- [ ] Bearer key is a 32+ character Secret Manager value and developer copies are ignored.
- [ ] Bucket, signer, URLs/origin, production HTTPS, and timeout variables are configured without replacing provider settings.
- [ ] Backend startup write/read/sign/delete probe succeeds.
- [ ] Website `/results/<UUID>` route and GCS Content Security Policy are deployed.
- [ ] Unauthorized calls spend nothing; both real flows pass smoke testing.
- [ ] Monitoring, budgets, key rotation, and rollback ownership are assigned.

## Troubleshooting

- `401 Invalid tool API key`: local key differs from the Cloud Run secret.
- `503 Tool API is not configured`: server key is missing or too short.
- Revision does not become ready: check bucket object permission, signing-service-account variable, IAM Credentials API, and Token Creator binding.
- `404 Result not found`: UUID is unknown, expired, or deleted.
- Page loads but images are blocked: deployed CSP must include `https://storage.googleapis.com` in `img-src`.
- `413`: source or provider output exceeded the download limit.
- `504`/disconnect: inspect provider logs and verify Cloud Run timeout exceeds command wait time.
