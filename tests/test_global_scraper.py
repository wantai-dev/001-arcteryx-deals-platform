import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from tools.shopify_ucp import UcpError
from global_scraper import (
    REGIONS,
    fetch_json,
    scrape_au_ucp_sale,
    ucp_product_records,
    next_stable_bottom_rounds,
    outlet_link_gender,
    unisex_scope_result,
)


class OutletRegionConfigTests(unittest.TestCase):
    def test_finland_and_ireland_use_official_euro_outlet_routes(self):
        by_code = {region["code"]: region for region in REGIONS}

        for code in ("fi", "ie"):
            self.assertEqual(by_code[code]["lang"], "en")
            self.assertEqual(by_code[code]["currency"], "EUR")
            self.assertEqual(by_code[code]["symbol"], "€")


class GlobalScraperScrollTests(unittest.TestCase):
    def test_stability_does_not_advance_before_bottom(self):
        rounds = next_stable_bottom_rounds(
            at_bottom=False,
            count=80,
            height=24000,
            previous_count=80,
            previous_height=24000,
            current_rounds=3,
        )
        self.assertEqual(rounds, 0)

    def test_stability_advances_only_for_same_bottom_state(self):
        rounds = next_stable_bottom_rounds(
            at_bottom=True,
            count=98,
            height=26000,
            previous_count=98,
            previous_height=26000,
            current_rounds=2,
        )
        self.assertEqual(rounds, 3)
        reset = next_stable_bottom_rounds(
            at_bottom=True,
            count=99,
            height=26100,
            previous_count=98,
            previous_height=26000,
            current_rounds=3,
        )
        self.assertEqual(reset, 0)


class OutletListingLinkTests(unittest.TestCase):
    def test_classifies_gendered_and_unisex_product_links(self):
        self.assertEqual(
            outlet_link_gender("https://outlet.arcteryx.com/us/en/shop/mens/beta-ar-jacket-9906"),
            "men",
        )
        self.assertEqual(
            outlet_link_gender("https://outlet.arcteryx.com/gb/en/shop/womens/konseal-shoe-9970"),
            "women",
        )
        self.assertEqual(
            outlet_link_gender("https://outlet.arcteryx.com/us/en/shop/ribbed-toque-9930?colour=Black"),
            "unisex",
        )

    def test_rejects_category_links(self):
        for url in (
            "https://outlet.arcteryx.com/shop/mens",
            "https://outlet.arcteryx.com/shop/mens/",
            "https://outlet.arcteryx.com/shop/womens",
            "https://outlet.arcteryx.com/shop/womens/",
            "https://outlet.arcteryx.com/us/en/c/mens",
        ):
            with self.subTest(url=url):
                self.assertIsNone(outlet_link_gender(url))

    def test_unisex_scope_requires_every_gender_page_to_complete(self):
        urls = {"https://outlet.arcteryx.com/gb/en/shop/mallow-toque"}
        complete = unisex_scope_result("gb", urls, [True, True], 2)
        self.assertEqual(complete["status"], "success")
        self.assertEqual(complete["gender"], "unisex")
        self.assertEqual(complete["urls"], sorted(urls))
        self.assertEqual(unisex_scope_result("gb", urls, [True, False], 2)["status"], "failed")
        self.assertEqual(unisex_scope_result("gb", urls, [True], 2)["status"], "failed")


class OfficialJsonRetryTests(unittest.TestCase):
    @staticmethod
    def response(payload: bytes):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = payload
        return response

    @staticmethod
    def http_error(status: int, retry_after: str | None = None):
        headers = {"Retry-After": retry_after} if retry_after is not None else {}
        return urllib.error.HTTPError(
            "https://arcteryx.com.au/collections/sale/products.json",
            status,
            "test error",
            headers,
            None,
        )

    @patch("global_scraper.time.sleep")
    @patch("global_scraper.urllib.request.urlopen")
    def test_retries_429_then_returns_official_json(self, urlopen, sleep):
        urlopen.side_effect = [
            self.http_error(429, retry_after="7"),
            self.response(b'{"products": [{"id": 1}]}'),
        ]

        payload = fetch_json("https://example.test/products.json", attempts=2)

        self.assertEqual(payload, {"products": [{"id": 1}]})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(7.0)

    @patch("global_scraper.time.sleep")
    @patch("global_scraper.urllib.request.urlopen")
    def test_uses_bounded_backoff_for_429_without_retry_after(self, urlopen, sleep):
        urlopen.side_effect = [
            self.http_error(429),
            self.http_error(429),
            self.http_error(429),
        ]

        with self.assertRaises(urllib.error.HTTPError):
            fetch_json(
                "https://example.test/products.json",
                attempts=3,
                base_retry_delay=20,
            )

        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [20, 40])

    @patch("global_scraper.time.sleep")
    @patch("global_scraper.urllib.request.urlopen")
    def test_does_not_retry_nontransient_http_error(self, urlopen, sleep):
        urlopen.side_effect = self.http_error(404)

        with self.assertRaises(urllib.error.HTTPError):
            fetch_json("https://example.test/products.json")

        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()


AU_REGION = next(region for region in REGIONS if region["code"] == "au")


def au_money(amount):
    return {"amount": amount, "currency": "AUD"}


def au_variant(color, size, price, compare_at=None, available=True, list_price=None):
    variant = {
        "title": f"{color} / {size}",
        "price": au_money(price),
        "availability": {"available": available},
        "options": [{"name": "Color", "label": color}, {"name": "Size", "label": size}],
        "media": [{"type": "image", "url": f"https://cdn.example/{color}.jpg"}],
    }
    if compare_at is not None:
        variant["compare_at_price"] = au_money(compare_at)
    if list_price is not None:
        variant["list_price"] = au_money(list_price)
    return variant


def au_product(handle, title, variants, collections=("mens",)):
    return {
        "id": f"gid://shopify/Product/{abs(hash(handle)) % 10**9}",
        "handle": handle,
        "title": title,
        "description": {"html": "<p>Shell jacket</p>"},
        "tags": ["gender:men"],
        "media": [{"type": "image", "url": "https://cdn.example/product.jpg"}],
        "collections": [{"handle": handle_} for handle_ in collections],
        "variants": variants,
    }


class AuUcpSaleTests(unittest.TestCase):
    def test_maps_discounted_variants_to_color_rows(self):
        product = au_product("beta-sl-jacket-mens-x00000968101", "Beta SL Jacket Men's", [
            au_variant("Black", "S", 59500, compare_at=82000),
            au_variant("Black", "M", 59500, compare_at=82000, available=False),
            au_variant("Blue", "M", 82000, compare_at=82000),
            au_variant("Green", "L", 61500, list_price=82000, available=False),
        ], collections=("mens", "sale"))

        rows = ucp_product_records(product, AU_REGION, "2026-11-16 00:00:00")

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["sku_id"], "beta-sl-jacket-mens-x00000968101_Black_au")
        self.assertEqual(row["url"], "https://arcteryx.com.au/products/beta-sl-jacket-mens-x00000968101")
        self.assertEqual((row["sale_price"], row["original_price"], row["discount_pct"]), (595.0, 820.0, 27))
        self.assertEqual(row["sizes"], ["S", "M"])
        self.assertEqual(row["size_stock"], {"S": "in_stock", "M": "out_of_stock"})
        self.assertEqual(row["gender"], "men")
        self.assertEqual(row["currency"], "AUD")
        self.assertEqual(row["image_url"], "https://cdn.example/Black.jpg")
        self.assertEqual(row["source"], "arcteryx_au_shopify_sale")

    def walk(self, products, complete=True):
        client = MagicMock()
        client.search_all.return_value = (products, complete)
        return scrape_au_ucp_sale(AU_REGION, client=client)

    def full_price_catalog(self, count=400):
        return [
            au_product(f"product-{i}", f"Product {i} Men's", [au_variant("Black", "M", 50000)])
            for i in range(count)
        ]

    def test_complete_walk_without_discounts_is_an_authoritative_empty_sale(self):
        rows, complete = self.walk(self.full_price_catalog())
        self.assertEqual(rows, [])
        self.assertTrue(complete)

    def test_incomplete_or_tiny_walk_is_not_authoritative(self):
        self.assertEqual(self.walk(self.full_price_catalog(), complete=False), ([], False))
        self.assertEqual(self.walk(self.full_price_catalog(count=20)), ([], False))

    def test_sale_members_without_any_price_pair_fail_closed(self):
        catalog = self.full_price_catalog()
        catalog[0]["collections"] = [{"handle": "sale"}]
        with self.assertRaises(UcpError):
            self.walk(catalog)

    def test_complete_walk_returns_discounted_rows(self):
        catalog = self.full_price_catalog()
        catalog[0]["variants"] = [au_variant("Black", "M", 40000, compare_at=50000)]
        rows, complete = self.walk(catalog)
        self.assertTrue(complete)
        self.assertEqual([row["sku_id"] for row in rows], ["product-0_Black_au"])
