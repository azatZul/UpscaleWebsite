import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
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

    def test_r2_upload_reuses_matching_object_without_sha256_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "gallery-v2.jpg"
            Image.new("RGB", (960, 720), "teal").save(source, "JPEG")
            record = album.file_record(album.inspect_image(source), "albums/example/gallery-v2.jpg")
            admin = object.__new__(album.CloudflareAdmin)
            admin.bucket = "test"
            admin.s3 = mock.Mock()
            admin.s3.head_object.return_value = {"Metadata": {}}
            admin.download = mock.Mock(side_effect=lambda _key, destination: shutil.copyfile(source, destination))

            admin.upload(record)

            admin.download.assert_called_once()
            admin.s3.upload_file.assert_not_called()

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
                self.assertEqual(gallery.size, (960, 720))
                self.assertFalse(gallery.getexif())
            self.assertTrue(state["gallery"]["key"].endswith("/gallery-v2.jpg"))
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
                self.assertEqual(image.size, (480, 720))
                return Image.new("RGB", image.size, "blue")

            with mock.patch.object(album, "add_watermark", side_effect=blue_watermark) as watermark:
                album.make_gallery_preview(media, output)
            watermark.assert_called_once()
            with Image.open(output) as gallery:
                self.assertEqual(gallery.size, (960, 720))
                self.assertGreater(gallery.getpixel((100, 360))[0], 200)
                self.assertGreater(gallery.getpixel((800, 360))[2], 200)

    def test_legacy_local_gallery_is_rebuilt_for_the_current_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            photos = album.validate_manifest(folder, self.make_album(folder))
            state = album.initialize_state(folder, photos)
            media = album.prepare_media(folder, photos, state)
            legacy_path = folder / album.WORK_NAME / "gallery-v1.jpg"
            Image.new("RGB", album.LEGACY_GALLERY_SIZE, "purple").save(legacy_path, "JPEG")
            legacy_key = f"albums/{state['album_id']}/gallery-v1.jpg"
            state["gallery"] = album.file_record(album.inspect_image(legacy_path), legacy_key)
            album.save_state(folder, state)

            upgraded = album.ensure_gallery_preview(folder, state, media)

            self.assertEqual(upgraded["key"], f"albums/{state['album_id']}/gallery-v2.jpg")
            self.assertEqual((upgraded["width"], upgraded["height"]), (960, 720))
            self.assertTrue(legacy_path.is_file())

    def test_unlock_is_idempotent(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        admin = mock.Mock()
        admin.execute.return_value = 0
        admin.query.return_value = [{"state": "unlocked"}]
        with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            result = album.update_album(album_id, "unlock")
        self.assertTrue(result["reused"])
        self.assertEqual(result["state"], "unlocked")

    def test_rename_updates_the_title_and_is_idempotent(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        admin = mock.Mock()
        admin.execute.return_value = 1
        with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            result = album.update_album(album_id, "rename", "  Restored family portrait  ")
        self.assertEqual(result["title"], "Restored family portrait")
        self.assertFalse(result["reused"])
        self.assertEqual(admin.execute.call_args.args[1], ("Restored family portrait", album_id))

        admin.execute.return_value = 0
        admin.query.return_value = [{"state": "unlocked", "featured": 1, "title": "Restored family portrait"}]
        with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            repeated = album.update_album(album_id, "rename", "Restored family portrait")
        self.assertTrue(repeated["reused"])

        for invalid in (None, "", "   ", "x" * 161):
            with self.assertRaises(album.AlbumError):
                album.update_album(album_id, "rename", invalid)

    def test_list_json_reports_urls_and_skips_deleted_albums(self):
        admin = mock.Mock()
        admin.query.return_value = [
            {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "title": "Old family photo", "state": "unlocked",
             "featured": 1, "photo_count": 2, "created_at": 10},
            {"id": "01ARZ3NDEKTSV4RRFFQ69G5FAW", "title": "Removed", "state": "deleted",
             "featured": 0, "photo_count": 1, "created_at": 9},
        ]
        with mock.patch.dict(os.environ, self.publish_env("production")), mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            payload = album.list_albums(as_json=True)
        self.assertTrue(payload["ok"])
        self.assertEqual([item["id"] for item in payload["albums"]], ["01ARZ3NDEKTSV4RRFFQ69G5FAV"])
        entry = payload["albums"][0]
        self.assertIs(entry["featured"], True)
        self.assertEqual(entry["url"], "https://upscales.app/gallery/01ARZ3NDEKTSV4RRFFQ69G5FAV")
        self.assertEqual(entry["gallery_url"], "https://upscales.app/media/01ARZ3NDEKTSV4RRFFQ69G5FAV/gallery.jpg")

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
            self.assertTrue(album_params[13].endswith("/gallery-v2.jpg"))
            self.assertEqual(album_params[15:17], (960, 720))
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

    def test_gallery_migration_dry_run_has_no_remote_writes(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        admin = mock.Mock()
        admin.query.return_value = [{
            "id": album_id, "state": "locked",
            "gallery_key": f"albums/{album_id}/gallery-v1.jpg", "gallery_mime": "image/jpeg",
            "gallery_width": 1280, "gallery_height": 960, "gallery_bytes": 200000,
        }]
        admin.download.side_effect = lambda _key, destination: Image.new(
            "RGB", album.LEGACY_GALLERY_SIZE, "orange"
        ).save(destination, "JPEG", quality=80)

        with mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            result = album.migrate_gallery(None, all_albums=True, dry_run=True)

        self.assertEqual(result["scanned"], 1)
        self.assertEqual(result["would_migrate"], 1)
        self.assertEqual(result["migrated"], 0)
        self.assertEqual(result["albums"][0]["status"], "would_migrate")
        self.assertLess(result["after_bytes"], result["before_bytes"])
        selection_sql = admin.query.call_args.args[0]
        self.assertIn("state IN ('locked','unlocked')", selection_sql)
        self.assertNotIn("featured", selection_sql)
        admin.upload.assert_not_called()
        admin.execute.assert_not_called()

    def test_gallery_migration_uploads_before_the_conditional_d1_update(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        old_key = f"albums/{album_id}/gallery-v1.jpg"
        events = []
        admin = mock.Mock()
        admin.query.return_value = [{
            "id": album_id, "state": "unlocked", "gallery_key": old_key,
            "gallery_mime": "image/jpeg", "gallery_width": 1280, "gallery_height": 960,
            "gallery_bytes": 200000,
        }]
        admin.download.side_effect = lambda _key, destination: Image.new(
            "RGB", album.LEGACY_GALLERY_SIZE, "navy"
        ).save(destination, "JPEG", quality=80)
        admin.upload.side_effect = lambda record: events.append(("upload", record["key"]))
        admin.execute.side_effect = lambda sql, params: events.append(("execute", params[-1])) or 1

        with mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            result = album.migrate_gallery(album_id, all_albums=False, dry_run=False)

        self.assertEqual([event[0] for event in events], ["upload", "execute"])
        self.assertEqual(events[0][1], f"albums/{album_id}/gallery-v2.jpg")
        self.assertEqual(events[1][1], old_key)
        self.assertEqual(result["migrated"], 1)
        update_params = admin.execute.call_args.args[1]
        self.assertEqual(update_params[2:4], (960, 720))

    def test_gallery_migration_is_idempotent_for_current_rows(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        admin = mock.Mock()
        admin.query.return_value = [{
            "id": album_id, "state": "unlocked",
            "gallery_key": f"albums/{album_id}/gallery-v2.jpg", "gallery_mime": "image/jpeg",
            "gallery_width": 960, "gallery_height": 720, "gallery_bytes": 100000,
        }]

        with mock.patch.object(album, "CloudflareAdmin", return_value=admin):
            result = album.migrate_gallery(album_id, all_albums=False, dry_run=False)

        self.assertEqual(result["reused"], 1)
        admin.download.assert_not_called()
        admin.upload.assert_not_called()
        admin.execute.assert_not_called()

    def test_gallery_migration_can_resume_after_the_d1_response_is_lost(self):
        album_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        old_key = f"albums/{album_id}/gallery-v1.jpg"
        new_key = f"albums/{album_id}/gallery-v2.jpg"
        legacy = {
            "id": album_id, "state": "unlocked", "gallery_key": old_key,
            "gallery_mime": "image/jpeg", "gallery_width": 1280, "gallery_height": 960,
            "gallery_bytes": 200000,
        }
        current = dict(
            legacy, gallery_key=new_key, gallery_width=960, gallery_height=720, gallery_bytes=100000,
        )
        first_admin = mock.Mock()
        first_admin.query.return_value = [legacy]
        first_admin.download.side_effect = lambda _key, destination: Image.new(
            "RGB", album.LEGACY_GALLERY_SIZE, "green"
        ).save(destination, "JPEG", quality=80)
        first_admin.execute.side_effect = album.AlbumError("D1 response lost after commit")
        with mock.patch.object(album, "CloudflareAdmin", return_value=first_admin):
            with self.assertRaisesRegex(album.AlbumError, "response lost"):
                album.migrate_gallery(album_id, all_albums=False, dry_run=False)
        first_admin.upload.assert_called_once()

        second_admin = mock.Mock()
        second_admin.query.return_value = [current]
        with mock.patch.object(album, "CloudflareAdmin", return_value=second_admin):
            resumed = album.migrate_gallery(album_id, all_albums=False, dry_run=False)
        self.assertEqual(resumed["reused"], 1)
        second_admin.download.assert_not_called()
        second_admin.upload.assert_not_called()
        second_admin.execute.assert_not_called()

    def test_gallery_migration_requires_exactly_one_scope(self):
        with self.assertRaisesRegex(album.AlbumError, "either an album ID or --all"):
            album.migrate_gallery(None, all_albums=False, dry_run=True)
        with self.assertRaisesRegex(album.AlbumError, "either an album ID or --all"):
            album.migrate_gallery("01ARZ3NDEKTSV4RRFFQ69G5FAV", all_albums=True, dry_run=True)


if __name__ == "__main__":
    unittest.main()
