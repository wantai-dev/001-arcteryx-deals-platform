import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools.check_product_urls import classify_url, product_identity
from tools.crawler_lease import needs_fallback
from tools.product_lifecycle import load_manifest, next_lifecycle, validate_scope_counts
from supabase_sync import url_health_after_observation
from sku_scraper import is_static_fallback_eligible


class ProductLifecycleTests(unittest.TestCase):
    def manifest(self, urls, status="success"):
        return {
            "generated_at": "2026-07-11T12:00:00+00:00",
            "scopes": {
                ("us", "women"): {
                    "region": "us",
                    "gender": "womens",
                    "status": status,
                    "urls": set(urls),
                }
            },
        }

    def test_seen_product_is_active_and_resets_missing_counter(self):
        url = "https://outlet.arcteryx.com/us/en/shop/womens/beta-jacket"
        result = next_lifecycle(
            {"status": "missing", "missing_runs": 1, "last_seen_at": "old"},
            {"url": url, "region": "us", "gender": "women", "last_updated": "new"},
            self.manifest([url]),
        )
        self.assertEqual(result, {"status": "active", "missing_runs": 0, "last_seen_at": "new"})

    def test_successful_rediscovery_clears_stale_dead_url_result(self):
        previous = {"url_http_status": 404, "url_checked_at": "old"}
        self.assertEqual(
            url_health_after_observation(previous, observed_successfully=True),
            {"url_http_status": None, "url_checked_at": None},
        )
        self.assertEqual(
            url_health_after_observation(previous, observed_successfully=False),
            previous,
        )

    def test_two_complete_misses_move_product_to_inactive(self):
        row = {
            "url": "https://outlet.arcteryx.com/us/en/shop/womens/alpha-pant",
            "region": "us",
            "gender": "women",
            "last_updated": "old",
        }
        first = next_lifecycle({"status": "active", "missing_runs": 0}, row, self.manifest([]))
        second = next_lifecycle({**row, **first}, row, self.manifest([]))
        self.assertEqual(first["status"], "missing")
        self.assertEqual(first["missing_runs"], 1)
        self.assertEqual(second["status"], "inactive")
        self.assertEqual(second["missing_runs"], 2)

    def test_absent_sku_does_not_inherit_parent_url_presence(self):
        url = "https://example.test/product"
        result = next_lifecycle(
            {"status": "active", "missing_runs": 0, "last_seen_at": "old"},
            {"url": url, "region": "us", "gender": "women"},
            self.manifest([url]),
            present_in_snapshot=False,
        )
        self.assertEqual(
            result,
            {"status": "missing", "missing_runs": 1, "last_seen_at": "old"},
        )

    def test_absent_sku_is_preserved_when_scope_failed(self):
        url = "https://example.test/product"
        result = next_lifecycle(
            {"status": "active", "missing_runs": 0, "last_seen_at": "old"},
            {"url": url, "region": "us", "gender": "women"},
            self.manifest([url], status="failed"),
            present_in_snapshot=False,
        )
        self.assertEqual(
            result,
            {"status": "active", "missing_runs": 0, "last_seen_at": "old"},
        )

    def test_failed_scope_does_not_change_lifecycle(self):
        row = {"url": "https://example.test/product", "region": "us", "gender": "women", "last_updated": "old"}
        result = next_lifecycle(
            {"status": "active", "missing_runs": 0, "last_seen_at": "seen"},
            row,
            self.manifest([], status="failed"),
        )
        self.assertEqual(result, {"status": "active", "missing_runs": 0, "last_seen_at": "seen"})

    def test_new_product_from_unverified_scope_is_not_activated(self):
        row = {"url": "https://example.test/product", "region": "us", "gender": "women", "last_updated": "new"}
        result = next_lifecycle(None, row, self.manifest([], status="failed"))
        self.assertEqual(result, {"status": "missing", "missing_runs": 0, "last_seen_at": "new"})

    def test_scope_drop_guard_rejects_large_drop(self):
        previous = [
            {"url": f"https://example.test/{i}", "region": "us", "gender": "women", "status": "active"}
            for i in range(100)
        ]
        errors = validate_scope_counts(self.manifest([f"https://example.test/{i}" for i in range(60)]), previous)
        self.assertEqual(len(errors), 1)
        self.assertIn("dropped from 100 to 60", errors[0])

    def test_unisex_product_uses_region_unisex_scope(self):
        url = "https://outlet.arcteryx.com/gb/en/shop/mallow-toque"
        manifest = {
            "generated_at": "2026-09-18T00:00:00+00:00",
            "scopes": {
                ("gb", "unisex"): {"region": "gb", "gender": "unisex", "status": "success", "urls": {url}},
            },
        }
        row = {"url": url, "region": "gb", "gender": "unisex", "last_updated": "new"}
        self.assertEqual(
            next_lifecycle(None, row, manifest),
            {"status": "active", "missing_runs": 0, "last_seen_at": "new"},
        )
        self.assertEqual(validate_scope_counts(manifest, []), [])

    def test_small_gender_scope_is_still_rejected(self):
        errors = validate_scope_counts(self.manifest(["https://example.test/1"]), [])
        self.assertEqual(errors, ["us/women only returned 1 products"])

    def test_static_fallback_rejects_row_absent_from_successful_scope(self):
        now = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        row = {
            "url": "https://example.test/removed", "region": "us", "gender": "women",
            "last_updated": "2026-08-01T11:00:00+00:00",
        }
        self.assertFalse(is_static_fallback_eligible(row, self.manifest([]), now=now))

    def test_static_fallback_retains_recent_row_when_scope_failed(self):
        now = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        row = {
            "url": "https://example.test/preserved", "region": "us", "gender": "women",
            "last_updated": "2026-08-01T11:00:00+00:00",
        }
        self.assertTrue(
            is_static_fallback_eligible(row, self.manifest([], status="failed"), now=now)
        )

    def test_static_fallback_rejects_row_older_than_72_hours(self):
        now = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        row = {
            "url": "https://example.test/stale", "region": "us", "gender": "women",
            "last_updated": "2026-07-29T11:59:59+00:00",
        }
        self.assertFalse(
            is_static_fallback_eligible(row, self.manifest([], status="failed"), now=now)
        )

    def test_manifest_loader_normalizes_gender_and_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(
                '{"generated_at":"now","scopes":[{"region":"us","gender":"womens","status":"success","urls":["u"]}]}',
                encoding="utf-8",
            )
            manifest = load_manifest(path)
        self.assertEqual(manifest["scopes"][("us", "women")]["urls"], {"u"})

    def test_product_identity_uses_region_and_slug(self):
        self.assertEqual(product_identity("https://outlet.arcteryx.com/us/en/shop/womens/alpha-pant"), ("us", "alpha-pant"))
        self.assertEqual(product_identity("https://outlet.arcteryx.com/gb/en/shop/mallow-toque"), ("gb", "mallow-toque"))

    @patch("tools.check_product_urls.requests.get")
    def test_url_checker_marks_404_unavailable(self, get):
        get.return_value = SimpleNamespace(status_code=404, url="https://outlet.arcteryx.com/us/en/shop/womens/alpha-pant")
        self.assertEqual(classify_url(get.return_value.url)[:2], (404, "unavailable"))

    @patch("tools.check_product_urls.requests.get")
    def test_url_checker_recovers_same_product_on_200(self, get):
        url = "https://outlet.arcteryx.com/ca/en/shop/womens/konseal-shoe-9970"
        get.return_value = SimpleNamespace(status_code=200, url=url)
        self.assertEqual(classify_url(url)[:2], (200, "active"))

    @patch("tools.check_product_urls.requests.get")
    def test_url_checker_rejects_redirect_to_another_product(self, get):
        get.return_value = SimpleNamespace(status_code=200, url="https://outlet.arcteryx.com/us/en/shop/womens/beta-pant")
        result = classify_url("https://outlet.arcteryx.com/us/en/shop/womens/alpha-pant")
        self.assertEqual(result[:2], (200, "unavailable"))

    @patch("tools.crawler_lease.read_scope")
    def test_active_lease_blocks_fallback(self, read_scope):
        read_scope.return_value = {
            "status": "running",
            "lease_until": "2999-01-01T00:00:00+00:00",
        }
        self.assertFalse(needs_fallback("outlet", 4.5))

    @patch("tools.crawler_lease.read_scope")
    def test_failed_primary_requests_fallback(self, read_scope):
        read_scope.return_value = {
            "status": "failed",
            "lease_until": "2020-01-01T00:00:00+00:00",
            "completed_at": "2020-01-01T00:00:00+00:00",
        }
        self.assertTrue(needs_fallback("outlet", 4.5))


if __name__ == "__main__":
    unittest.main()
