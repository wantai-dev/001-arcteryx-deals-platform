import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from tools.hydrate_runtime_snapshot import atomic_write, snapshot_url, validate_snapshot
from tools.wait_for_data_release import parse_timestamp, release_match


class DataReleaseToolTests(unittest.TestCase):
    def test_data_sync_makes_public_release_traversable(self):
        root = Path(__file__).resolve().parents[1]
        script = (root / "ops" / "data" / "sync-data-release.sh").read_text()
        self.assertIn('chmod -R u=rwX,go=rX "$RELEASE"', script)

    def test_data_sync_publishes_receipt_before_housekeeping(self):
        root = Path(__file__).resolve().parents[1]
        script = (root / "ops" / "data" / "sync-data-release.sh").read_text()
        status_write = script.index('mv -f "$STATUS_STAGING" "$DATA_ROOT/status.json"')
        status_readback = script.index('if [ "$STATUS_REVISION" != "$DATA_REVISION" ]')
        prune = script.index('prune-data-releases.mjs')
        self.assertLess(status_write, status_readback)
        self.assertLess(status_readback, prune)

    def test_catalog_and_dealer_snapshots_fail_closed(self):
        self.assertEqual(validate_snapshot("catalog", [{"sku_id": "sku-1"}]), 1)
        self.assertEqual(
            validate_snapshot(
                "dealers",
                {"dealers": {"evo": {"items": [{"source_id": "one"}]}}},
            ),
            1,
        )
        for dataset, value in (
            ("catalog", []),
            ("catalog", [{"name": "missing identity"}]),
            ("catalog", [{"sku_id": "dealer-row", "dealer": "evo"}]),
            ("dealers", {"dealers": {}}),
        ):
            with self.subTest(dataset=dataset, value=value):
                with self.assertRaises(ValueError):
                    validate_snapshot(dataset, value)

    def test_snapshot_url_is_bounded_to_an_https_origin(self):
        self.assertEqual(
            snapshot_url("https://geardrop.100app.dev", "dealers"),
            "https://geardrop.100app.dev/dealers/results.json",
        )
        with self.assertRaises(ValueError):
            snapshot_url("http://geardrop.100app.dev", "catalog")
        with self.assertRaises(ValueError):
            snapshot_url("https://geardrop.100app.dev/path", "catalog")

    def test_atomic_write_replaces_complete_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "nested" / "snapshot.json"
            atomic_write(output, b'{"complete":true}\n')
            self.assertEqual(json.loads(output.read_text()), {"complete": True})
            self.assertEqual(list(output.parent.glob(f".{output.name}.*")), [])

    def test_release_receipt_requires_post_sync_matching_revisions(self):
        after = parse_timestamp("2026-08-31T10:00:00Z")
        status = {
            "checked_at": "2026-08-31T10:00:01Z",
            "data_revision": "a" * 20,
            "artifact_revision": "c" * 20,
            "code_revision": "b" * 40,
            "active_products": 8088,
        }
        manifest = {
            "data_revision": "a" * 20,
            "artifact_revision": "c" * 20,
            "code_revision": "b" * 40,
            "active_products": 8088,
        }
        matched, reason = release_match(status, manifest, after)
        self.assertTrue(matched, reason)
        self.assertIn("active_products=8088", reason)

        stale = dict(status, checked_at="2026-08-31T09:59:59Z")
        self.assertFalse(release_match(stale, manifest, after)[0])
        wrong = dict(manifest, data_revision="c" * 20)
        self.assertFalse(release_match(status, wrong, after)[0])

    def test_release_timestamps_require_timezone(self):
        expected = dt.datetime(2026, 8, 31, 10, tzinfo=dt.timezone.utc)
        self.assertEqual(parse_timestamp("2026-08-31T10:00:00Z"), expected)
        with self.assertRaises(ValueError):
            parse_timestamp("2026-08-31T10:00:00")


if __name__ == "__main__":
    unittest.main()
