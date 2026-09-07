# Album publishing CLI

Create an isolated virtual environment and install `requirements.txt`. The CLI never
reads provider secrets directly: automatic processing uses the authenticated AuraLens
processing API.

Required environment variables for publication:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_D1_DATABASE_ID
CLOUDFLARE_D1_API_TOKEN
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
ALBUM_ENVIRONMENT
ALBUM_BASE_URL
```

Automatic flows additionally require `AURALENS_BASE_URL` and
`UPSCALER_TOOL_API_KEY`. Put them in an untracked `.env` and load them into the shell;
do not add them to editor launch settings or command arguments.

```bash
python3 tools/album/album.py validate /path/to/album
python3 tools/album/album.py publish /path/to/album --unlocked
python3 tools/album/album.py resume /path/to/album --unlocked
python3 tools/album/album.py publish /path/to/album --json --unlocked
```

Set `ALBUM_ENVIRONMENT=staging` and `ALBUM_BASE_URL=https://<your-worker>.workers.dev`
for staging; production uses `ALBUM_ENVIRONMENT=production` and defaults to
`ALBUM_BASE_URL=https://upscales.app`. A locked album can be published with
`--price-usd 0` and later opened with `album unlock <id>`; no checkout is exposed.
Use `--json` for machine-readable integration output. `unlock`, `feature` and
`unfeature` are no-ops when the album is already in that state.

The same folder can be published to staging and production without rerunning AI:
each account/database/bucket combination has its own publication state and URL.
Keep the manifest, input files, --unlocked and price unchanged during a retry.
Both before and after hashes are checked. Prepared media and ZIP are reused and
verified; restore any missing/corrupt work files before resuming.

Every album also uploads a versioned `gallery-v1.jpg` for its `/gallery` card: one
1280×960 JPEG made from two centered 640×960 aspect-fill crops at quality 80.

The CLI writes `.album-state.json` and `.album-work/` inside the album folder. Keep
both until publication completes: they make retries idempotent. R2 credentials should
be scoped to one bucket. The D1 token should have only D1 write access for the target
Cloudflare account and should use an expiry and IP restriction where practical.

`album delete` writes the D1 tombstone before removing objects. If object deletion is
interrupted, run `album gc` to review the remaining keys and `album gc --delete` to
remove keys belonging to explicitly deleted album IDs. Unknown IDs are reported
and retained because they may belong to an active or interrupted publication.
