import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

# The CLI and these tests need Pillow, which lives in tools/album/requirements.txt rather
# than the site build's dependencies, so a site-only checkout skips them. Any run that gates
# a deploy sets ALBUM_TESTS_REQUIRED so a missing Pillow fails loudly instead of passing
# with the whole file silently skipped.
try:
    from PIL import Image
except ModuleNotFoundError as missing_pillow:  # pragma: no cover - environment dependent
    message = f"album CLI tests need Pillow: {missing_pillow}"
    if os.getenv("ALBUM_TESTS_REQUIRED"):
        raise RuntimeError(f"{message}; install tools/album/requirements.txt") from missing_pillow
    raise unittest.SkipTest(message)


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "album" / "album.py"
SPEC = importlib.util.spec_from_file_location("album_cli", MODULE_PATH)
album = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = album
SPEC.loader.exec_module(album)


class AlbumCliTests(unittest.TestCase):
    def publish_env(self, target="staging"):
        return {
            "ALBUM_ENVIRONMENT": target,
            "ALBUM_BASE_URL": "https://stage.example" if target == "staging" else "https://upscales.app",
            "CLOUDFLARE_ACCOUNT_ID": "account",
            "CLOUDFLARE_D1_DATABASE_ID": target,
            "R2_BUCKET_NAME": target,
        }

    def make_album(self, folder: Path, count: int = 1):
        photos = []
        for index in range(count):
            before = folder / f"{index}-before.jpg"
            after = folder / f"{index}-after.jpg"
            Image.new("RGB", (96, 72), (30 + index, 45, 60)).save(before, quality=90)
            Image.new("RGB", (96, 72), (180, 150 + index, 120)).save(after, quality=90)
            photos.append({"before": before.name, "after": after.name, "alt": f"Photo {index + 1}"})
        manifest = {
            "title": "Example album", "note": None, "featured": False,
            "rights_confirmed": True, "photos": photos,
        }
        (folder / "album.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def test_ids_are_130_bit_crockford_values(self):
        values = {album.crockford_id() for _ in range(100)}
        self.assertEqual(len(values), 100)
        self.assertTrue(all(re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", value) for value in values))

    def test_price_tiers_and_override(self):
        self.assertEqual([album.price_cents(count, None) for count in (1, 2, 4, 5, 20)], [300, 500, 500, 800, 800])
        self.assertEqual(album.price_cents(20, "6.25"), 625)
        with self.assertRaises(album.AlbumError):
            album.price_cents(1, "1.999")

    def test_manifest_requires_rights_and_one_input_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = self.make_album(folder)
            validated = album.validate_manifest(folder, manifest)
            self.assertEqual(len(validated), 1)
            manifest["rights_confirmed"] = False
            with self.assertRaises(album.AlbumError):
                album.validate_manifest(folder, manifest)

    def test_state_is_stable_across_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            photos = album.validate_manifest(folder, self.make_album(folder, 2))
            first = album.initialize_state(folder, photos)
            second = album.initialize_state(folder, photos)
            self.assertEqual(first["album_id"], second["album_id"])
            self.assertEqual([p["id"] for p in first["photos"]], [p["id"] for p in second["photos"]])

    def test_processing_params_are_part_of_resume_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = self.make_album(folder)
            manifest["photos"][0].pop("after")
            manifest["photos"][0]["flow"] = "restore-and-upscale"
            manifest["photos"][0]["params"] = {"target_resolution": "4k", "creativity": 0}
            photos = album.validate_manifest(folder, manifest)
            state = album.initialize_state(folder, photos)
            self.assertIn(state["photos"][0]["params_sha256"], state["photos"][0]["idempotency_key"])
            manifest["photos"][0]["params"]["creativity"] = 1
            changed = album.validate_manifest(folder, manifest)
            with self.assertRaises(album.AlbumError):
                album.initialize_state(folder, changed)

    def test_r2_delete_errors_are_not_silently_ignored(self):
        class FailingS3:
            def delete_objects(self, **_):
                return {"Errors": [{"Key": "albums/example/clean.jpg", "Code": "InternalError"}]}

        admin = object.__new__(album.CloudflareAdmin)
        admin.s3 = FailingS3()
        admin.bucket = "test"
        with self.assertRaises(album.AlbumError):
            admin.delete_keys(["albums/example/clean.jpg"])

    def test_album_delete_removes_the_gallery_preview(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        admin = mock.Mock()
        admin.query.return_value = [{
            "cover_key": f"albums/{album_id}/cover.jpg",
            "gallery_key": f"albums/{album_id}/gallery-v1.jpg",
            "zip_key": None,
            "before_key": f"albums/{album_id}/photo/before.webp",
            "after_key": f"albums/{album_id}/photo/after.webp",
            "clean_key": f"albums/{album_id}/photo/clean.jpg",
        }]
        admin.execute.return_value = 1
        with mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            result = album.delete_album(album_id)
        self.assertEqual(result["deleted_objects"], 5)
        deleted = admin.delete_keys.call_args.args[0]
        self.assertIn(f"albums/{album_id}/gallery-v1.jpg", deleted)

    def test_media_is_reencoded_without_exif_and_single_photo_has_no_zip(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = self.make_album(folder)
            before = folder / "0-before.jpg"
            image = Image.new("RGB", (120, 80), "navy")
            exif = image.getexif()
            exif[315] = "private author"
            image.save(before, exif=exif)
            photos = album.validate_manifest(folder, manifest)
            state = album.initialize_state(folder, photos)
            media = album.prepare_media(folder, photos, state)
            record = media[state["photos"][0]["id"]]["before"]
            with Image.open(record["path"]) as prepared:
                self.assertFalse(prepared.getexif())
            self.assertTrue(Path(state["cover"]["path"]).is_file())
            with Image.open(state["gallery"]["path"]) as gallery:
                self.assertEqual(gallery.format, "JPEG")
                self.assertEqual(gallery.size, (1280, 960))
                self.assertFalse(gallery.getexif())
            self.assertTrue(state["gallery"]["key"].endswith("/gallery-v1.jpg"))
            self.assertIsNone(state["zip"])

    def test_gallery_preview_crops_each_half_before_applying_watermark(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            before = folder / "before.webp"
            clean = folder / "clean.jpg"
            output = folder / "gallery.jpg"
            Image.new("RGB", (1200, 400), "red").save(before, "WEBP")
            Image.new("RGB", (400, 1200), "green").save(clean, "JPEG")
            media = {
                "before": {"path": str(before)},
                "after": {"key": "albums/example/photo/after-wm.webp"},
                "clean": {"path": str(clean)},
            }

            def blue_watermark(image, **_kwargs):
                self.assertEqual(image.size, (640, 960))
                return Image.new("RGB", image.size, "blue")

            with mock.patch.object(album, "add_watermark", side_effect=blue_watermark) as watermark:
                album.make_gallery_preview(media, output)
            watermark.assert_called_once()
            with Image.open(output) as gallery:
                self.assertEqual(gallery.size, (1280, 960))
                self.assertGreater(gallery.getpixel((100, 480))[0], 200)
                self.assertGreater(gallery.getpixel((1100, 480))[2], 200)

    def test_unlock_is_idempotent(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        admin = mock.Mock()
        admin.execute.return_value = 0
        admin.query.return_value = [{"state": "unlocked"}]
        with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            result = album.update_album(album_id, "unlock")
        self.assertTrue(result["reused"])
        self.assertEqual(result["state"], "unlocked")

    def test_production_supports_manual_locked_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.make_album(folder)
            admin = mock.Mock()
            admin.query.return_value = []
            with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=admin):
                result = album.publish(folder, unlocked=False, price_override="0")
            self.assertEqual(result["state"], "locked")
            self.assertEqual(result["url"], f"https://upscales.app/gallery/{result['album_id']}")
            admin.batch.assert_called_once()
            album_params = admin.batch.call_args.args[0][0][1]
            self.assertTrue(album_params[13].endswith("/gallery-v1.jpg"))
            self.assertEqual(album_params[15:17], (1280, 960))
            photo_params = admin.batch.call_args.args[0][1][1]
            self.assertTrue(photo_params[8].endswith("/after-wm.webp"))

    def test_unlocked_publish_uses_clean_preview(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.make_album(folder)
            admin = mock.Mock()
            admin.query.return_value = []
            with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=admin):
                result = album.publish(folder, unlocked=True, price_override=None)
            self.assertEqual(result["state"], "unlocked")
            photo_params = admin.batch.call_args.args[0][1][1]
            self.assertTrue(photo_params[8].endswith("/after.webp"))
            preview = Path(json.loads((folder / album.STATE_NAME).read_text())["photos"][0]["media"]["after"]["path"])
            self.assertEqual(preview.name, "after.webp")

    def test_soft_watermark_can_include_app_badge(self):
        with tempfile.TemporaryDirectory() as directory:
            logo_path = Path(directory) / "logo.png"
            Image.new("RGBA", (120, 40), (50, 80, 220, 255)).save(logo_path)
            source = Image.new("RGB", (800, 600), (120, 120, 120))
            result = album.add_watermark(source, logo_path=logo_path)
            self.assertEqual(result.size, source.size)
            self.assertNotEqual(result.getpixel((770, 570)), source.getpixel((770, 570)))

    def test_prepared_media_is_reused_and_zip_has_fixed_timestamps(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            photos = album.validate_manifest(folder, self.make_album(folder, 2))
            state = album.initialize_state(folder, photos)
            album.prepare_media(folder, photos, state)
            hashes = [r["sha256"] for r in album.all_records(state)]
            with mock.patch.object(album, "save_image", side_effect=AssertionError("must reuse")):
                album.prepare_media(folder, photos, state)
            self.assertEqual(hashes, [r["sha256"] for r in album.all_records(state)])
            original_zip = state["zip"]["sha256"]
            for photo in state["photos"]:
                os.utime(photo["media"]["clean"]["path"], (1900000000, 1900000000))
            state["zip"] = None
            album.prepare_media(folder, photos, state)
            self.assertEqual(original_zip, state["zip"]["sha256"])
            with zipfile.ZipFile(state["zip"]["path"]) as archive:
                self.assertTrue(all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist()))

    def test_changed_after_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = self.make_album(folder)
            album.initialize_state(folder, album.validate_manifest(folder, manifest))
            Image.new("RGB", (96, 72), "red").save(folder / "0-after.jpg")
            with self.assertRaisesRegex(album.AlbumError, "after changed"):
                album.initialize_state(folder, album.validate_manifest(folder, manifest))

    def test_resume_after_upload_and_d1_failure_then_publish_other_environment(self):
        class FakeAdmin:
            def __init__(self):
                self.objects = {}
                self.row = None
                self.fail_batch = True
            def upload(self, record):
                previous = self.objects.setdefault(record["key"], record["sha256"])
                if previous != record["sha256"]:
                    raise album.AlbumError("immutable collision")
            def query(self, sql, params=()):
                if "COUNT" in sql:
                    return [{"count": self.row["photo_count"]}]
                return [self.row] if self.row else []
            def batch(self, statements):
                if self.fail_batch:
                    self.fail_batch = False
                    raise album.AlbumError("D1 disconnected")
                self.row = {"state": "unlocked", "photo_count": len(statements) - 1}

        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.make_album(folder, 20)
            staging, production = FakeAdmin(), FakeAdmin()
            production.fail_batch = False
            with mock.patch.dict(os.environ, self.publish_env()), mock.patch.object(album, "CloudflareAdmin", return_value=staging):
                with self.assertRaisesRegex(album.AlbumError, "D1 disconnected"):
                    album.publish(folder, True, None)
                with mock.patch.object(album, "save_image", side_effect=AssertionError("must reuse")):
                    staging_result = album.publish(folder, True, None)
                self.assertTrue(staging_result["url"].startswith("https://stage.example/gallery/"))
            with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=production):
                with mock.patch.object(album, "save_image", side_effect=AssertionError("must reuse")):
                    production_result = album.publish(folder, True, None)
            self.assertTrue(production_result["url"].startswith("https://upscales.app/gallery/"))
            self.assertEqual(staging.objects, production.objects)
            self.assertEqual(len(staging.objects), 63)
            state = json.loads((folder / album.STATE_NAME).read_text())
            self.assertEqual(len(state["publications"]), 2)

    def test_publishing_to_a_relabelled_destination_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            state = album.initialize_state(folder, album.validate_manifest(folder, self.make_album(folder)))
            with mock.patch.dict(os.environ, self.publish_env()):
                target = album.publication_target()
            album.publication_state(folder, state, target)
            with self.assertRaisesRegex(album.AlbumError, "URL/environment changed"):
                album.publication_state(folder, state, dict(target, environment="production"))
            with self.assertRaisesRegex(album.AlbumError, "must change together"):
                album.publication_state(folder, state, dict(target, bucket="other-bucket"))

    def test_resume_recognizes_d1_commit_after_response_was_lost(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.make_album(folder)
            admin = mock.Mock()
            admin.query.side_effect = [[], [{"state": "unlocked", "photo_count": 1}], [{"count": 1}]]
            admin.batch.side_effect = album.AlbumError("D1 response lost after commit")
            with mock.patch.dict(os.environ, self.publish_env()), mock.patch.object(album, "CloudflareAdmin", return_value=admin), mock.patch("sys.stdout", io.StringIO()):
                with self.assertRaisesRegex(album.AlbumError, "response lost"):
                    album.publish(folder, True, None)
                uploaded = admin.upload.call_count
                album.publish(folder, True, None)
                self.assertEqual(admin.upload.call_count, uploaded)
                admin.batch.assert_called_once()

    def test_gc_retains_active_and_in_progress_uploads(self):
        admin = mock.Mock()
        admin.bucket = "test"
        admin.query.return_value = [{"id": "active", "state": "unlocked"}, {"id": "removed", "state": "deleted"}]
        admin.s3.list_objects_v2.return_value = {"Contents": [
            {"Key": "albums/active/cover.jpg"}, {"Key": "albums/removed/cover.jpg"},
            {"Key": "albums/uploading/cover.jpg"},
        ]}
        with mock.patch.object(album, "CloudflareAdmin", return_value=admin), mock.patch("sys.stdout", io.StringIO()):
            album.gc_albums(True)
        admin.delete_keys.assert_called_once_with(["albums/removed/cover.jpg"])


if __name__ == "__main__":
    unittest.main()
