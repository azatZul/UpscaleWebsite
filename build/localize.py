#!/usr/bin/env python3
"""Export, import, and validate the website localization catalog.

Examples:
  python3 build/localize.py export de --source-languages en,ru
  python3 build/localize.py export de --source-languages en,ru --merge
  python3 build/localize.py export de --source-languages en,ru --section guides
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


def _source_languages(values: Sequence[str]) -> Tuple[str, ...]:
    result: List[str] = []
    for value in values:
        for item in value.split(","):
            language = item.strip()
            if not language:
                continue
            if language not in result:
                result.append(language)
    if not result:
        raise catalog.CatalogError("at least one source language is required")
    return tuple(result)


def _validate_language_selection(target: str, sources: Sequence[str]) -> None:
    available = set(catalog.available_locales())
    unknown = [language for language in sources if language not in available]
    if unknown:
        known = ", ".join(sorted(available))
        raise catalog.CatalogError(
            f"unknown source language(s): {', '.join(unknown)}; available: {known}"
        )
    if target in sources:
        raise catalog.CatalogError("the target language must not be a source language")
    if target == catalog.SOURCE_LANGUAGE:
        raise catalog.CatalogError("cannot export a translation over the canonical English source")


def _record_applies_to_target(record: Mapping[str, Any], target: str) -> bool:
    if record.get("shouldTranslate") is False:
        return False
    scoped_locales = record.get("locales")
    if scoped_locales is not None and target not in scoped_locales:
        return False
    if target in record.get("excludedLocales", ()):
        return False
    return True


def _export_records(
    target: str,
    sources: Sequence[str],
    sections: Sequence[str],
) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for filename in sections:
        for key, record in catalog.section_records(filename).items():
            if not _record_applies_to_target(record, target):
                continue
            localizations = record.get("localizations", {})
            exported: Dict[str, Any] = {
                language: localizations[language]
                for language in sources
                if language in localizations
            }
            if not exported:
                joined = ", ".join(sources)
                raise catalog.CatalogError(
                    f"{filename}:{key}: none of the selected source languages "
                    f"({joined}) has text"
                )
            exported[target] = None
            if record.get("comment"):
                exported["comment"] = record["comment"]
            result[key] = exported
    return result


def _write_json(path: str, data: Mapping[str, Any], *, compact: bool = True) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        if compact:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")


def _prefixed_records(
    sections: Sequence[str],
    section_data: Mapping[str, Mapping[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for filename in sections:
        prefix = filename[:-5]
        for key, record in section_data[filename].items():
            result[f"{prefix}.{key}"] = dict(record)
    return result


def command_export(args) -> None:
    sources = _source_languages(args.source_languages)
    _validate_language_selection(args.language, sources)
    sections = _selected_sections(args.section)
    default_root = os.path.join(catalog.ROOT, "localization_work")
    section_data = {
        filename: _export_records(args.language, sources, (filename,))
        for filename in sections
    }
    total = sum(len(data) for data in section_data.values())
    if not args.merge:
        output_dir = args.output or os.path.join(default_root, args.language)
        for filename, data in section_data.items():
            path = os.path.join(output_dir, filename)
            _write_json(path, data)
            print(f"  ✓ {path}: {len(data)} keys")
        print(f"Exported {total} keys for {args.language} into {output_dir}")
        return
    output = args.output or os.path.join(default_root, f"{args.language}.json")
    data = _prefixed_records(sections, section_data)
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


def _normalize_import_key(
    key: str,
    canonical_keys: Mapping[str, Any],
    canonical_owners: Mapping[str, str],
) -> str:
    if key in canonical_keys:
        return key
    for filename in catalog.SECTION_FILES:
        prefix = f"{filename[:-5]}."
        if key.startswith(prefix):
            unprefixed = key[len(prefix):]
            if canonical_owners.get(unprefixed) == filename:
                return unprefixed
            return key
    return key


def _read_imports(paths: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    canonical_records, canonical_owners = catalog.load_records()
    merged: Dict[str, Dict[str, Any]] = {}
    owners: Dict[str, str] = {}
    for path in _input_files(paths):
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            raise catalog.CatalogError(f"{path}: root must be an object")
        for key, record in data.items():
            normalized_key = _normalize_import_key(
                key, canonical_records, canonical_owners
            )
            if normalized_key in merged:
                raise catalog.CatalogError(
                    f"duplicate import key {normalized_key!r} in "
                    f"{owners[normalized_key]} and {path}"
                )
            if not isinstance(record, dict):
                raise catalog.CatalogError(f"{path}:{key}: record must be an object")
            merged[normalized_key] = record
            owners[normalized_key] = path
    return merged


def _import_source_languages(
    language: str,
    imported: Mapping[str, Mapping[str, Any]],
) -> Tuple[str, ...]:
    sources: List[str] = []
    for record in imported.values():
        for field in record:
            if field in {language, "comment"}:
                continue
            if field not in sources:
                sources.append(field)
    if not sources:
        raise catalog.CatalogError("the import package contains no source languages")
    _validate_language_selection(language, sources)
    return tuple(sources)


def _expected_records(
    language: str,
    sources: Sequence[str],
    sections: Sequence[str],
) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for filename in sections:
        result.update(_export_records(language, sources, (filename,)))
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
    sources = _import_source_languages(language, imported)
    expected = _expected_records(language, sources, sections)
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
        missing_fields = sorted(set(canonical_export) - set(record))
        extra_fields = sorted(set(record) - set(canonical_export))
        if missing_fields or extra_fields:
            messages = []
            if missing_fields:
                messages.append(f"missing fields: {', '.join(missing_fields)}")
            if extra_fields:
                messages.append(f"unexpected fields: {', '.join(extra_fields)}")
            raise catalog.CatalogError(f"{key}: {'; '.join(messages)}")
        for source_language in sources:
            if source_language not in canonical_export:
                continue
            if record[source_language] != canonical_export[source_language]:
                raise catalog.CatalogError(
                    f"{key}: {source_language} source text was changed"
                )
        if record.get("comment") != canonical_export.get("comment"):
            raise catalog.CatalogError(f"{key}: localization comment was changed")
        source_language = (
            catalog.SOURCE_LANGUAGE
            if catalog.SOURCE_LANGUAGE in canonical_export
            else next(item for item in sources if item in canonical_export)
        )
        source = canonical_export[source_language]
        translated = record.get(language)
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
    _, owners = catalog.load_records()
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
    result = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = result.add_subparsers(dest="command", required=True)

    export = commands.add_parser("export", help="create a source-to-target translation package")
    export.add_argument("language", help="target locale code, for example de")
    export.add_argument(
        "--source-languages",
        action="append",
        required=True,
        help="existing source locale codes; repeat or use commas, for example en,ru",
    )
    export.add_argument("--section", action="append", help="section name; repeat or use commas")
    export.add_argument(
        "--merge",
        action="store_true",
        help="merge sections into one JSON file and prefix every key with its section",
    )
    export.add_argument("--output", help="output directory, or output file with --merge")
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
