#!/usr/bin/env bash
set -euo pipefail

environment="${1:-}"
if [[ "$environment" != "staging" && "$environment" != "production" ]]; then
  echo "Usage: scripts/deploy-cloudflare.sh staging|production" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="$repo_root/worker/wrangler.jsonc"
# The album CLI suite needs Pillow. Falling back to a bare python3 would skip that whole
# file and still report success, so the gate insists on an interpreter that can import it.
python_bin="$repo_root/tools/album/.venv/bin/python"
if [[ ! -x "$python_bin" ]]; then
  python_bin="python3"
fi
if ! "$python_bin" -c "import PIL" >/dev/null 2>&1; then
  echo "$python_bin cannot import Pillow; create tools/album/.venv and install tools/album/requirements.txt." >&2
  exit 2
fi
if [[ "$environment" == "staging" ]]; then
  placeholder="00000000-0000-0000-0000-000000000002"
else
  placeholder="00000000-0000-0000-0000-000000000003"
fi
if rg -q "$placeholder" "$config"; then
  echo "Replace the $environment D1 database_id placeholder in worker/wrangler.jsonc first." >&2
  exit 2
fi

cd "$repo_root"
"$python_bin" build/build.py
ALBUM_TESTS_REQUIRED=1 "$python_bin" -m unittest discover -s tests -v
npm --prefix worker run check
(cd worker && npx wrangler d1 migrations apply DB --remote --env "$environment")
npm --prefix worker run "deploy:$environment"
