import json
import os
import re
from pathlib import Path
import shutil
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))

import localization_catalog as catalog
import localize
import build as site_build


class CatalogTests(unittest.TestCase):
    def test_catalog_has_unique_keys_and_expected_sections(self):
        records, owners = catalog.load_records()
        self.assertEqual(set(owners.values()), set(catalog.SECTION_FILES))
        self.assertGreater(len(records), 900)
        self.assertEqual(len(records), len(owners))

    def test_renderer_payloads_are_complete(self):
        for locale in ("en", "ru", "de", "ja", "fr"):
            data = catalog.load_locale(locale)
            self.assertEqual(data["lang"], locale)
            self.assertEqual(len(data["guide_pages"]), 10)
            self.assertEqual(len(data["docs"]), 3)
            self.assertIn("sale", data)
            self.assertIn("compare", data)

    def test_export_is_flat_and_contains_selected_sources_comment_and_empty_target(self):
        exported = localize._export_records("de", ("en", "ru"), ("home.json",))
        self.assertGreater(len(exported), 100)
        sample = exported["hero.h1"]
        self.assertEqual(tuple(sample), ("en", "ru", "de", "comment"))
        self.assertIsNone(sample["de"])

        compare = localize._export_records("de", ("en", "ru"), ("compare.json",))
        self.assertEqual(set(compare["compare.table_h"]), {"en", "de"})
        self.assertNotIn("compare.tests.0.id", compare)
        self.assertEqual(
            set(compare["compare.crop_alt"]),
            {"en", "ru", "de", "comment"},
        )
        self.assertIsNone(compare["compare.crop_alt"]["de"])

    def test_dynamic_facts_use_each_locale_own_numbers_and_currency(self):
        # The rating count is refreshed from the App Store, so take it from the
        # facts file and assert only the grouping separator each locale uses.
        digits = str(site_build.RATING_COUNT)
        self.assertEqual(len(digits), 4, "regroup the expectations below")
        grouped = {"en": ",", "fr": "\u00a0", "de": ".", "ru": "\u00a0", "ja": ","}
        template = "{rating_count} · {annual_price} · {off}"
        self.assertEqual(
            site_build.inject_facts(template, "en"),
            f"{digits[0]}{grouped['en']}{digits[1:]} · $39.99 · 25%",
        )
        # France and Germany share the euro tier but not the grouping mark.
        self.assertEqual(
            site_build.inject_facts(template, "fr"),
            f"{digits[0]}{grouped['fr']}{digits[1:]} · 44,99\u00a0\u20ac · 25\u00a0%",
        )
        self.assertEqual(
            site_build.inject_facts(template, "de"),
            f"{digits[0]}{grouped['de']}{digits[1:]} · 44,99\u00a0\u20ac · 25\u00a0%",
        )
        self.assertEqual(
            site_build.inject_facts(template, "ru"),
            f"{digits[0]}{grouped['ru']}{digits[1:]} · 3\u00a0490\u00a0\u20bd · 25%",
        )
        # Japanese groups and points like English, so only the currency differs.
        self.assertEqual(
            site_build.inject_facts(template, "ja"),
            f"{digits[0]}{grouped['ja']}{digits[1:]} · \u00a56,000 · 25%",
        )

    def test_rating_uses_the_locale_decimal_mark(self):
        self.assertEqual(site_build.rating_text("en"), "4.6")
        self.assertEqual(site_build.rating_text("ja"), "4.6")
        self.assertEqual(site_build.rating_text("fr"), "4,6")
        self.assertEqual(site_build.rating_text("de"), "4,6")
        self.assertEqual(site_build.rating_text("ru"), "4,6")

    def test_locale_without_own_prices_falls_back_to_the_reference_currency(self):
        self.assertEqual(site_build.locale_pricing("es"), site_build._PRICING["default"])

    def test_app_store_badge_reads_the_way_apple_sets_the_phrase(self):
        """The badge artwork carries no text, so this is its accessible name.

        Japanese leads with the service mark, and French elides the article onto
        it — "Télécharger dans l’ App Store" would be read out with a gap that
        Apple's own artwork does not have.
        """
        expected = {
            "en": "Download on the App Store",
            "fr": "Télécharger dans l’App Store",
            "de": "Laden im App Store",
            "ru": "Загрузите в App Store",
            "ja": "App Storeからダウンロード",
        }
        for locale, label in expected.items():
            button = site_build.appstore_btn(catalog.load_locale(locale))
            self.assertIn(f'aria-label="{label}"', button, locale)

    def test_translations_name_app_features_in_their_own_language(self):
        """Guides must not tell a translated reader to tap an English label.

        Every one of these is localized in the app itself
        (Upscaler/Upscaler/Resources/Localizable.xcstrings), so quoting the
        English name would send the reader looking for a control that is not
        there.
        """
        english_only = (
            "Upscale your media", "Creative Upscale", "Regular Upscale",
            "Face Enhancer", "Photo restoration", "Photo Restoration",
            "Enhanced Colorize", "Restore & Colorize", "Advanced Fix",
            "Slow Motion", "Increase FPS", "Enlighten", "Upscale video",
            "Upscale Video", "Enhance animation", "Enhance Animation",
            "Smoothed", "Natural", "Increased resolution",
        )
        records, _ = catalog.load_records()
        offenders = [
            f"{key}[{locale}]: {label}"
            for key, record in records.items()
            for locale, text in record["localizations"].items()
            if locale in ("de", "ru", "ja", "fr") and isinstance(text, str)
            for label in english_only
            if re.search(rf"(?<![\w\u201e\u00ab-]){re.escape(label)}(?![\w\u201c\u00bb])", text)
        ]
        self.assertEqual(offenders, [])

    def test_compact_json_has_no_formatting_whitespace_or_trailing_newline(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.json"
            localize._write_json(
                str(path),
                {"some_key": {"en": "Some text", "de": None}},
            )
            self.assertEqual(
                path.read_text(encoding="utf-8"),
                '{"some_key":{"en":"Some text","de":null}}',
            )

    def test_split_export_writes_every_section(self):
        with tempfile.TemporaryDirectory() as directory:
            args = type("Args", (), {
                "language": "de", "source_languages": ["en,ru"],
                "section": None, "merge": False, "output": directory,
            })()
            localize.command_export(args)
            self.assertEqual(
                {path.name for path in Path(directory).glob("*.json")},
                set(catalog.SECTION_FILES),
            )
            raw = (Path(directory) / "home.json").read_text(encoding="utf-8")
            self.assertFalse(raw.endswith("\n"))
            self.assertIn('"hero.h1":{"en":', raw)

    def test_merged_export_prefixes_every_key_with_its_section(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "de.json"
            args = type("Args", (), {
                "language": "de", "source_languages": ["en", "ru"],
                "section": None, "merge": True, "output": str(output),
            })()
            localize.command_export(args)
            data = json.loads(output.read_text(encoding="utf-8"))
            prefixes = {filename[:-5] for filename in catalog.SECTION_FILES}
            self.assertTrue(all(key.split(".", 1)[0] in prefixes for key in data))
            self.assertIn("home.hero.h1", data)
            self.assertNotIn("hero.h1", data)

    def test_merged_import_only_removes_the_correct_section_prefix(self):
        records, owners = catalog.load_records()
        self.assertEqual(
            localize._normalize_import_key("home.hero.h1", records, owners),
            "hero.h1",
        )
        self.assertEqual(
            localize._normalize_import_key("home.nav.menu", records, owners),
            "home.nav.menu",
        )

    def test_export_rejects_unknown_or_target_source_languages(self):
        with self.assertRaises(catalog.CatalogError):
            localize._validate_language_selection("de", ("xx",))
        with self.assertRaises(catalog.CatalogError):
            localize._validate_language_selection("de", ("en", "de"))

    def test_translation_validation_preserves_placeholders_and_html(self):
        localize._validate_translation("sample", "Hello {name} <em>now</em>",
                                       "Hallo {name} <em>jetzt</em>")
        with self.assertRaises(catalog.CatalogError):
            localize._validate_translation("sample", "Hello {name}", "Hallo")
        with self.assertRaises(catalog.CatalogError):
            localize._validate_translation("sample", "Hello <em>now</em>", "Hallo <b>jetzt</b>")
        localize._validate_translation(
            "sample",
            '<a href="/help" aria-label="Open help"><img src="/icon.png" alt="Help"></a>',
            '<a href="/help" aria-label="Hilfe öffnen"><img src="/icon.png" alt="Hilfe"></a>',
        )
        with self.assertRaises(catalog.CatalogError):
            localize._validate_translation(
                "sample",
                '<a href="/help">Help</a>',
                '<a href="/hilfe">Hilfe</a>',
            )

    def test_import_validation_rejects_changed_source_or_comment(self):
        expected = localize._export_records("de", ("en", "ru"), ("common.json",))
        translated = json.loads(json.dumps(expected))
        for record in translated.values():
            record["de"] = record.get("en", record.get("ru"))
        first_key = next(iter(translated))
        translated[first_key]["en"] += " changed"
        with self.assertRaises(catalog.CatalogError):
            localize._validated_updates("de", translated, ("common.json",))

        translated = json.loads(json.dumps(expected))
        for record in translated.values():
            record["de"] = record.get("en", record.get("ru"))
        comment_key = next(key for key, record in translated.items() if "comment" in record)
        translated[comment_key]["comment"] += " changed"
        with self.assertRaises(catalog.CatalogError):
            localize._validated_updates("de", translated, ("common.json",))

    def test_import_validation_rejects_null_missing_and_extra_content(self):
        expected = localize._export_records("de", ("en", "ru"), ("common.json",))
        translated = json.loads(json.dumps(expected))
        for record in translated.values():
            record["de"] = record.get("en", record.get("ru"))

        null_translation = json.loads(json.dumps(translated))
        null_translation[next(iter(null_translation))]["de"] = None
        with self.assertRaises(catalog.CatalogError):
            localize._validated_updates("de", null_translation, ("common.json",))

        missing = json.loads(json.dumps(translated))
        missing.pop(next(iter(missing)))
        with self.assertRaises(catalog.CatalogError):
            localize._validated_updates("de", missing, ("common.json",))

        extra = json.loads(json.dumps(translated))
        extra["unknown.key"] = {"en": "Text", "de": "Text"}
        with self.assertRaises(catalog.CatalogError):
            localize._validated_updates("de", extra, ("common.json",))

    def test_complete_import_is_atomic_and_activates_locale(self):
        original_catalog_dir = catalog.CATALOG_DIR
        with tempfile.TemporaryDirectory() as directory:
            temporary_catalog = Path(directory) / "localization"
            temporary_catalog.mkdir()
            for filename in catalog.SECTION_FILES:
                shutil.copy(Path(original_catalog_dir) / filename, temporary_catalog / filename)
            package = Path(directory) / "de.json"
            catalog.CATALOG_DIR = str(temporary_catalog)
            try:
                exported = localize._export_records(
                    "de", ("en", "ru"), catalog.SECTION_FILES
                )
                for record in exported.values():
                    record["de"] = record.get("en", record.get("ru"))
                package.write_text(json.dumps(exported, ensure_ascii=False), encoding="utf-8")
                args = type("Args", (), {
                    "language": "de", "inputs": [str(package)], "section": None,
                })()
                localize.command_import(args)
                self.assertIn("de", catalog.available_locales())
                self.assertEqual(catalog.load_locale("de", require_complete=True)["lang"], "de")
            finally:
                catalog.CATALOG_DIR = original_catalog_dir

    def test_complete_merged_import_removes_section_prefixes(self):
        original_catalog_dir = catalog.CATALOG_DIR
        with tempfile.TemporaryDirectory() as directory:
            temporary_catalog = Path(directory) / "localization"
            temporary_catalog.mkdir()
            for filename in catalog.SECTION_FILES:
                shutil.copy(Path(original_catalog_dir) / filename, temporary_catalog / filename)
            catalog.CATALOG_DIR = str(temporary_catalog)
            try:
                section_data = {
                    filename: localize._export_records(
                        "de", ("en", "ru"), (filename,)
                    )
                    for filename in catalog.SECTION_FILES
                }
                merged = localize._prefixed_records(catalog.SECTION_FILES, section_data)
                for record in merged.values():
                    record["de"] = record.get("en", record.get("ru"))
                package = Path(directory) / "de.json"
                package.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
                args = type("Args", (), {
                    "language": "de", "inputs": [str(package)], "section": None,
                })()
                localize.command_import(args)
                self.assertEqual(
                    catalog.load_locale("de", require_complete=True)["hero"]["before"],
                    catalog.load_locale("en", require_complete=True)["hero"]["before"],
                )
            finally:
                catalog.CATALOG_DIR = original_catalog_dir

    def test_failed_import_does_not_modify_catalog_files(self):
        original_catalog_dir = catalog.CATALOG_DIR
        with tempfile.TemporaryDirectory() as directory:
            temporary_catalog = Path(directory) / "localization"
            temporary_catalog.mkdir()
            for filename in catalog.SECTION_FILES:
                shutil.copy(Path(original_catalog_dir) / filename, temporary_catalog / filename)
            before = {
                filename: (temporary_catalog / filename).read_text(encoding="utf-8")
                for filename in catalog.SECTION_FILES
            }
            catalog.CATALOG_DIR = str(temporary_catalog)
            try:
                exported = localize._export_records(
                    "de", ("en", "ru"), catalog.SECTION_FILES
                )
                package = Path(directory) / "incomplete.json"
                package.write_text(json.dumps(exported, ensure_ascii=False), encoding="utf-8")
                args = type("Args", (), {
                    "language": "de", "inputs": [str(package)], "section": None,
                })()
                with self.assertRaises(catalog.CatalogError):
                    localize.command_import(args)
                after = {
                    filename: (temporary_catalog / filename).read_text(encoding="utf-8")
                    for filename in catalog.SECTION_FILES
                }
                self.assertEqual(after, before)
            finally:
                catalog.CATALOG_DIR = original_catalog_dir


if __name__ == "__main__":
    unittest.main()
