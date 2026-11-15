import json
import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from dealers import merge_partial
from dealers.supabase_sync import (
    fresh_dealer_keys,
    is_expected_dealer_item,
    item_to_row,
    make_sku_id,
    next_dealer_lifecycle,
    preserve_previous_images,
    recovered_url_health,
)
from tools.check_mec_partial import validate_partial
from tools.check_data_quality import (
    EXPECTED_CURRENCY,
    PLATFORM_BRAND_MIN_ROWS,
    PLATFORM_REGION_MIN_ROWS,
    parse_frontend_config,
    product_freshness_timestamp,
    validate,
)


def fresh_timestamp():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def dealer_url(dealer: str, item: object, region: str = "us") -> str:
    if dealer == "ssense":
        return f"https://www.ssense.com/en-us/men/product/arcteryx/test-product/{item}"
    if dealer == "burton":
        return f"https://www.burton.com/en-us/products/test-product-{item}"
    if dealer == "backcountry":
        return f"https://www.backcountry.com/burton-test-product-{item}"
    return f"https://example.com/{dealer}/{region}/{item}"


def quality_brand(dealer: str, index: int) -> str:
    if dealer in {"burton", "backcountry"}:
        return "burton"
    if dealer != "evo":
        return "arcteryx"
    if index < PLATFORM_BRAND_MIN_ROWS[("evo", "arcteryx")]:
        return "arcteryx"
    if index < PLATFORM_BRAND_MIN_ROWS[("evo", "arcteryx")] + PLATFORM_BRAND_MIN_ROWS[("evo", "burton")]:
        return "burton"
    return "patagonia"


class DealerFreshnessTests(unittest.TestCase):
    def test_frontend_config_falls_back_to_product_detail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            index = root / "index.html"
            detail = root / "product-detail.html"
            index.write_text("<html>server catalog</html>", encoding="utf-8")
            detail.write_text(
                "const SUPABASE_URL = 'https://example.supabase.co';\n"
                "const SUPABASE_ANON = 'public-anon';\n",
                encoding="utf-8",
            )
            with patch(
                "tools.check_data_quality.FRONTEND_CONFIG_FILES",
                (index, detail),
            ):
                self.assertEqual(
                    parse_frontend_config(),
                    ("https://example.supabase.co", "public-anon"),
                )

    def test_sync_preflight_rejects_non_arcteryx_ssense_items(self):
        self.assertTrue(is_expected_dealer_item(
            {"url": "https://www.ssense.com/en-us/men/product/arcteryx/beta-jacket/1"},
            "ssense",
        ))
        self.assertFalse(is_expected_dealer_item(
            {"url": "https://www.ssense.com/en-us/women/product/marc-jacobs/bag/1"},
            "ssense",
        ))

    def test_sync_preflight_accepts_supported_evo_brands_and_rejects_unknown(self):
        for brand in ("burton", "patagonia"):
            with self.subTest(brand=brand):
                item = {"brand": brand, "url": f"https://www.evo.com/products/{brand}-item"}
                self.assertTrue(is_expected_dealer_item(item, "evo"))
                row = item_to_row({**item, "name": f"{brand.title()} Item", "sale_price": 100, "original_price": 150}, "evo", "2026-08-12 00:00:00")
                self.assertEqual(row["brand"], brand)
        self.assertFalse(is_expected_dealer_item(
            {"brand": "marc-jacobs", "url": "https://www.evo.com/products/other-item"},
            "evo",
        ))
        self.assertFalse(is_expected_dealer_item(
            {"brand": "burton", "name": "Patagonia Nano Puff Jacket", "url": "https://www.evo.com/products/mislabeled-item"},
            "evo",
        ))

    def test_sync_preflight_scopes_burton_sources_and_uses_source_ids(self):
        official = {
            "brand": "burton",
            "source_id": "9100998246657",
            "url": "https://www.burton.com/en-us/products/mens-burton-custom-106881",
        }
        retailer = {
            "brand": "burton",
            "source_id": "BURZ9R1",
            "url": "https://www.backcountry.com/burton-step-on-reflex-binding",
        }
        self.assertTrue(is_expected_dealer_item(official, "burton"))
        self.assertTrue(is_expected_dealer_item(retailer, "backcountry"))
        self.assertFalse(is_expected_dealer_item({**official, "brand": "patagonia"}, "burton"))
        self.assertFalse(is_expected_dealer_item({**retailer, "url": "https://example.com/burton-item"}, "backcountry"))
        self.assertEqual(make_sku_id("burton", official["url"], official["source_id"]), "burton:9100998246657")
        self.assertEqual(make_sku_id("backcountry", retailer["url"], retailer["source_id"]), "backcountry:burz9r1")
    def test_preserve_previous_images_only_fills_missing_snapshot_data(self):
        existing_url = "https://cdn.example/existing.jpg"
        missing = {"image_url": None, "images": []}
        preserve_previous_images(missing, {"image_url": existing_url, "images": [existing_url]})
        self.assertEqual(missing, {"image_url": existing_url, "images": [existing_url]})

        fresh_url = "https://cdn.example/fresh.jpg"
        fresh = {"image_url": fresh_url, "images": [fresh_url]}
        preserve_previous_images(fresh, {"image_url": existing_url, "images": [existing_url]})
        self.assertEqual(fresh, {"image_url": fresh_url, "images": [fresh_url]})

    def test_validate_rejects_unresolved_image_templates(self):
        template_url = "https://res.cloudinary.com/ssenseweb/image/upload/__IMAGE_PARAMS__/item.jpg"
        for field, value in (
            ("image_url", template_url),
            ("image", template_url),
            ("images", [template_url]),
        ):
            with self.subTest(field=field):
                row = {
                    "sku_id": f"ssense-{field}",
                    "dealer": "ssense",
                    "status": "active",
                    "sale_price": 100,
                    "original_price": 150,
                    "discount_pct": 33,
                    "currency": "USD",
                    "symbol": "$",
                    "gender": "men",
                    "region": "us",
                    "url": dealer_url("ssense", field),
                    field: value,
                    "last_updated": fresh_timestamp(),
                }
                output = io.StringIO()
                with redirect_stdout(output):
                    rc = validate(
                        [row],
                        max_age_hours=36,
                        max_product_age_hours=72,
                        min_rows=1,
                        required_dealers={"ssense"},
                        forbidden_regions=None,
                    )
                self.assertEqual(rc, 1)
                self.assertIn("unresolved_image_template: 1", output.getvalue())

    def test_validate_rejects_active_rows_with_empty_image_fields(self):
        row = {
            "sku_id": "evo-missing-image",
            "dealer": "evo",
            "status": "active",
            "sale_price": 100,
            "original_price": 150,
            "discount_pct": 33,
            "currency": "USD",
            "symbol": "$",
            "gender": "men",
            "region": "us",
            "url": "https://example.com/evo/missing-image",
            "image_url": None,
            "images": [],
            "last_updated": fresh_timestamp(),
        }
        output = io.StringIO()
        with redirect_stdout(output):
            rc = validate(
                [row],
                max_age_hours=36,
                max_product_age_hours=72,
                min_rows=1,
                required_dealers={"evo"},
                forbidden_regions=None,
            )
        self.assertEqual(rc, 1)
        self.assertIn("missing_product_image: 1", output.getvalue())

    def test_validate_rejects_non_arcteryx_ssense_rows(self):
        row = {
            "sku_id": "ssense-marc-jacobs",
            "dealer": "ssense",
            "status": "active",
            "sale_price": 100,
            "original_price": 150,
            "discount_pct": 33,
            "currency": "USD",
            "symbol": "$",
            "gender": "women",
            "region": "us",
            "url": "https://www.ssense.com/en-us/women/product/marc-jacobs/bag/1",
            "last_updated": fresh_timestamp(),
        }
        output = io.StringIO()
        with redirect_stdout(output):
            rc = validate(
                [row],
                max_age_hours=36,
                max_product_age_hours=72,
                min_rows=1,
                required_dealers={"ssense"},
                forbidden_regions=None,
            )
        self.assertEqual(rc, 1)
        self.assertIn("unsupported_brand_product: 1", output.getvalue())

    def test_new_outlet_regions_have_currency_and_low_water_marks(self):
        for region in ("fi", "ie"):
            self.assertEqual(EXPECTED_CURRENCY[region], ("EUR", "€"))
            self.assertEqual(
                PLATFORM_REGION_MIN_ROWS[("arcteryx_outlet", region)],
                200,
            )

    def test_recent_pdp_confirmation_survives_list_absence(self):
        lifecycle = next_dealer_lifecycle(
            {
                "status": "active",
                "missing_runs": 0,
                "last_seen_at": "2026-08-01T10:00:00+00:00",
                "url_http_status": 200,
                "url_checked_at": "2026-08-01T10:00:00+00:00",
            },
            present=False,
            observed_at="2026-08-02T10:00:00+00:00",
        )

        self.assertEqual(lifecycle["status"], "active")
        self.assertEqual(lifecycle["missing_runs"], 0)

    def test_stale_pdp_confirmation_does_not_mask_list_absence(self):
        lifecycle = next_dealer_lifecycle(
            {
                "status": "active",
                "missing_runs": 0,
                "last_seen_at": "2026-07-30T10:00:00+00:00",
                "url_http_status": 200,
                "url_checked_at": "2026-07-30T10:00:00+00:00",
            },
            present=False,
            observed_at="2026-08-02T10:00:00+00:00",
        )

        self.assertEqual(lifecycle["status"], "missing")
        self.assertEqual(lifecycle["missing_runs"], 1)

    def test_quarantined_row_is_not_reactivated_by_old_pdp_confirmation(self):
        lifecycle = next_dealer_lifecycle(
            {
                "status": "missing",
                "missing_runs": 1,
                "last_seen_at": "2026-08-01T10:00:00+00:00",
                "url_http_status": 200,
                "url_checked_at": "2026-08-01T10:00:00+00:00",
            },
            present=False,
            observed_at="2026-08-02T10:00:00+00:00",
        )

        self.assertEqual(lifecycle["status"], "inactive")
        self.assertEqual(lifecycle["missing_runs"], 2)

    def test_source_contract_violation_bypasses_recent_pdp_grace(self):
        lifecycle = next_dealer_lifecycle(
            {
                "status": "active",
                "missing_runs": 0,
                "last_seen_at": "2026-08-01T10:00:00+00:00",
                "url_http_status": 200,
                "url_checked_at": "2026-08-02T09:00:00+00:00",
            },
            present=False,
            observed_at="2026-08-02T10:00:00+00:00",
            source_contract_valid=False,
        )

        self.assertEqual(lifecycle["status"], "inactive")
        self.assertEqual(lifecycle["missing_runs"], 2)
        self.assertEqual(lifecycle["last_seen_at"], "2026-08-01T10:00:00+00:00")

    def test_validate_requires_min_rows_for_each_requested_dealer(self):
        rows = [
            {
                "sku_id": f"rei-{i}",
                "dealer": "rei",
                "status": "active",
                "sale_price": 100,
                "original_price": 150,
                "discount_pct": 33,
                "currency": "USD",
                "symbol": "$",
                "gender": "men",
                "region": "us",
                "url": f"https://example.com/rei/{i}",
                "last_updated": fresh_timestamp(),
            }
            for i in range(21)
        ] + [
            {
                "sku_id": f"evo-{i}",
                "dealer": "evo",
                "status": "active",
                "sale_price": 100,
                "original_price": 150,
                "discount_pct": 33,
                "currency": "USD",
                "symbol": "$",
                "gender": "men",
                "region": "us",
                "url": f"https://example.com/evo/{i}",
                "last_updated": fresh_timestamp(),
            }
            for i in range(50)
        ]
        rc = validate(
            rows,
            max_age_hours=36,
            max_product_age_hours=72,
            min_rows=50,
            required_dealers={"evo", "rei"},
            forbidden_regions=None,
        )
        self.assertEqual(rc, 1)

    def test_validate_rejects_active_retired_dealer(self):
        rows = [
            {
                "sku_id": f"ssense-{i}",
                "dealer": "ssense",
                "status": "active",
                "sale_price": 100,
                "original_price": 150,
                "discount_pct": 33,
                "currency": "USD",
                "symbol": "$",
                "gender": "men",
                "region": "us",
                "url": dealer_url("ssense", i),
                "last_updated": fresh_timestamp(),
            }
            for i in range(46)
        ]
        output = io.StringIO()
        with redirect_stdout(output):
            rc = validate(
                rows,
                max_age_hours=36,
                max_product_age_hours=72,
                min_rows=1,
                required_dealers=None,
                forbidden_regions=None,
            )
        self.assertEqual(rc, 1)
        self.assertIn("retired_dealer_active: 46", output.getvalue())

    def test_validate_rejects_retired_dealer_requirement(self):
        rows = [
            {
                "sku_id": f"ssense-{i}",
                "dealer": "ssense",
                "status": "active",
                "sale_price": 100,
                "original_price": 150,
                "discount_pct": 33,
                "currency": "USD",
                "symbol": "$",
                "gender": "men",
                "region": "us",
                "url": dealer_url("ssense", i),
                "last_updated": fresh_timestamp(),
            }
            for i in range(39)
        ]
        output = io.StringIO()
        with redirect_stdout(output):
            rc = validate(
                rows,
                max_age_hours=36,
                max_product_age_hours=72,
                min_rows=1,
                required_dealers={"ssense"},
                forbidden_regions=None,
            )
        self.assertEqual(rc, 1)
        self.assertIn("retired_dealer_requested: 1", output.getvalue())

    def test_validate_evo_enforces_each_supported_brand_floor(self):
        rows = []
        for (dealer, brand), count in PLATFORM_BRAND_MIN_ROWS.items():
            if dealer != "evo":
                continue
            for index in range(count):
                rows.append({
                    "sku_id": f"{dealer}-{brand}-{index}",
                    "dealer": dealer,
                    "brand": brand,
                    "status": "active",
                    "sale_price": 100,
                    "original_price": 150,
                    "discount_pct": 33,
                    "currency": "USD",
                    "symbol": "$",
                    "gender": "unisex",
                    "region": "us",
                    "url": f"https://www.evo.com/products/{brand}-{index}",
                    "last_updated": fresh_timestamp(),
                })
        self.assertEqual(validate(rows, 36, 72, 1, {"evo"}, None), 0)

        collapsed = [row for row in rows if row["sku_id"] != "evo-burton-0"]
        output = io.StringIO()
        with redirect_stdout(output):
            rc = validate(collapsed, 36, 72, 1, {"evo"}, None)
        self.assertEqual(rc, 1)
        self.assertIn("platform_brand_below_min_rows: 1", output.getvalue())

    def test_validate_enforces_burton_source_floors_independently(self):
        for dealer in ("burton", "backcountry"):
            with self.subTest(dealer=dealer):
                minimum = PLATFORM_BRAND_MIN_ROWS[(dealer, "burton")]
                rows = [{
                    "sku_id": f"{dealer}-{index}",
                    "dealer": dealer,
                    "brand": "burton",
                    "status": "active",
                    "sale_price": 100,
                    "original_price": 150,
                    "discount_pct": 33,
                    "currency": "USD",
                    "symbol": "$",
                    "gender": "unisex",
                    "region": "us",
                    "url": dealer_url(dealer, index),
                    "last_updated": fresh_timestamp(),
                } for index in range(minimum)]
                self.assertEqual(validate(rows, 36, 72, 1, {dealer}, None), 0)
                output = io.StringIO()
                with redirect_stdout(output):
                    rc = validate(rows[:-1], 36, 72, 1, {dealer}, None)
                self.assertEqual(rc, 1)
                self.assertIn("platform_brand_below_min_rows: 1", output.getvalue())

    def test_validate_full_gate_enforces_aggregate_floor(self):
        rows = []
        for (dealer, region), count in PLATFORM_REGION_MIN_ROWS.items():
            currency, symbol = EXPECTED_CURRENCY[region]
            for i in range(count):
                rows.append({
                    "sku_id": f"{dealer}-{region}-{i}",
                    "dealer": dealer,
                    "brand": quality_brand(dealer, i),
                    "status": "active",
                    "sale_price": 100,
                    "original_price": 150,
                    "discount_pct": 33,
                    "currency": currency,
                    "symbol": symbol,
                    "gender": "men",
                    "region": region,
                    "url": dealer_url(dealer, i, region),
                    "last_seen_at": fresh_timestamp(),
                    "last_updated": fresh_timestamp(),
                })
        rc = validate(
            rows,
            max_age_hours=36,
            max_product_age_hours=72,
            min_rows=5000,
            required_dealers=None,
            forbidden_regions=None,
        )
        self.assertEqual(rc, 1)

    def test_validate_full_gate_passes_aggregate_and_platform_region_floors(self):
        rows = []
        for (dealer, region), count in PLATFORM_REGION_MIN_ROWS.items():
            currency, symbol = EXPECTED_CURRENCY[region]
            for i in range(count):
                rows.append({
                    "sku_id": f"{dealer}-{region}-{i}",
                    "dealer": dealer,
                    "brand": quality_brand(dealer, i),
                    "status": "active",
                    "sale_price": 100,
                    "original_price": 150,
                    "discount_pct": 33,
                    "currency": currency,
                    "symbol": symbol,
                    "gender": "men",
                    "region": region,
                    "url": dealer_url(dealer, i, region),
                    "last_seen_at": fresh_timestamp(),
                    "last_updated": fresh_timestamp(),
                })
        while len(rows) < 5000:
            i = len(rows)
            rows.append({
                "sku_id": f"extra-{i}", "dealer": "arcteryx_outlet", "status": "active",
                "sale_price": 100, "original_price": 150, "discount_pct": 33,
                "currency": "USD", "symbol": "$", "gender": "men", "region": "us",
                "url": f"https://example.com/extra/{i}",
                "last_seen_at": fresh_timestamp(), "last_updated": fresh_timestamp(),
            })
        rc = validate(rows, 36, 72, 5000, required_dealers=None, forbidden_regions=None)
        self.assertEqual(rc, 0)

    def test_au_sale_feed_has_no_region_floor(self):
        # AU can legitimately have no discounts; the passing full-gate fixture
        # above therefore contains no AU rows at all.
        self.assertNotIn(("arcteryx_outlet", "au"), PLATFORM_REGION_MIN_ROWS)

    def test_validate_full_gate_identifies_collapsed_platform_region(self):
        rows = []
        for (dealer, region), count in PLATFORM_REGION_MIN_ROWS.items():
            if (dealer, region) == ("arcteryx_outlet", "ca"):
                count -= 1
            currency, symbol = EXPECTED_CURRENCY[region]
            for i in range(count):
                rows.append({
                    "sku_id": f"{dealer}-{region}-{i}", "dealer": dealer, "brand": quality_brand(dealer, i), "status": "active",
                    "sale_price": 100, "original_price": 150, "discount_pct": 33,
                    "currency": currency, "symbol": symbol, "gender": "men",
                    "region": region, "url": dealer_url(dealer, i, region),
                    "last_seen_at": fresh_timestamp(),
                    "last_updated": fresh_timestamp(),
                })
        rc = validate(rows, 36, 72, 5000, required_dealers=None, forbidden_regions=None)
        self.assertEqual(rc, 1)

    def test_dealer_product_freshness_uses_last_updated(self):
        ts = product_freshness_timestamp({
            "dealer": "rei",
            "last_seen_at": "2026-06-01T00:00:00+00:00",
            "last_updated": "2026-07-12T09:00:00+00:00",
        })
        self.assertEqual(ts.isoformat(), "2026-07-12T09:00:00+00:00")

    def test_outlet_product_freshness_uses_last_seen(self):
        ts = product_freshness_timestamp({
            "dealer": "arcteryx_outlet",
            "last_seen_at": "2026-07-11T09:00:00+00:00",
            "last_updated": "2026-07-12T09:00:00+00:00",
        })
        self.assertEqual(ts.isoformat(), "2026-07-11T09:00:00+00:00")

    def test_merge_marks_only_nonempty_partials_fresh(self):
        previous_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                Path("dealers/_partial").mkdir(parents=True)
                Path("dealers/results.json").write_text(json.dumps({
                    "generated_at": "2026-07-10 00:00:00",
                    "dealers": {
                        "mec": {"name": "MEC", "count": 1, "items": [{"url": "old-mec"}]},
                        "evo": {"name": "EVO", "count": 1, "items": [{"url": "old-evo"}]},
                    },
                }))
                Path("dealers/_partial/mec.json").write_text(json.dumps({
                    "name": "MEC",
                    "region": "CA",
                    "count": 1,
                    "items": [{"url": "new-mec"}],
                    "crawl_complete": True,
                    "saved_at": "2026-07-11 16:00:00",
                }))
                Path("dealers/_partial/evo.json").write_text(json.dumps({
                    "name": "EVO", "region": "US", "count": 0, "items": [],
                    "crawl_complete": False,
                    "saved_at": "2026-07-11 16:00:00",
                }))

                merge_partial.main()
                merged = json.loads(Path("dealers/results.json").read_text())
                self.assertEqual(merged["fresh_dealers"], ["mec"])
                self.assertEqual(merged["dealers"]["mec"]["items"][0]["url"], "new-mec")
                self.assertEqual(merged["dealers"]["mec"]["refreshed_at"], "2026-07-11 16:00:00")
                self.assertEqual(merged["dealers"]["evo"]["items"][0]["url"], "old-evo")
                self.assertEqual(
                    merged["retained_dealers"], {"evo": "empty"}
                )
            finally:
                os.chdir(previous_cwd)

    def test_merge_preserves_unresolved_rejection_across_other_dealer_refresh(self):
        previous_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                Path("dealers/_partial").mkdir(parents=True)
                Path("dealers/results.json").write_text(json.dumps({
                    "dealers": {
                        "mec": {"name": "MEC", "count": 1, "items": [{"url": "old-mec"}]},
                        "evo": {"name": "EVO", "count": 1, "items": [{"url": "old-evo"}]},
                    },
                    "rejected_dealers": {"evo": "HTTP 403"},
                }))
                Path("dealers/_partial/mec.json").write_text(json.dumps({
                    "name": "MEC",
                    "region": "CA",
                    "count": 1,
                    "items": [{"url": "new-mec"}],
                    "crawl_complete": True,
                    "saved_at": "2026-08-24 02:00:00",
                }))

                with patch.dict(os.environ, {"PUBLICATION_ID": "github-actions-123"}):
                    merge_partial.main()
                merged = json.loads(Path("dealers/results.json").read_text())

                self.assertEqual(merged["publication_id"], "github-actions-123")
                self.assertEqual(merged["fresh_dealers"], ["mec"])
                self.assertEqual(merged["rejected_dealers"], {"evo": "HTTP 403"})
                self.assertEqual(merged["retained_dealers"], {"evo": "HTTP 403"})
            finally:
                os.chdir(previous_cwd)

    def test_merge_clears_prior_rejection_only_after_trusted_refresh(self):
        previous_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                Path("dealers/_partial").mkdir(parents=True)
                Path("dealers/results.json").write_text(json.dumps({
                    "dealers": {
                        "evo": {"name": "EVO", "count": 1, "items": [{"url": "old-evo"}]},
                    },
                    "rejected_dealers": {"evo": "HTTP 403"},
                }))
                Path("dealers/_partial/evo.json").write_text(json.dumps({
                    "name": "EVO",
                    "region": "US",
                    "count": 1,
                    "items": [{"url": "new-evo"}],
                    "crawl_complete": True,
                    "saved_at": "2026-08-24 02:00:00",
                }))

                merge_partial.main()
                merged = json.loads(Path("dealers/results.json").read_text())

                self.assertEqual(merged["rejected_dealers"], {})
                self.assertEqual(merged["retained_dealers"], {})
                self.assertEqual(merged["fresh_dealers"], ["evo"])
                self.assertEqual(merged["dealers"]["evo"]["items"][0]["url"], "new-evo")
            finally:
                os.chdir(previous_cwd)

    def test_merge_discards_retired_source_from_previous_and_partial(self):
        previous_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                Path("dealers/_partial").mkdir(parents=True)
                Path("dealers/results.json").write_text(json.dumps({
                    "dealers": {"ssense": {"name": "SSENSE", "count": 1, "items": [{"url": "old"}]}},
                }))
                Path("dealers/_partial/ssense.json").write_text(json.dumps({
                    "name": "SSENSE",
                    "count": 1,
                    "items": [{"url": "partial"}],
                    "crawl_complete": False,
                }))
                merge_partial.main()
                merged = json.loads(Path("dealers/results.json").read_text())
                self.assertEqual(merged["fresh_dealers"], [])
                self.assertNotIn("ssense", merged["dealers"])
                self.assertEqual(merged["retired_dealers"], ["ssense"])
            finally:
                os.chdir(previous_cwd)

    def test_merge_rejects_complete_but_collapsed_snapshot(self):
        previous_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                Path("dealers/_partial").mkdir(parents=True)
                Path("dealers/results.json").write_text(json.dumps({
                    "dealers": {"evo": {
                        "name": "EVO", "count": 242,
                        "items": [{"url": f"old-{i}"} for i in range(242)],
                    }},
                }))
                Path("dealers/_partial/evo.json").write_text(json.dumps({
                    "name": "EVO", "count": 50,
                    "items": [{"url": f"new-{i}"} for i in range(50)],
                    "crawl_complete": True,
                }))
                merge_partial.main()
                merged = json.loads(Path("dealers/results.json").read_text())
                self.assertEqual(merged["fresh_dealers"], [])
                self.assertEqual(merged["dealers"]["evo"]["count"], 242)
                self.assertIn("collapsed 242->50", merged["rejected_dealers"]["evo"])
            finally:
                os.chdir(previous_cwd)

    def _run_backcountry_collapse_merge(self, *, key="backcountry", refreshed_at=None):
        previous_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                Path("dealers/_partial").mkdir(parents=True)
                block = {
                    "name": key.title(), "count": 214,
                    "items": [{"url": f"old-{i}"} for i in range(214)],
                }
                if refreshed_at is not None:
                    block["refreshed_at"] = refreshed_at
                Path("dealers/results.json").write_text(json.dumps({
                    "dealers": {key: block},
                    "rejected_dealers": {key: "collapsed 214->89 (42% < 70%)"},
                }))
                Path(f"dealers/_partial/{key}.json").write_text(json.dumps({
                    "name": key.title(), "region": "US", "count": 76,
                    "items": [{"url": f"new-{i}"} for i in range(76)],
                    "crawl_complete": True,
                    "saved_at": "2026-11-15 06:00:00",
                }))
                with redirect_stdout(io.StringIO()):
                    merge_partial.main()
                return json.loads(Path("dealers/results.json").read_text())
            finally:
                os.chdir(previous_cwd)

    def test_merge_accepts_complete_contraction_when_baseline_is_stale(self):
        merged = self._run_backcountry_collapse_merge(refreshed_at="2026-10-21 14:31:41")
        self.assertEqual(merged["fresh_dealers"], ["backcountry"])
        self.assertEqual(merged["dealers"]["backcountry"]["count"], 76)
        self.assertEqual(merged["dealers"]["backcountry"]["refreshed_at"], "2026-11-15 06:00:00")
        self.assertEqual(merged["rejected_dealers"], {})

    def test_merge_keeps_collapse_guard_while_baseline_is_recent(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=6)).strftime("%Y-%m-%d %H:%M:%S")
        merged = self._run_backcountry_collapse_merge(refreshed_at=recent)
        self.assertEqual(merged["fresh_dealers"], [])
        self.assertEqual(merged["dealers"]["backcountry"]["count"], 214)
        self.assertIn("collapsed 214->76", merged["rejected_dealers"]["backcountry"])

    def test_merge_keeps_collapse_guard_without_baseline_timestamp(self):
        merged = self._run_backcountry_collapse_merge(refreshed_at=None)
        self.assertEqual(merged["fresh_dealers"], [])
        self.assertIn("collapsed 214->76", merged["rejected_dealers"]["backcountry"])

    def test_merge_stale_baseline_acceptance_excludes_unverified_totals(self):
        merged = self._run_backcountry_collapse_merge(key="evo", refreshed_at="2026-10-21 14:31:41")
        self.assertEqual(merged["fresh_dealers"], [])
        self.assertEqual(merged["dealers"]["evo"]["count"], 214)
        self.assertIn("collapsed 214->76", merged["rejected_dealers"]["evo"])

    def test_fresh_dealer_keys_is_backward_compatible(self):
        self.assertIsNone(fresh_dealer_keys({"dealers": {"mec": {}}}))
        self.assertEqual(fresh_dealer_keys({"fresh_dealers": ["mec", "rei"]}), {"mec", "rei"})

    def test_dealer_two_trusted_misses_then_recovery(self):
        first = next_dealer_lifecycle(
            {"status": "active", "missing_runs": 0, "last_seen_at": "old"},
            present=False,
            observed_at="run-1",
        )
        second = next_dealer_lifecycle(first, present=False, observed_at="run-2")
        recovered = next_dealer_lifecycle(second, present=True, observed_at="run-3")
        self.assertEqual(first, {"status": "missing", "missing_runs": 1, "last_seen_at": "old"})
        self.assertEqual(second, {"status": "inactive", "missing_runs": 2, "last_seen_at": "old"})
        self.assertEqual(recovered, {"status": "active", "missing_runs": 0, "last_seen_at": "run-3"})

    def test_dealer_rediscovery_clears_terminal_url_health(self):
        self.assertEqual(
            recovered_url_health({"url_http_status": 404, "url_checked_at": "old"}),
            {"url_http_status": None, "url_checked_at": None},
        )
        self.assertEqual(
            recovered_url_health({"url_http_status": 503, "url_checked_at": "old"}),
            {"url_http_status": 503, "url_checked_at": "old"},
        )

    def test_mec_partial_requires_complete_expected_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mec.json"
            path.write_text(json.dumps({
                "items": [{"url": str(i)} for i in range(52)],
                "crawl_complete": False,
                "expected_count": 128,
            }))
            with self.assertRaisesRegex(ValueError, "crawl incomplete"):
                validate_partial(path)

            path.write_text(json.dumps({
                "items": [{"url": str(i)} for i in range(128)],
                "crawl_complete": True,
                "expected_count": 128,
            }))
            self.assertEqual(validate_partial(path), (128, 128))


if __name__ == "__main__":
    unittest.main()
