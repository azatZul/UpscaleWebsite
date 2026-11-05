#!/usr/bin/env python3
"""Capture public HTTP metadata without relying on a scanner's scores."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.result = {"canonical": None, "hreflang": {}, "robots": None, "links": []}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and a.get("rel") == "canonical":
            self.result["canonical"] = a.get("href")
        if tag == "link" and a.get("hreflang"):
            self.result["hreflang"][a["hreflang"]] = a.get("href")
        if tag == "meta" and a.get("name") == "robots":
            self.result["robots"] = a.get("content")
        if tag == "a" and a.get("href"):
            self.result["links"].append(a["href"])


def fetch(url):
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (UScale site audit)"})
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read()
            result = {"url": url, "final_url": response.url, "status": response.status,
                      "bytes": len(data), "headers": dict(response.headers)}
        if "text/html" in result["headers"].get("Content-Type", ""):
            parser = Metadata()
            parser.feed(data.decode("utf-8"))
            result.update(parser.result)
        return result, data
    except Exception as error:
        return {"url": url, "error": str(error)}, b""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", default="https://upscales.app")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    sitemap, body = fetch(args.origin + "/sitemap.xml")
    root = ET.fromstring(body)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [node.text for node in root.findall("s:url/s:loc", ns)]
    urls = [args.origin + urlparse(url).path for url in urls]
    with ThreadPoolExecutor(max_workers=5) as pool:
        pages = [entry[0] for entry in pool.map(fetch, urls)]
        linked = sorted({urljoin(page["url"], link).split("#")[0] for page in pages
                         for link in page.get("links", [])
                         if urlparse(urljoin(page["url"], link)).netloc == urlparse(args.origin).netloc})
        extra = [entry[0] for entry in pool.map(fetch, [url for url in linked if url not in urls])]
    robots, robots_body = fetch(args.origin + "/robots.txt")
    result = {"captured_at": datetime.now(timezone.utc).isoformat(), "sitemap": sitemap,
              "robots": {**robots, "body": robots_body.decode("utf-8")}, "pages": pages,
              "other_internal_links": extra,
              "search_console": "Not captured: requires authenticated browser access"}
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {len(pages)} sitemap pages and {len(extra)} additional internal URLs to {path}")
    print("Non-200 sitemap pages:", [(p["url"], p.get("status"), p.get("error")) for p in pages if p.get("status") != 200])


if __name__ == "__main__":
    main()
