"""Load the sectioned, iOS-style localization catalog.

Catalog records are flat, while the site renderer still consumes nested dicts.
This module is the single bridge between those two representations.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Set, Tuple


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG_DIR = os.path.join(ROOT, "localization")
SOURCE_LANGUAGE = "en"
SECTION_FILES = (
    "common.json",
    "home.json",
    "guides.json",
    "compare.json",
    "legal.json",
    "support.json",
)


class CatalogError(ValueError):
    """Raised when localization data is incomplete or structurally invalid."""


def _read_section(filename: str) -> Dict[str, Dict[str, Any]]:
    path = os.path.join(CATALOG_DIR, filename)
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise CatalogError(f"{filename}: catalog root must be an object")
    return data


def load_records() -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    """Return all records and the section owning each globally unique key."""
    records: Dict[str, Dict[str, Any]] = {}
    owners: Dict[str, str] = {}
    for filename in SECTION_FILES:
        for key, record in _read_section(filename).items():
            if key in records:
                raise CatalogError(
                    f"duplicate localization key {key!r} in {owners[key]} and {filename}"
                )
            if not isinstance(record, dict):
                raise CatalogError(f"{filename}:{key}: record must be an object")
            localizations = record.get("localizations")
            if not isinstance(localizations, dict) or SOURCE_LANGUAGE not in localizations:
                # Russian-only variant records are allowed, but they must be explicitly scoped.
                if not isinstance(localizations, dict) or "locales" not in record:
                    raise CatalogError(
                        f"{filename}:{key}: localizations must include {SOURCE_LANGUAGE!r}"
                    )
            records[key] = record
            owners[key] = filename
    return records, owners


def _assign(container: Any, parts: List[str], value: Any, full_key: str) -> Any:
    """Assign a dotted path, creating dicts/lists as required."""
    if not parts:
        return value
    head, tail = parts[0], parts[1:]
    is_index = head.isdigit()
    if is_index:
        index = int(head)
        if container is None:
            container = []
        if not isinstance(container, list):
            raise CatalogError(f"{full_key}: path mixes object and array containers")
        while len(container) <= index:
            container.append(None)
        container[index] = _assign(container[index], tail, value, full_key)
        return container
    if container is None:
        container = {}
    if not isinstance(container, dict):
        raise CatalogError(f"{full_key}: path mixes array and object containers")
    container[head] = _assign(container.get(head), tail, value, full_key)
    return container


def _compact(value: Any) -> Any:
    """Remove omitted locale-only array entries without touching meaningful values."""
    if isinstance(value, list):
        return [_compact(item) for item in value if item is not None]
    if isinstance(value, dict):
        return {key: _compact(item) for key, item in value.items()}
    return value


def load_locale(locale: str, require_complete: bool = False) -> Dict[str, Any]:
    """Build the nested renderer payload for ``locale`` from the flat catalog."""
    records, _ = load_records()
    result: Any = {}
    missing: List[str] = []
    for key, record in records.items():
        localizations = record["localizations"]
        scoped_locales = record.get("locales")
        if scoped_locales is not None and locale not in scoped_locales:
            continue
        if locale in record.get("excludedLocales", ()):
            continue
        if locale in localizations:
            value = localizations[locale]
        elif record.get("shouldTranslate") is False and SOURCE_LANGUAGE in localizations:
            value = localizations[SOURCE_LANGUAGE]
        else:
            if require_complete and SOURCE_LANGUAGE in localizations:
                missing.append(key)
            continue
        result = _assign(result, key.split("."), value, key)
    if missing:
        preview = ", ".join(missing[:8])
        suffix = "..." if len(missing) > 8 else ""
        raise CatalogError(f"{locale}: missing {len(missing)} translations: {preview}{suffix}")
    result = _compact(result)
    result["lang"] = locale
    result.setdefault("dir", "rtl" if locale in {"ar", "he", "fa", "ur"} else "ltr")
    return result


def available_locales() -> Tuple[str, ...]:
    """Languages represented in every section file.

    Import is atomic, so a newly translated locale only appears here after every
    exported key has been written back successfully.
    """
    common: Optional[Set[str]] = None
    for filename in SECTION_FILES:
        locales: Set[str] = set()
        for record in _read_section(filename).values():
            locales.update(record.get("localizations", {}).keys())
        common = locales if common is None else common & locales
    return tuple(sorted(common or {SOURCE_LANGUAGE}))


def section_records(filename: str) -> Dict[str, Dict[str, Any]]:
    if filename not in SECTION_FILES:
        raise CatalogError(f"unknown localization section {filename!r}")
    return _read_section(filename)
