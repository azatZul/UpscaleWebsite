import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "build"))

import localization_catalog as catalog
import localize


class CatalogTests(unittest.TestCase):
    def test_catalog_has_unique_keys_and_expected_sections(self):
        records, owners = catalog.load_records()
        self.assertEqual(set(owners.values()), set(catalog.SECTION_FILES))
        self.assertGreater(len(records), 900)
        self.assertEqual(len(records), len(owners))

    def test_english_and_russian_renderer_payloads_are_complete(self):
        for locale in ("en", "ru"):
            data = catalog.load_locale(locale)
            self.assertEqual(data["lang"], locale)
            self.assertEqual(len(data["guide_pages"]), 10)
            self.assertEqual(len(data["docs"]), 3)
            self.assertIn("sale", data)
            self.assertIn("compare", data)

    def test_export_is_flat_and_contains_source_comment_and_empty_target(self):
        exported = localize._export_records("de", ("home.json",))
        self.assertGreater(len(exported), 100)
        self.assertTrue(all("localizations" in value for value in exported.values()))
        sample = exported["hero.h1"]
        self.assertIn("en", sample["localizations"])
        self.assertIsNone(sample["localizations"]["de"])
        self.assertIn("comment", sample)

    def test_split_export_writes_every_section(self):
        with tempfile.TemporaryDirectory() as directory:
            args = type("Args", (), {
                "language": "de", "section": None, "split": True, "output": directory,
            })()
            localize.command_export(args)
            self.assertEqual(
                {path.name for path in Path(directory).glob("*.json")},
                set(catalog.SECTION_FILES),
            )

    def test_translation_validation_preserves_placeholders_and_html(self):
        localize._validate_translation("sample", "Hello {name} <em>now</em>",
                                       "Hallo {name} <em>jetzt</em>")
        with self.assertRaises(catalog.CatalogError):
            localize._validate_translation("sample", "Hello {name}", "Hallo")
        with self.assertRaises(catalog.CatalogError):
            localize._validate_translation("sample", "Hello <em>now</em>", "Hallo <b>jetzt</b>")

    def test_import_validation_rejects_changed_source_or_comment(self):
        expected = localize._export_records("de", ("common.json",))
        translated = json.loads(json.dumps(expected))
        for record in translated.values():
            record["localizations"]["de"] = record["localizations"]["en"]
        first_key = next(iter(translated))
        translated[first_key]["localizations"]["en"] += " changed"
        with self.assertRaises(catalog.CatalogError):
            localize._validated_updates("de", translated, ("common.json",))

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
                exported = localize._export_records("de", catalog.SECTION_FILES)
                for record in exported.values():
                    record["localizations"]["de"] = record["localizations"]["en"]
                package.write_text(json.dumps(exported, ensure_ascii=False), encoding="utf-8")
                args = type("Args", (), {
                    "language": "de", "inputs": [str(package)], "section": None,
                })()
                localize.command_import(args)
                self.assertIn("de", catalog.available_locales())
                self.assertEqual(catalog.load_locale("de", require_complete=True)["lang"], "de")
            finally:
                catalog.CATALOG_DIR = original_catalog_dir


if __name__ == "__main__":
    unittest.main()
