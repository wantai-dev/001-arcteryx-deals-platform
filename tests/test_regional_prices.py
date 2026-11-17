import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import catalog.regional_prices as regional_prices
from catalog.official_catalog import CatalogSourceError
from catalog.regional_prices import (
    collect_au_prices,
    collect_regional_prices,
    normalize_regional_price,
    sync_regional_prices,
)
from tools.shopify_ucp import UcpError
from tools.check_official_catalog import CatalogReadbackError, verify_regional_rows

CURRENCY = {"us": "USD", "gb": "GBP", "de": "EUR"}


def feed_row(style, country, price, *, currency=None, discount=None, url=None):
    return {
        "id": style,
        "price": price,
        "discountPrice": price if discount is None else discount,
        "currencyCode": currency or CURRENCY[country],
        "url": url or f"{country}/en/shop/mens/item-{style.lower()}",
    }


class FakeFeedClient:
    def __init__(self, feeds):
        self.feeds = feeds
        self.calls = []

    def fetch_feed(self, gender, category="", country="us"):
        self.calls.append((country, gender))
        feed = self.feeds[country]
        if isinstance(feed, Exception):
            raise feed
        return feed[gender]


def gendered(country, styles, price):
    half = len(styles) // 2
    return {
        "mens": [feed_row(style, country, price) for style in styles[:half]],
        "womens": [feed_row(style, country, price) for style in styles[half:]],
    }


STYLES = [f"X{index:09d}" for index in range(300)]
US_IDS = [f"arcteryx:{style.lower()}" for style in STYLES]


class FakeQuery:
    def __init__(self, table, log, rows):
        self.table_name, self.log, self.rows = table, log, rows
        self.op = None

    def select(self, columns):
        self.op = ("select", columns)
        return self

    def range(self, start, end):
        self.range_args = (start, end)
        return self

    def upsert(self, rows, on_conflict):
        self.op = ("upsert", rows, on_conflict)
        return self

    def update(self, values):
        self.op = ("update", values)
        self.filters = []
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, list(values)))
        return self

    def execute(self):
        self.log.append((self.table_name, self.op, getattr(self, "filters", None)))

        class Response:
            data = []

        if self.op[0] == "select":
            Response.data = self.rows if self.range_args[0] == 0 else []
        return Response


class FakeSupabase:
    def __init__(self, existing):
        self.existing = existing
        self.log = []

    def table(self, name):
        return FakeQuery(name, self.log, self.existing)


class RegionalPriceTests(unittest.TestCase):
    def test_normalizes_local_full_price_and_country_shop_url(self):
        row = normalize_regional_price(
            feed_row("X000010680", "gb", 750, url="gb/en/shop/mens/alar-wool-coat-0680"), "gb"
        )
        self.assertEqual(row["catalog_product_id"], "arcteryx:x000010680")
        self.assertEqual((row["country"], row["currency"], row["list_price"]), ("gb", "GBP", 750.0))
        self.assertEqual(row["source_url"], "https://arcteryx.com/gb/en/shop/mens/alar-wool-coat-0680")
        self.assertRegex(row["source_hash"], r"^[0-9a-f]{64}$")

    def test_rejects_wrong_currency_discount_or_foreign_shop(self):
        for raw in (
            feed_row("X000010680", "gb", 750, currency="EUR"),
            feed_row("X000010680", "gb", 750, discount=600),
            feed_row("X000010680", "gb", 750, url="us/en/shop/mens/alar"),
        ):
            with self.subTest(raw=raw), self.assertRaises(CatalogSourceError):
                normalize_regional_price(raw, "gb")

    def test_one_failed_country_is_reported_and_skipped(self):
        client = FakeFeedClient({
            "us": gendered("us", STYLES, 850),
            "gb": CatalogSourceError("Arc'teryx gb feed mens/all returned HTTP 503"),
            "de": gendered("de", STYLES[:250] + ["X999999990", "X999999991"], 850),
        })

        rows, complete, report = collect_regional_prices(client, US_IDS, countries=("us", "gb", "de"))

        self.assertEqual(complete, {"us", "de"})
        self.assertFalse(report["gb"]["complete"])
        self.assertIn("HTTP 503", report["gb"]["error"])
        self.assertEqual(report["de"], {"complete": True, "priced": 250, "not_in_us_catalog": 2})
        self.assertEqual({row["country"] for row in rows}, {"us", "de"})
        self.assertEqual(len(rows), 300 + 250)

    def test_low_coverage_or_implausible_country_is_incomplete(self):
        client = FakeFeedClient({
            "us": gendered("us", STYLES, 850),
            "gb": gendered("gb", STYLES[:150] + [f"X8{index:08d}" for index in range(150)], 750),
            "de": {"mens": [], "womens": []},
        })
        _, complete, report = collect_regional_prices(client, US_IDS, countries=("us", "gb", "de"))
        self.assertEqual(complete, {"us"})
        self.assertIn("only 50%", report["gb"]["error"])
        self.assertIn("implausible", report["de"]["error"])

    def test_sync_upserts_and_ages_only_complete_countries(self):
        observed = "2026-11-17T10:00:00+00:00"
        rows = [normalize_regional_price(feed_row(STYLES[0], "gb", 750), "gb")]
        existing = [
            {"catalog_product_id": rows[0]["catalog_product_id"], "country": "gb",
             "first_seen_at": "2026-11-10T00:00:00+00:00", "last_changed_at": "2026-11-10T00:00:00+00:00",
             "source_hash": rows[0]["source_hash"], "status": "active", "missing_runs": 0},
            {"catalog_product_id": "arcteryx:x000000999", "country": "gb", "first_seen_at": "x",
             "last_changed_at": "x", "source_hash": "0" * 64, "status": "missing", "missing_runs": 1},
            {"catalog_product_id": "arcteryx:x000000998", "country": "de", "first_seen_at": "x",
             "last_changed_at": "x", "source_hash": "0" * 64, "status": "active", "missing_runs": 0},
        ]
        client = FakeSupabase(existing)

        result = sync_regional_prices(
            client, {"complete_countries": ["gb"], "rows": rows}, observed_at=observed
        )

        upserts = [entry for entry in client.log if entry[1][0] == "upsert"]
        self.assertEqual(len(upserts), 1)
        upserted = upserts[0][1][1][0]
        self.assertEqual(upserted["first_seen_at"], "2026-11-10T00:00:00+00:00")
        self.assertEqual(upserted["last_changed_at"], "2026-11-10T00:00:00+00:00")
        self.assertEqual((upserted["status"], upserted["last_seen_at"]), ("active", observed))
        self.assertEqual(upserts[0][1][2], "catalog_product_id,country")
        updates = [entry for entry in client.log if entry[1][0] == "update"]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0][1][1]["status"], "inactive")
        self.assertIn(("eq", "country", "gb"), updates[0][2])
        self.assertEqual(result, {"regional_upserted": 1, "regional_aged": 1, "regional_complete_countries": 1})

    def test_sync_refuses_rows_from_incomplete_country(self):
        rows = [normalize_regional_price(feed_row(STYLES[0], "gb", 750), "gb")]
        with self.assertRaises(CatalogSourceError):
            sync_regional_prices(FakeSupabase([]), {"complete_countries": [], "rows": rows}, observed_at="t")


def au_variant(sku, cents, *, compare_at=None):
    variant = {"sku": sku, "price": {"amount": cents, "currency": "AUD"}}
    if compare_at is not None:
        variant["compare_at_price"] = {"amount": compare_at, "currency": "AUD"}
    return variant


def au_product(handle, *variants, collections=(), list_max=0):
    return {
        "id": f"gid://shopify/Product/{abs(hash(handle))}",
        "handle": handle,
        "variants": list(variants),
        "collections": [{"handle": value} for value in collections],
        "list_price_range": {"max": {"amount": list_max, "currency": "AUD"}},
    }


class FakeUcp:
    def __init__(self, products=None, *, walked=True, error=None):
        self.products, self.walked, self.error = products or [], walked, error

    def search_all(self, query, *, max_pages):
        if self.error:
            raise self.error
        return list(self.products), self.walked


@patch.object(regional_prices, "AU_MIN_CATALOG_PRODUCTS", 2)
@patch.object(regional_prices, "AU_MIN_PRICED_STYLES", 1)
class AustraliaPriceTests(unittest.TestCase):
    known = ["arcteryx:x000010521", "arcteryx:x000009239", "arcteryx:x000010735"]

    def test_prices_exact_us_style_ids_only_with_colour_range(self):
        rows, complete, report = collect_au_prices(self.known, client=FakeUcp([
            au_product("cerium-hoody-mens-x00001052101", au_variant("X00001052101", 50000)),
            au_product("cerium-hoody-mens-x00001052106", au_variant("X00001052106", 52000)),
            # Previous-generation style shares the name but not the ID.
            au_product("cerium-hoody-mens-x00000731301", au_variant("X00000731301", 45000)),
            au_product("rho-glove", au_variant("L07880800", 9000)),
        ]))
        self.assertTrue(complete)
        self.assertEqual(report["priced"], 1)
        (row,) = rows
        self.assertEqual(row["catalog_product_id"], "arcteryx:x000010521")
        self.assertEqual((row["list_price"], row["list_price_max"]), (500.0, 520.0))
        self.assertEqual(row["currency"], "AUD")
        self.assertEqual(row["source_name"], "arcteryx_au_shopify_ucp")
        self.assertEqual(row["source_url"], "https://arcteryx.com.au/products/cerium-hoody-mens-x00001052101")
        self.assertRegex(row["source_hash"], r"^[0-9a-f]{64}$")

    def test_discounted_variant_uses_compare_at_and_unproven_sale_style_is_dropped(self):
        rows, complete, report = collect_au_prices(self.known, client=FakeUcp([
            au_product("beta-jacket-womens-x00000923901",
                       au_variant("X00000923901", 30000, compare_at=60000),
                       collections=("sale",), list_max=60000),
            # In the sale collection but no list price exposed: may be a sale price.
            au_product("covert-x00001073501", au_variant("X00001073501", 20000), collections=("outlet",)),
            au_product("covert-x00001073506", au_variant("X00001073506", 30000)),
        ]))
        self.assertTrue(complete)
        self.assertEqual([(row["catalog_product_id"], row["list_price"]) for row in rows],
                         [("arcteryx:x000009239", 600.0)])
        self.assertEqual(report["unproven_styles"], 1)

    def test_failed_short_or_thin_walk_is_an_optional_incomplete_country(self):
        cases = {
            "error": FakeUcp(error=UcpError("UCP search_catalog HTTP 429")),
            "early": FakeUcp([au_product("a-x00001052101", au_variant("X00001052101", 1000))] * 3, walked=False),
            "short": FakeUcp([au_product("a-x00001052101", au_variant("X00001052101", 1000))]),
            "unmatched": FakeUcp([au_product("a", au_variant("X00000000101", 1000))] * 3),
        }
        for name, client in cases.items():
            with self.subTest(name):
                rows, complete, report = collect_au_prices(self.known, client=client)
                self.assertEqual(rows, [])
                self.assertFalse(complete)
                self.assertTrue(report["optional"])
                self.assertIn("error", report)


class RegionalReadbackTests(unittest.TestCase):
    after = datetime(2026, 11, 17, 9, 59, tzinfo=timezone.utc)

    def expected(self, report=None):
        return {"regional_prices": {
            "complete_countries": ["gb", "us"],
            "report": report or {"gb": {"complete": True}, "us": {"complete": True}},
            "rows": [{"catalog_product_id": f"arcteryx:x{index}", "country": country}
                     for country in ("gb", "us") for index in range(3)],
        }}

    def public(self, *, skip=None, stale=False):
        return [
            {"catalog_product_id": f"arcteryx:x{index}", "country": country, "status": "active",
             "last_seen_at": "2026-11-17T09:00:00+00:00" if stale else "2026-11-17T10:00:00+00:00"}
            for country in ("gb", "us") for index in range(3)
            if (country, index) != skip
        ]

    def test_accepts_exact_fresh_regional_readback(self):
        self.assertEqual(
            verify_regional_rows(self.public(), self.expected(), after=self.after, minimum=3),
            {"gb": 3, "us": 3},
        )

    def test_rejects_missing_stale_or_incomplete_regions(self):
        cases = (
            (self.public(skip=("gb", 1)), self.expected()),
            (self.public(stale=True), self.expected()),
            (self.public(), self.expected(report={"gb": {"complete": True}, "us": {"complete": True},
                                                  "de": {"complete": False, "error": "HTTP 503"}})),
        )
        for public, expected in cases:
            with self.subTest(expected=list(expected["regional_prices"]["report"])), self.assertRaises(CatalogReadbackError):
                verify_regional_rows(public, expected, after=self.after, minimum=3)

    def test_incomplete_australia_keeps_old_rows_without_failing(self):
        expected = self.expected(report={"gb": {"complete": True}, "us": {"complete": True},
                                         "au": {"complete": False, "optional": True, "error": "HTTP 429"}})
        old_au = {"catalog_product_id": "arcteryx:x9", "country": "au", "status": "active",
                  "last_seen_at": "2026-11-16T10:00:00+00:00"}
        self.assertEqual(
            verify_regional_rows(self.public() + [old_au], expected, after=self.after, minimum=3),
            {"gb": 3, "us": 3},
        )

    def test_complete_australia_uses_its_own_minimum(self):
        expected = self.expected(report={"gb": {"complete": True}, "us": {"complete": True},
                                         "au": {"complete": True, "optional": True}})
        expected["regional_prices"]["complete_countries"].append("au")
        expected["regional_prices"]["rows"].append({"catalog_product_id": "arcteryx:x1", "country": "au"})
        au_row = {"catalog_product_id": "arcteryx:x1", "country": "au", "status": "active",
                  "last_seen_at": "2026-11-17T10:00:00+00:00"}
        with self.assertRaisesRegex(CatalogReadbackError, "au regional prices 1 below minimum 120"):
            verify_regional_rows(self.public() + [au_row], expected, after=self.after, minimum=3)

    def test_runs_without_regional_state_skip_the_check(self):
        self.assertIsNone(verify_regional_rows([], {}, after=self.after))


if __name__ == "__main__":
    unittest.main()
