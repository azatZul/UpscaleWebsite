#!/usr/bin/env python3
"""Publish measurements without copying private photographs or experimental weights."""
import argparse
import hashlib
import json
import re
import statistics
from datetime import datetime, timezone
from collections import defaultdict
from pathlib import Path


EXPERIMENTS = ["fp32-five", "fp16-five", "real-fp16-five", "gpu-fp32-five", "gpu-fp16-five",
               "gpu-fp16-o16", "large", "large-gpu", "small-jpeg", "faces-final",
               "corpus-restore_original", "corpus-denoise_orig", "corpus-lol_dark_2",
               "corpus-sky_original", "corpus-face_preview_blured_2", "corpus-japan_blured"]
TIMINGS = ["wallMs", "upscaleExportMs", "warmupMs", "probeMs", "inferenceMs", "assemblyMs",
           "compositeMs", "exportMs", "runtimeTimings.modelDownloadMs", "runtimeTimings.sessionMs",
           "runtimeTimings.prepareMs", "facePreparation.fullMs"]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def get(value, key):
    for part in key.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


def summarize(values):
    return {"count": len(values), "min": min(values), "median": statistics.median(values), "max": max(values)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, default=Path(".web-model-work/photo4x"))
    parser.add_argument("--output", type=Path, default=Path("benchmarks/browser/photo4x-m4-screening.json"))
    args = parser.parse_args()
    report = {"schemaVersion": 1, "status": "experimental-production-disabled", "date": "2026-11-02",
              "updatedAt": datetime.now(timezone.utc).isoformat(),
              "qualityChoice": {"letter": "C", "model": "nomos-realplksr", "precision": "fp32", "tileSize": 256,
                                "overlap": 16, "faces": False, "scope": "initial user preference on primary photo; not final approval",
                                "followup": "User found primary result ambiguous and rejected old six-image corpus; expanded photographic review required."},
              "measurements": [], "pendingExperiments": [], "artifacts": []}
    prepared = json.loads((args.work / 'manifest.json').read_text())
    report['preparation'] = {k: prepared[k] for k in ['python', 'tools']}
    report['models'] = [{**{k: model[k] for k in ['id', 'revision', 'precision', 'tileSize', 'sha256', 'bytes', 'requires']},
                        'source': {k: model['source'][k] for k in ['url', 'sha256', 'bytes']},
                        'transforms': model.get('transforms'), 'verification': model.get('verification'),
                        'fp32ConversionVerification': model.get('fp32ConversionVerification')}
                       for model in prepared['models'] if model['tileSize'] == 256]
    experiments = list(EXPERIMENTS)
    quality_cases = args.work / "quality-cases.json"
    if quality_cases.exists():
        experiments.extend(case["id"] for case in json.loads(quality_cases.read_text()))
    for name in experiments:
        folder = args.work / "results" / name
        path = folder / "report.json"
        if not path.exists():
            report["pendingExperiments"].append(name)
            continue
        raw = json.loads(path.read_text())
        groups = defaultdict(list)
        for run in raw["runs"]:
            if not run.get("failed"):
                groups[run["label"]].append(run)
        summary = {"experiment": name, "reportSha256": digest(path), "input": raw["input"], "host": raw.get("host"),
                   "runtime": raw.get("runtime"), "currentModel": raw.get("currentModel"),
                   "browserVersion": raw.get("browserVersion"), "environment": raw.get("environment"),
                   "memory": raw.get("memory"), "groups": [], "errors": raw.get("errors", []),
                   "failed": [{k: run[k] for k in ["id", "label", "run", "code", "budgetExceeded", "error", "evidence"] if k in run}
                              for run in raw["runs"] if run.get("failed")], "skipped": raw.get("skipped", [])}
        for label, runs in groups.items():
            entry = {"label": label, "id": runs[0]["id"], "count": len(runs), "plan": runs[0].get("plan"), "timingsMs": {}}
            variant = runs[0].get("variant")
            if variant:
                entry["variant"] = {k: variant[k] for k in ["revision", "sha256", "precision", "tileSize", "overlap", "bytes", "requires"] if k in variant}
            for key in TIMINGS:
                values = [get(run, key) for run in runs]
                values = [v for v in values if isinstance(v, (int, float))]
                if values:
                    entry["timingsMs"][key] = summarize(values)
            probes = [max(run["probeTimes"]) for run in runs if run.get("probeTimes")]
            if probes:
                entry["maxProbeMs"] = summarize(probes)
                # Worst measured overhead for this exact device/format/output.
                overhead = max(run["assemblyMs"] + run["compositeMs"] + run["exportMs"] for run in runs)
                entry["measuredOverheadMaxMs"] = overhead
                entry["posthocForecastMs"] = [max(run["probeTimes"]) * max(run["plan"]["tileCount"], 3) * 1.25 + overhead for run in runs]
                entry["posthocForecastNote"] = "Validation using observed overhead; not a live production admission and not evidence for other devices or output sizes."
                entry["calibratedMargin"] = max([1.25] + [(run["upscaleExportMs"] - overhead) /
                     (max(run["probeTimes"]) * max(run["plan"]["tileCount"], 3)) for run in runs])
            summary["groups"].append(entry)
        report["measurements"].append(summary)
        for image in sorted(folder.glob("*.png")) + sorted(folder.glob("*.jpg")):
            report["artifacts"].append({"file": str(image.relative_to(args.work)), "sha256": digest(image), "bytes": image.stat().st_size})
    report["seams"] = []
    for folder in ["seams", "seams-gpu"]:
        for path in sorted((args.work / "results" / folder).glob("*-seams.json")):
            raw = json.loads(path.read_text())
            report["seams"].append({"file": str(path.relative_to(args.work)),
                **{k: raw[k] for k in ["overlap", "tileSize", "meaning", "all", "seams", "outsideSeams", "outerBorder"]}})
    for name in ["gpu-image-parity", "chosen-c-parity", "provenance-gpu", "crisp-audit", "recovery", "product-regressions-local", "review-qa"]:
        path = args.work / f"{name}.json"
        if path.exists():
            # Keep complete private raw reports local; expose a stable evidence hash.
            report.setdefault("evidence", []).append({"file": path.name, "sha256": digest(path)})
    expanded = args.work / "web-corpus/manifest.json"
    if expanded.exists():
        corpus = json.loads(expanded.read_text())
        report["expandedCorpus"] = {"protocol": corpus["protocol"], "images": corpus["images"], "cases": corpus["cases"],
                                    "status": "Human quality review pending; no model promoted"}
    metrics = args.work / "results/review-web/paired-metrics.json"
    if metrics.exists():
        report["pairedMetrics"] = json.loads(metrics.read_text())
    quality_path = Path(__file__).resolve().parents[1] / 'benchmarks/browser/photo4x-quality-review.json'
    if quality_path.exists():
        quality = json.loads(quality_path.read_text())
        report['qualityChoice'] = {**quality['qualityWinner'], 'counts': quality['counts'],
            'byTrack': quality['byTrack'], 'scope': 'Completed user review of 19 expanded cases; device acceptance pending',
            'evidence': 'benchmarks/browser/photo4x-quality-review.json', 'evidenceSha256': digest(quality_path)}
        report['expandedCorpus']['status'] = quality['status']
    report['validation'] = {}
    for name in ['recovery', 'product-regressions-local', 'review-qa']:
        path = args.work / f'{name}.json'
        if path.exists():
            raw = json.loads(path.read_text())
            report['validation'][name] = {'passed': raw.get('passed'), 'sha256': digest(path),
                'caseCount': len(raw['checks']) if 'checks' in raw else raw.get('counts')}
    for name, pattern in [('unit-final.log', r'pass (\d+)'), ('localization-final.log', r'Ran (\d+) tests')]:
        path = args.work / name
        if path.exists():
            match = re.search(pattern, path.read_text())
            report['validation'][name] = {'count': int(match.group(1)) if match else None, 'sha256': digest(path)}
    build = args.work / 'build-production-final.log'
    if build.exists():
        report['validation']['productionPackage'] = {'passed': 'Cloudflare production package ready:' in build.read_text(), 'sha256': digest(build)}
    report["limitations"] = ["No reliable VRAM measurement; JS heap excludes native/GPU memory.",
        "Loopback model download timings do not measure first public network download.",
        "Small corpus screening is not a broad photographic quality validation.",
        "Only the recorded M4 Pro Chromium configuration was exercised; no M1/Windows/Safari/Linux certification.",
        "Raw RealPLKSR measurements include heavy CPU Softplus fallback and are not release candidates."]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {args.output}: {len(report['measurements'])} experiments; pending: {report['pendingExperiments']}")


if __name__ == "__main__":
    main()
