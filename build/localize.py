#!/usr/bin/env python3
"""Export, import, and validate the website localization catalog.

Examples:
  python3 build/localize.py export de --split
  python3 build/localize.py export de --section guides
  python3 build/localize.py import de localization_work/de
  python3 build/localize.py validate de
"""

from __future__ import annotations

import argparse
from collections import Counter
from html.parser import HTMLParser
import json
import os
import re
import sys
import tempfile
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import localization_catalog as catalog


PLACEHOLDER_RE = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*\}")
INVARIANT_HTML_ATTRIBUTES = {
    "class", "data-copy", "href", "id", "loading", "rel", "src", "style",
    "target", "type", "width", "height",
}


class _HTMLShape(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.events: List[Any] = []

    def handle_starttag(self, tag, attrs):
        fixed = tuple(
            (name, value)
            for name, value in attrs
            if name in INVARIANT_HTML_ATTRIBUTES or name.startswith("data-")
        )
        self.events.append(("start", tag, fixed))

    def handle_startendtag(self, tag, attrs):
        fixed = tuple(
            (name, value)
            for name, value in attrs
            if name in INVARIANT_HTML_ATTRIBUTES or name.startswith("data-")
        )
        self.events.append(("empty", tag, fixed))

    def handle_endtag(self, tag):
        self.events.append(("end", tag))


def _html_shape(value: str) -> List[Any]:
    parser = _HTMLShape()
    parser.feed(value)
    parser.close()
    return parser.events


def _section_filename(value: str) -> str:
    filename = value if value.endswith(".json") else f"{value}.json"
    if filename not in catalog.SECTION_FILES:
        known = ", ".join(name[:-5] for name in catalog.SECTION_FILES)
        raise catalog.CatalogError(f"unknown section {value!r}; choose from: {known}")
    return filename


def _selected_sections(values: Optional[Sequence[str]]) -> Tuple[str, ...]:
    if not values:
        return catalog.SECTION_FILES
    result: List[str] = []
    for value in values:
        for item in value.split(","):
            filename = _section_filename(item.strip())
            if filename not in result:
                result.append(filename)
    return tuple(result)


def _export_records(target: str, sections: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for filename in sections:
        for key, record in catalog.section_records(filename).items():
            if record.get("shouldTranslate") is False:
                continue
            if target in record.get("excludedLocales", ()):
                continue
            source = record.get("localizations", {}).get(catalog.SOURCE_LANGUAGE)
            if source is None:
                continue
            exported: Dict[str, Any] = {}
            if record.get("comment"):
                exported["comment"] = record["comment"]
            exported["localizations"] = {
                catalog.SOURCE_LANGUAGE: source,
                target: None,
            }
            result[key] = exported
    return result


def _write_json(path: str, data: Mapping[str, Any]) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def command_export(args) -> None:
    if args.language == catalog.SOURCE_LANGUAGE:
        raise catalog.CatalogError("the export target must differ from the English source language")
    sections = _selected_sections(args.section)
    default_root = os.path.join(catalog.ROOT, "localization_work")
    if args.split:
        output_dir = args.output or os.path.join(default_root, args.language)
        os.makedirs(output_dir, exist_ok=True)
        total = 0
        for filename in sections:
            data = _export_records(args.language, (filename,))
            path = os.path.join(output_dir, filename)
            _write_json(path, data)
            total += len(data)
            print(f"  ✓ {path}: {len(data)} keys")
        print(f"Exported {total} keys for {args.language} into {output_dir}")
        return
    output = args.output or os.path.join(default_root, f"{args.language}.json")
    data = _export_records(args.language, sections)
    _write_json(output, data)
    print(f"Exported {len(data)} keys for {args.language} into {output}")


def _input_files(paths: Sequence[str]) -> List[str]:
    result: List[str] = []
    for raw in paths:
        path = os.path.abspath(raw)
        if os.path.isdir(path):
            for directory, dirnames, filenames in os.walk(path):
                dirnames.sort()
                for filename in sorted(filenames):
                    if filename.endswith(".json"):
                        result.append(os.path.join(directory, filename))
        elif os.path.isfile(path):
            result.append(path)
        else:
            raise catalog.CatalogError(f"input path does not exist: {raw}")
    if not result:
        raise catalog.CatalogError("no JSON input files found")
    return result


def _read_imports(paths: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    owners: Dict[str, str] = {}
    for path in _input_files(paths):
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            raise catalog.CatalogError(f"{path}: root must be an object")
        for key, record in data.items():
            if key in merged:
                raise catalog.CatalogError(
                    f"duplicate import key {key!r} in {owners[key]} and {path}"
                )
            if not isinstance(record, dict):
                raise catalog.CatalogError(f"{path}:{key}: record must be an object")
            merged[key] = record
            owners[key] = path
    return merged


def _expected_records(sections: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for filename in sections:
        result.update(_export_records("__target__", (filename,)))
    return result


def _validate_translation(key: str, source: str, translated: Any) -> None:
    if not isinstance(translated, str):
        raise catalog.CatalogError(f"{key}: translation must be a string, got {type(translated).__name__}")
    if source and not translated.strip():
        raise catalog.CatalogError(f"{key}: translation is empty")
    if Counter(PLACEHOLDER_RE.findall(source)) != Counter(PLACEHOLDER_RE.findall(translated)):
        raise catalog.CatalogError(f"{key}: translation changed {{placeholders}}")
    if ("<" in source or ">" in source) and _html_shape(source) != _html_shape(translated):
        raise catalog.CatalogError(f"{key}: translation changed HTML structure or protected attributes")


def _validated_updates(language: str, imported, sections) -> Dict[str, str]:
    expected = _expected_records(sections)
    missing = sorted(set(expected) - set(imported))
    extra = sorted(set(imported) - set(expected))
    if missing or extra:
        messages = []
        if missing:
            messages.append(f"missing {len(missing)} keys ({', '.join(missing[:5])})")
        if extra:
            messages.append(f"unknown {len(extra)} keys ({', '.join(extra[:5])})")
        raise catalog.CatalogError("; ".join(messages))
    updates: Dict[str, str] = {}
    for key, canonical_export in expected.items():
        record = imported[key]
        localizations = record.get("localizations")
        if not isinstance(localizations, dict):
            raise catalog.CatalogError(f"{key}: localizations must be an object")
        source = canonical_export["localizations"][catalog.SOURCE_LANGUAGE]
        if localizations.get(catalog.SOURCE_LANGUAGE) != source:
            raise catalog.CatalogError(f"{key}: English source was changed")
        canonical_comment = canonical_export.get("comment")
        if record.get("comment") != canonical_comment:
            raise catalog.CatalogError(f"{key}: localization comment was changed")
        translated = localizations.get(language)
        _validate_translation(key, source, translated)
        updates[key] = translated
    return updates


def _atomic_write_sections(section_data: Mapping[str, Mapping[str, Any]]) -> None:
    staged: List[Tuple[str, str]] = []
    try:
        for filename, data in section_data.items():
            destination = os.path.join(catalog.CATALOG_DIR, filename)
            descriptor, temporary = tempfile.mkstemp(
                prefix=f".{filename}.", suffix=".tmp", dir=catalog.CATALOG_DIR, text=True
            )
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            staged.append((temporary, destination))
        for temporary, destination in staged:
            os.replace(temporary, destination)
    finally:
        for temporary, _ in staged:
            if os.path.exists(temporary):
                os.unlink(temporary)


def command_import(args) -> None:
    if args.language == catalog.SOURCE_LANGUAGE:
        raise catalog.CatalogError("cannot import over the English source language")
    sections = _selected_sections(args.section)
    imported = _read_imports(args.inputs)
    updates = _validated_updates(args.language, imported, sections)
    all_records, owners = catalog.load_records()
    changed_sections: Dict[str, Dict[str, Any]] = {
        filename: catalog.section_records(filename) for filename in sections
    }
    for key, value in updates.items():
        filename = owners[key]
        changed_sections[filename][key]["localizations"][args.language] = value
    _atomic_write_sections(changed_sections)
    print(f"Imported {len(updates)} {args.language} translations into {len(sections)} section(s)")


def command_validate(args) -> None:
    records, _ = catalog.load_records()
    missing: List[str] = []
    checked = 0
    for key, record in records.items():
        if record.get("shouldTranslate") is False:
            continue
        if args.language in record.get("excludedLocales", ()):
            continue
        source = record.get("localizations", {}).get(catalog.SOURCE_LANGUAGE)
        if source is None:
            continue
        translated = record["localizations"].get(args.language)
        if translated is None:
            missing.append(key)
            continue
        if args.language in record.get("relaxedValidationLocales", ()):
            if not isinstance(translated, str) or (source and not translated.strip()):
                raise catalog.CatalogError(f"{key}: legacy translation must be a non-empty string")
        else:
            _validate_translation(key, source, translated)
        checked += 1
    if missing:
        raise catalog.CatalogError(
            f"{args.language}: missing {len(missing)} translations ({', '.join(missing[:8])})"
        )
    print(f"Validated {checked} {args.language} translations")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)

    export = commands.add_parser("export", help="create a source-to-target translation package")
    export.add_argument("language", help="target locale code, for example de")
    export.add_argument("--section", action="append", help="section name; repeat or use commas")
    export.add_argument("--split", action="store_true", help="write one JSON file per section")
    export.add_argument("--output", help="output file, or directory with --split")
    export.set_defaults(func=command_export)

    import_command = commands.add_parser("import", help="validate and write translated packages")
    import_command.add_argument("language", help="target locale code")
    import_command.add_argument("inputs", nargs="+", help="translated JSON file(s) or directories")
    import_command.add_argument("--section", action="append", help="import one complete section")
    import_command.set_defaults(func=command_import)

    validate = commands.add_parser("validate", help="validate a locale already in the catalog")
    validate.add_argument("language", help="locale code")
    validate.set_defaults(func=command_validate)
    return result


def main() -> None:
    args = parser().parse_args()
    try:
        args.func(args)
    except (catalog.CatalogError, json.JSONDecodeError) as error:
        sys.exit(f"error: {error}")


if __name__ == "__main__":
    main()
