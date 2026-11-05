#!/usr/bin/env python3
"""Resolve the user's rating export against the exact local blind-review key."""
import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


LABELS = {
    "Текущая SRVGG FP32 · overlap 16": "current",
    "Nomos ESRGAN FP16 · overlap 32": "nomos-esrgan",
    "Nomos RealPLKSR FP16 · overlap 32 · GPU-only": "nomos-realplksr",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", required=True, type=Path)
    parser.add_argument("--work", type=Path, default=Path(".web-model-work/photo4x"))
    parser.add_argument("--output", type=Path, default=Path("benchmarks/browser/photo4x-quality-review.json"))
    args = parser.parse_args()
    exported = json.loads(args.review.read_text())
    key_path = args.work / "results/review-web/blind-key.json"
    key = json.loads(key_path.read_text())
    manifest = json.loads((args.work / "web-corpus/manifest.json").read_text())
    cases = json.loads((args.work / "quality-cases.json").read_text())
    if exported["protocol"] != manifest["protocol"]:
        raise ValueError("Review protocol does not match this corpus")
    ratings = exported["ratings"]
    if set(ratings) != set(key) or set(ratings) != {case['id'] for case in cases}:
        raise ValueError("Review must cover exactly the prepared cases")
    counts = Counter({model: 0 for model in LABELS.values()})
    counts.update({"tie": 0, "none": 0})
    tracks = defaultdict(Counter)
    rows = []
    for case in cases:
        case_id = case["id"]
        rating = ratings[case_id]
        choice, notes = rating["choice"], rating.get("notes", "")
        if choice not in ["A", "B", "C", "tie", "none"]:
            raise ValueError(f"Missing/invalid choice: {case_id}")
        resolved_key = {letter: LABELS[label] for letter, label in key[case_id].items()}
        selected = resolved_key[choice] if choice in resolved_key else choice
        counts[selected] += 1
        tracks[case["track"]][selected] += 1
        row = {"case": case_id, "track": case["track"], "choice": choice,
               "selected": selected, "mapping": resolved_key, "notes": notes}
        if choice == "tie":
            # Preserve explicit tied pairs, never infer all three or award fractional wins.
            pair = re.search(r"\b([ABC])\s*/\s*([ABC])\b", notes)
            row['tiedModelsFromNotes'] = [resolved_key[letter] for letter in pair.groups()] if pair else None
        rows.append(row)
    winner, wins = max(((model, counts[model]) for model in LABELS.values()), key=lambda item: item[1])
    models = json.loads((args.work / 'manifest.json').read_text())['models']
    candidate = next(model for model in models if model['id'] == winner and model['tileSize'] == 256 and model['precision'] == 'fp16')
    report = {"schemaVersion": 1, "reviewDate": "2026-11-03", "reviewer": "user",
              "sourceFile": args.review.name, "sourceSha256": digest(args.review), "blindKeySha256": digest(key_path),
              "protocol": exported['protocol'], "caseCount": len(rows), "counts": dict(counts),
              "byTrack": {track: dict(counts) for track, counts in tracks.items()}, "ratings": rows,
              "qualityWinner": {**{key: candidate[key] for key in ['id', 'revision', 'sha256', 'precision', 'tileSize', 'bytes', 'requires']},
                                "overlap": 32, "outrightPreferences": wins},
              "status": "quality-review-complete-device-acceptance-pending",
              "limitations": ["One reviewer; subjective preferences, not statistical proof.",
                              "Sixteen controlled cases come from twelve sources, not sixteen independent photos.",
                              "ESRGAN preferred on two of the three real user inputs; retain this exception.",
                              "Crisp/external references were not selectable A/B/C candidates.",
                              "Ratings do not approve untested devices or publication of weights."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (args.work / 'quality-review-export.json').write_bytes(args.review.read_bytes())
    print(json.dumps({'counts': report['counts'], 'byTrack': report['byTrack'], 'winner': winner}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
