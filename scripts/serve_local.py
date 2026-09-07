#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


RESULT_ROUTE = re.compile(
    r"^/results/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/?$",
    re.IGNORECASE,
)
SITE_ROOT = Path(__file__).resolve().parent.parent / "dist"


class ResultAwareHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if RESULT_ROUTE.fullmatch(urlsplit(self.path).path):
            self.path = "/results/index.html"
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the UScale website locally")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    if not (SITE_ROOT / "index.html").is_file():
        raise SystemExit("Build the site first with: python3 build/build.py")

    handler = partial(ResultAwareHandler, directory=str(SITE_ROOT))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving UScale website at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
