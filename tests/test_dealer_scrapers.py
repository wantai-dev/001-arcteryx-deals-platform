import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from dealers.backcountry import Scraper as BackcountryScraper
from dealers.burton import Scraper as BurtonScraper
from dealers.evo import Scraper as EvoScraper
from dealers.mec import Scraper as MecScraper, _enrich_items
from dealers.rei import Scraper as ReiScraper
from tools.shopify_ucp import UcpError


ROOT = Path(__file__).resolve().parent.parent


class DealerScraperTests(unittest.TestCase):
    def test_evo_ucp_decodes_structured_and_text_results(self):
        structured = {
            "result": {
                "structuredContent": {
                    "ucp": {"status": "success"},
                    "products": [],
                    "pagination": {"has_next_page": False},
                }
            }
        }
        text_only = {
            "result": {
                "content": [{"type": "text", "text": json.dumps({"products": []})}]
            }
        }

        self.assertEqual(EvoScraper._decode_ucp_result(structured)["products"], [])
        self.assertEqual(EvoScraper._decode_ucp_result(text_only)["products"], [])

    def test_evo_ucp_discovers_trusted_mcp_endpoint(self):
        scraper = EvoScraper()
        document = {
            "ucp": {
                "services": {
                    "dev.ucp.shopping": [
                        {"transport": "embedded"},
                        {
                            "transport": "mcp",
                            "endpoint": "https://store-id.myshopify.com/api/ucp/mcp",
                        },
                    ]
                }
            }
        }

        with patch.object(scraper, "_fetch_json", return_value=document):
            endpoint = scraper._discover_ucp_endpoint()

        self.assertEqual(endpoint, "https://store-id.myshopify.com/api/ucp/mcp")

    def test_evo_ucp_paginates_and_publishes_ucp_prices(self):
        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"patagonia": 2}
        pages = [
            {
                "products": [{
                    "title": "Patagonia First Jacket - Women's",
                    "handle": "patagonia-first-jacket-women-s",
                    "variants": [{
                        "availability": {"available": False},
                        "price": {"amount": 5000, "currency": "USD"},
                        "list_price": {"amount": 20000, "currency": "USD"},
                        "options": [{"name": "Size", "label": "XS"}],
                    }, {
                        "availability": {"available": True},
                        "price": {"amount": 12000, "currency": "USD"},
                        "list_price": {"amount": 20000, "currency": "USD"},
                        "options": [
                            {"name": "Color", "label": "Black"},
                            {"name": "Size", "label": "M"},
                        ],
                        "media": [{"type": "image", "url": "https://cdn.example/first.jpg"}],
                    }],
                }],
                "pagination": {"has_next_page": True, "cursor": "next-page"},
            },
            {
                "products": [{
                    "title": "Patagonia Second Jacket - Men's",
                    "url": "https://www.evo.com/products/patagonia-second-jacket-men-s",
                    "variants": [{
                        "availability": {"available": True},
                        "price": {"amount": 12000, "currency": "USD"},
                        "list_price": {"amount": 20000, "currency": "USD"},
                        "options": [
                            {"name": "Color", "label": "Blue"},
                            {"name": "Size", "label": "L"},
                        ],
                    }],
                }],
                "pagination": {"has_next_page": False, "cursor": None},
            },
        ]

        def pdp(handle):
            return {
                "available": True,
                "handle": handle,
                "vendor": "Patagonia",
                "title": handle.replace("-", " ").title(),
                "type": "Jackets",
                "variants": [{
                    "available": True,
                    "price": 12000,
                    "compare_at_price": 20000,
                    "option1": "Black",
                    "option2": "M",
                }],
            }

        with patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", side_effect=pages) as ucp_call, patch.object(
            scraper, "_fetch_pdp_json", side_effect=pdp
        ) as fetch_pdp, patch.object(scraper, "_spot_check_ucp_prices", return_value=True) as spot:
            items, complete = scraper._scrape_ucp()

        self.assertTrue(complete)
        self.assertEqual(len(items), 2)
        self.assertEqual([item["price_source_quality"] for item in items], ["ucp", "ucp"])
        self.assertEqual([item["gender"] for item in items], ["women", "men"])
        self.assertEqual(items[0]["sale_price"], 120.0)
        self.assertEqual(items[0]["original_price"], 200.0)
        self.assertEqual(items[0]["sizes"], ["M"])
        self.assertEqual(items[0]["image"], "https://cdn.example/first.jpg")
        fetch_pdp.assert_not_called()
        spot.assert_called_once_with(items)
        first_args = ucp_call.call_args_list[0].args[2]
        self.assertEqual(first_args["catalog"]["pagination"]["limit"], 50)
        second_args = ucp_call.call_args_list[1].args[2]
        self.assertNotIn("cursor", first_args["catalog"]["pagination"])
        self.assertEqual(second_args["catalog"]["pagination"]["cursor"], "next-page")

    def test_evo_ucp_custom_bundle_uses_unique_exact_yearless_sibling_image(self):
        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"burton": 2}
        image_url = "https://cdn.example/burton-fish-bundle.jpg"
        page = {
            "products": [{
                "title": "Burton Fish 3D Splitboard + Step On Splitboard Bindings 2026",
                "handle": "burton-fish-bundle-2026",
                "tags": ["type:custom-bundle"],
                "variants": [{
                    "availability": {"available": True},
                    "price": {"amount": 97643, "currency": "USD"},
                    "list_price": {"amount": 154990, "currency": "USD"},
                }],
            }, {
                "title": "Burton Fish 3D Splitboard + Step On Splitboard Bindings",
                "handle": "burton-fish-bundle",
                "tags": ["type:custom-bundle"],
                "variants": [{
                    "availability": {"available": True},
                    "price": {"amount": 97643, "currency": "USD"},
                    "list_price": {"amount": 154990, "currency": "USD"},
                    "media": [{"type": "image", "url": image_url}],
                }],
            }],
            "pagination": {"has_next_page": False, "cursor": None},
        }

        def pdp(handle):
            return {
                "available": True,
                "handle": handle,
                "vendor": "Burton",
                "title": handle,
                "variants": [{
                    "available": True,
                    "price": 97643,
                    "compare_at_price": 154990,
                }],
            }

        with patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", return_value=page), patch.object(
            scraper, "_fetch_pdp_json", side_effect=pdp
        ), patch.object(scraper, "_spot_check_ucp_prices", return_value=True):
            items, complete = scraper._scrape_ucp()

        self.assertTrue(complete)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["image"], image_url)
        self.assertEqual(items[1]["image"], image_url)

    def test_evo_ucp_repeated_cursor_fails_closed_before_pdp_reads(self):
        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"burton": 1}
        page = {
            "products": [{"title": "Burton Test Board", "handle": "burton-test-board"}],
            "pagination": {"has_next_page": True, "cursor": "same"},
        }
        with patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", side_effect=[page, page]), patch.object(
            scraper, "_fetch_pdp_json"
        ) as fetch_pdp:
            items, complete = scraper._scrape_ucp()

        self.assertEqual(items, [])
        self.assertFalse(complete)
        fetch_pdp.assert_not_called()

    @staticmethod
    def _evo_pdp_html(handle, variants, decoy=None):
        meta = {"product": {"id": 1, "vendor": "Arc'teryx", "handle": handle,
                            "variants": [{"id": v["id"], "price": v["price"]} for v in variants]}}
        objects = [dict({"id": v["id"], "title": "Black / M", "option1": "Black", "option2": "M"}, **v) for v in variants]
        parts = ["<script>var meta = " + json.dumps(meta, separators=(",", ":")) + ";</script>"]
        parts += ["<script>x(" + json.dumps(obj, separators=(",", ":")) + ")</script>" for obj in objects]
        if decoy:
            parts.append("<script>" + json.dumps(dict({"title": "Other"}, **decoy), separators=(",", ":")) + "</script>")
        return "<html>" + "".join(parts) + "</html>"

    def test_evo_pdp_html_parser_reads_only_this_products_variants(self):
        html = self._evo_pdp_html(
            "241512-arc-teryx-atom-jacket-men-s",
            [
                {"id": 11, "available": True, "price": 16800, "compare_at_price": 28000},
                {"id": 12, "available": False, "price": 9900, "compare_at_price": 28000},
            ],
            decoy={"id": 99, "available": True, "price": 100, "compare_at_price": 99900},
        )

        pdp = EvoScraper.parse_pdp_html(html)

        self.assertEqual([variant["id"] for variant in pdp["variants"]], [11, 12])
        parsed = EvoScraper.parse_pdp_product(pdp)
        self.assertEqual((parsed["sale_price"], parsed["original_price"]), (168.0, 280.0))
        self.assertIsNone(EvoScraper.parse_pdp_html("<html>no meta</html>"))

    def _evo_spot_items(self, count):
        return [{
            "url": f"https://www.evo.com/products/item-{i}",
            "sale_price": 168.0,
            "original_price": 280.0,
            "price_source_quality": "ucp",
        } for i in range(count)]

    def _evo_spot_check(self, items, pages, env=None):
        scraper = EvoScraper()
        scraper._rng = __import__("random").Random(0)
        environment = {"EVO_UCP_SPOT_DELAY_MS": "0", "EVO_UCP_SPOT_CHECKS": "5", "EVO_UCP_SPOT_MIN": "3"}
        environment.update(env or {})
        with patch.dict(os.environ, environment), patch.object(scraper, "_fetch_pdp_html", side_effect=pages) as fetch:
            result = scraper._spot_check_ucp_prices(items)
        return scraper, result, fetch

    def test_evo_spot_check_passes_when_sampled_pdps_match(self):
        page = self._evo_pdp_html("x", [{"id": 1, "available": True, "price": 16800, "compare_at_price": 28000}])
        scraper, result, fetch = self._evo_spot_check(self._evo_spot_items(10), lambda handle: page)
        self.assertTrue(result)
        self.assertEqual(fetch.call_count, 5)
        self.assertFalse(scraper.pdp_confirmation_failed)

    def test_evo_spot_check_refuses_on_any_mismatch(self):
        good = self._evo_pdp_html("x", [{"id": 1, "available": True, "price": 16800, "compare_at_price": 28000}])
        bad = self._evo_pdp_html("x", [{"id": 1, "available": True, "price": 15000, "compare_at_price": 28000}])
        sold_out = self._evo_pdp_html("x", [{"id": 1, "available": False, "price": 16800, "compare_at_price": 28000}])
        for odd in (bad, sold_out):
            with self.subTest(odd=odd[-80:]):
                pages = iter([good, good, odd, good, good])
                scraper, result, _ = self._evo_spot_check(self._evo_spot_items(10), lambda handle: next(pages))
                self.assertFalse(result)
                self.assertTrue(scraper.pdp_confirmation_failed)

    def test_evo_spot_check_requires_minimum_verified_samples(self):
        good = self._evo_pdp_html("x", [{"id": 1, "available": True, "price": 16800, "compare_at_price": 28000}])
        pages = iter([good, None, None, good, None, None, None, None, None, None])
        scraper, result, fetch = self._evo_spot_check(self._evo_spot_items(10), lambda handle: next(pages))
        self.assertFalse(result)
        self.assertTrue(scraper.pdp_confirmation_failed)
        self.assertEqual(fetch.call_count, 10)

    def test_evo_ucp_halves_page_size_when_a_page_keeps_failing(self):
        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"burton": 1}
        page = {
            "products": [{
                "title": "Burton Test Board",
                "handle": "burton-test-board",
                "variants": [{
                    "availability": {"available": True},
                    "price": {"amount": 30000, "currency": "USD"},
                    "list_price": {"amount": 50000, "currency": "USD"},
                }],
            }],
            "pagination": {"has_next_page": False, "cursor": None},
        }
        def responses(statuses):
            remaining = list(statuses)

            def call(*args):
                status = remaining.pop(0)
                scraper.last_fetch_status = status
                if status != 200:
                    raise ValueError(f"HTTP {status}")
                return page
            return call

        with patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(
            scraper, "_ucp_call", side_effect=responses([500, 500, 200])
        ) as ucp_call, patch.object(scraper, "_spot_check_ucp_prices", return_value=True):
            items, complete = scraper._scrape_ucp()

        self.assertTrue(complete)
        self.assertEqual(len(items), 1)
        limits = [call.args[2]["catalog"]["pagination"]["limit"] for call in ucp_call.call_args_list]
        self.assertEqual(limits, [50, 25, 12])

        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"burton": 1}
        with patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", side_effect=responses([429])) as ucp_call:
            items, complete = scraper._scrape_ucp()

        self.assertEqual((items, complete), ([], False))
        self.assertEqual(ucp_call.call_count, 1)

    @staticmethod
    def _evo_ucp_variant(price, compare, available=True, size="M"):
        return {
            "availability": {"available": available},
            "price": {"amount": price, "currency": "USD"},
            "list_price": {"amount": compare, "currency": "USD"},
            "options": [{"name": "Color", "label": "Black"}, {"name": "Size", "label": size}],
        }

    def _evo_truncated_product(self, handle, variants, price_min, list_max):
        return {
            "title": "Arc'teryx Sentinel Tall Pants - Women's",
            "handle": handle,
            "variants": variants,
            "price_range": {"min": {"amount": price_min, "currency": "USD"}},
            "list_price_range": {"max": {"amount": list_max, "currency": "USD"}},
        }

    def test_evo_ucp_variant_list_authority(self):
        full = [self._evo_ucp_variant(42000, 60000, available=False, size=str(i)) for i in range(8)]
        provable = full + [self._evo_ucp_variant(33695, 60000, size="L"), self._evo_ucp_variant(35999, 60000, size="XL")]
        cases = {
            "complete": (self._evo_truncated_product("a", full[:3], 33695, 60000), True),
            "truncated provable": (self._evo_truncated_product("b", provable, 33695, 60000), True),
            "cheaper variant truncated": (self._evo_truncated_product("c", provable, 30000, 60000), False),
            "higher list price truncated": (self._evo_truncated_product("d", provable, 33695, 70000), False),
            "no available variant returned": (self._evo_truncated_product("e", full + full[:2], 33695, 60000), False),
        }
        for name, (product, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(EvoScraper._ucp_variants_authoritative(product), expected)

    def test_evo_truncated_unprovable_product_is_read_from_pdp_page(self):
        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"arcteryx": 1}
        handle = "254412-arc-teryx-sentinel-tall-pants-women-s"
        variants = [self._evo_ucp_variant(42000, 60000, available=False, size=str(i)) for i in range(8)]
        variants += [self._evo_ucp_variant(35999, 60000, size="12"), self._evo_ucp_variant(35999, 60000, size="14")]
        page = {
            "products": [self._evo_truncated_product(handle, variants, 33695, 60000)],
            "pagination": {"has_next_page": False, "cursor": None},
        }
        pdp_page = {
            "handle": handle,
            "vendor": "Arc'teryx",
            "variants": [
                {"available": True, "price": 33695, "compare_at_price": 60000, "option1": "Blaze", "option2": "6"},
                {"available": True, "price": 35999, "compare_at_price": 60000, "option1": "Stratus", "option2": "12"},
            ],
        }
        with patch.dict(os.environ, {"EVO_PDP_HTML_DELAY_MS": "0"}), patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", return_value=page), patch.object(
            scraper, "_pdp_from_html", return_value=pdp_page
        ) as pdp_from_html, patch.object(scraper, "_spot_check_ucp_prices", return_value=True):
            items, complete = scraper._scrape_ucp()

        pdp_from_html.assert_called_once_with(handle)
        self.assertTrue(complete)
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]["sale_price"], items[0]["original_price"]), (336.95, 600.0))
        self.assertEqual(items[0]["price_source_quality"], "pdp")
        self.assertEqual(items[0]["sizes"], ["6", "12"])

    def test_evo_unreadable_pdp_page_refuses_snapshot(self):
        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"arcteryx": 1}
        variants = [self._evo_ucp_variant(42000, 60000, available=False, size=str(i)) for i in range(10)]
        page = {
            "products": [self._evo_truncated_product("x-pants", variants, 33695, 60000)],
            "pagination": {"has_next_page": False, "cursor": None},
        }
        with patch.dict(os.environ, {"EVO_PDP_HTML_DELAY_MS": "0"}), patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", return_value=page), patch.object(
            scraper, "_pdp_from_html", return_value=None
        ), patch.object(scraper, "_spot_check_ucp_prices") as spot:
            items, complete = scraper._scrape_ucp()

        self.assertEqual(items, [])
        self.assertFalse(complete)
        self.assertTrue(scraper.pdp_confirmation_failed)
        spot.assert_not_called()

    def test_evo_spot_check_only_samples_ucp_priced_items(self):
        page = self._evo_pdp_html("x", [{"id": 1, "available": True, "price": 16800, "compare_at_price": 28000}])
        items = self._evo_spot_items(6)
        for item in items[:4]:
            item["price_source_quality"] = "pdp"
        scraper, result, fetch = self._evo_spot_check(items, lambda handle: page, env={"EVO_UCP_SPOT_MIN": "2"})
        self.assertTrue(result)
        self.assertEqual(fetch.call_count, 2)

    def test_evo_ucp_snapshot_is_refused_when_spot_check_fails(self):
        scraper = EvoScraper()
        scraper.MIN_ITEMS_BY_BRAND = {"burton": 1}
        page = {
            "products": [{
                "title": "Burton Test Board",
                "handle": "burton-test-board",
                "variants": [{
                    "availability": {"available": True},
                    "price": {"amount": 30000, "currency": "USD"},
                    "list_price": {"amount": 50000, "currency": "USD"},
                }],
            }],
            "pagination": {"has_next_page": False, "cursor": None},
        }
        with patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", return_value=page), patch.object(
            scraper, "_spot_check_ucp_prices", return_value=False
        ):
            items, complete = scraper._scrape_ucp()

        self.assertEqual(items, [])
        self.assertFalse(complete)

    def test_evo_scrape_prefers_complete_ucp_snapshot(self):
        scraper = EvoScraper()
        ucp_items = [{"url": "https://www.evo.com/products/ucp"}]
        with patch.object(scraper, "_scrape_ucp", return_value=(ucp_items, True)), patch.object(
            scraper, "_scrape_http"
        ) as http, patch.object(scraper, "_scrape_browser") as browser:
            self.assertEqual(scraper.scrape(), ucp_items)

        http.assert_not_called()
        browser.assert_not_called()
        self.assertTrue(scraper.crawl_complete)

    @patch("dealers.evo.time.sleep")
    @patch("dealers.evo.curl_requests")
    def test_evo_ucp_retries_transient_500_then_succeeds(self, curl_requests, sleep):
        first = MagicMock(status_code=500, text="internal error", headers={})
        second = MagicMock(status_code=200)
        second.json.return_value = {"result": {"structuredContent": {"products": []}}}
        curl_requests.post.side_effect = [first, second]

        result = EvoScraper()._post_ucp_json(
            "https://store.myshopify.com/api/ucp/mcp",
            {"method": "tools/call"},
            retries=1,
        )

        self.assertEqual(result, second.json.return_value)
        self.assertEqual(curl_requests.post.call_count, 2)
        sleep.assert_called_once_with(15)

    @patch("dealers.evo.time.sleep")
    @patch("dealers.evo.curl_requests")
    def test_evo_ucp_does_not_retry_permanent_403(self, curl_requests, sleep):
        curl_requests.post.return_value = MagicMock(
            status_code=403,
            text="forbidden",
            headers={},
        )

        result = EvoScraper()._post_ucp_json(
            "https://store.myshopify.com/api/ucp/mcp",
            {"method": "tools/call"},
            retries=2,
        )

        self.assertIsNone(result)
        self.assertEqual(curl_requests.post.call_count, 1)
        sleep.assert_not_called()

    @patch("dealers.evo.time.sleep")
    @patch("dealers.evo.curl_requests")
    def test_evo_ucp_transient_retry_exhaustion_returns_none(self, curl_requests, sleep):
        curl_requests.post.return_value = MagicMock(
            status_code=503,
            text="unavailable",
            headers={},
        )

        result = EvoScraper()._post_ucp_json(
            "https://store.myshopify.com/api/ucp/mcp",
            {"method": "tools/call"},
            retries=2,
        )

        self.assertIsNone(result)
        self.assertEqual(curl_requests.post.call_count, 3)
        self.assertEqual([item.args[0] for item in sleep.call_args_list], [15, 30])

    @patch("dealers.evo.time.sleep")
    @patch("dealers.evo.curl_requests")
    def test_evo_retries_pdp_429_with_bounded_backoff(self, curl_requests, sleep):
        first = MagicMock(status_code=429, text="rate limited", headers={})
        second = MagicMock(status_code=200)
        second.json.return_value = {"available": True, "variants": []}
        curl_requests.get.side_effect = [first, second]

        result = EvoScraper()._fetch_json("https://www.evo.com/products/example.js", retries=1)

        self.assertEqual(result, {"available": True, "variants": []})
        self.assertEqual(curl_requests.get.call_count, 2)
        sleep.assert_called_once_with(15)

    def test_evo_pdp_parser_ignores_unavailable_clearance_variants(self):
        product = {
            "available": True,
            "handle": "patagonia-baggies-5-shorts-women-s",
            "vendor": "Patagonia",
            "variants": [
                {
                    "available": False,
                    "price": 4799,
                    "compare_at_price": 7500,
                    "option1": "Archive Yellow",
                    "option2": "XS",
                },
                {
                    "available": True,
                    "price": 6900,
                    "compare_at_price": 6900,
                    "option1": "Black",
                    "option2": "S",
                },
            ],
        }

        parsed = EvoScraper.parse_pdp_product(product)

        self.assertEqual(parsed["sale_price"], 69.0)
        self.assertEqual(parsed["original_price"], 69.0)
        self.assertEqual(len(parsed["variants"]), 1)
        self.assertEqual(parsed["variants"][0]["option1"], "Black")

    def test_evo_pdp_parser_marks_product_without_available_variants_unavailable(self):
        parsed = EvoScraper.parse_pdp_product({
            "available": False,
            "variants": [{"available": False, "price": 4799}],
        })

        self.assertEqual(parsed, {"available": False, "variants": []})

    def test_evo_http_snapshot_publishes_pdp_price_instead_of_collection_price(self):
        scraper = EvoScraper()
        scraper.COLLECTIONS = [("patagonia", "auto", "patagonia")]
        collection_product = {
            "vendor": "Patagonia",
            "handle": "patagonia-baggies-5-shorts-women-s",
            "title": "Patagonia Baggies 5 Shorts - Women's",
            "product_type": "Shorts",
            "variants": [{"available": True, "price": "47.99", "compare_at_price": "75.00"}],
        }
        pdp_product = {
            "available": True,
            "handle": collection_product["handle"],
            "vendor": "Patagonia",
            "title": collection_product["title"],
            "variants": [{
                "available": True,
                "price": 6900,
                "compare_at_price": 6900,
                "option1": "Black",
                "option2": "S",
            }],
        }

        with patch.object(scraper, "_fetch_json", return_value={"products": [collection_product]}), patch.object(
            scraper, "_fetch_pdp_json", return_value=pdp_product
        ):
            items, complete = scraper._scrape_http()

        self.assertTrue(complete)
        self.assertEqual(items[0]["sale_price"], 69.0)
        self.assertEqual(items[0]["original_price"], 69.0)
        self.assertEqual(items[0]["price_source_quality"], "pdp")

    def test_evo_http_snapshot_fails_closed_when_pdp_confirmation_fails(self):
        scraper = EvoScraper()
        scraper.COLLECTIONS = [("patagonia", "auto", "patagonia")]
        collection_product = {
            "vendor": "Patagonia",
            "handle": "patagonia-baggies-5-shorts-women-s",
            "variants": [{"available": True, "price": "47.99", "compare_at_price": "75.00"}],
        }

        with patch.object(scraper, "_fetch_json", return_value={"products": [collection_product]}), patch.object(
            scraper, "_fetch_pdp_json", return_value=None
        ):
            items, complete = scraper._scrape_http()

        self.assertEqual(items, [])
        self.assertFalse(complete)
        self.assertTrue(scraper.pdp_confirmation_failed)

    def test_evo_http_snapshot_skips_missing_pdp_product(self):
        scraper = EvoScraper()
        scraper.COLLECTIONS = [("patagonia", "auto", "patagonia")]
        collection_product = {
            "vendor": "Patagonia",
            "handle": "patagonia-discontinued-item",
            "variants": [{"available": True, "price": "47.99", "compare_at_price": "75.00"}],
        }

        def missing_pdp(_handle):
            scraper.last_fetch_status = 404
            return None

        with patch.object(scraper, "_fetch_json", return_value={"products": [collection_product]}), patch.object(
            scraper, "_fetch_pdp_json", side_effect=missing_pdp
        ):
            items, complete = scraper._scrape_http()

        self.assertEqual(items, [])
        self.assertTrue(complete)
        self.assertFalse(scraper.pdp_confirmation_failed)

    def test_evo_browser_fallback_replaces_list_price_with_pdp_price(self):
        scraper = EvoScraper()
        item = {
            "url": "https://www.evo.com/products/patagonia-baggies-5-shorts-women-s",
            "name": "Patagonia Baggies 5 Shorts - Women's",
            "brand": "patagonia",
            "sale_price": 47.99,
            "original_price": 75.0,
            "discount_pct": 36,
            "price_source_quality": "list_fallback",
            "sizes": ["XS"],
            "colors": ["Archive Yellow"],
        }
        pdp_product = {
            "available": True,
            "handle": "patagonia-baggies-5-shorts-women-s",
            "vendor": "Patagonia",
            "title": item["name"],
            "variants": [{
                "available": True,
                "price": 6900,
                "compare_at_price": 6900,
                "option1": "Black",
                "option2": "S",
            }],
        }

        with patch.object(scraper, "_fetch_pdp_json", return_value=pdp_product):
            confirmed = scraper._confirm_browser_item_with_pdp(item)

        self.assertEqual(confirmed["sale_price"], 69.0)
        self.assertEqual(confirmed["original_price"], 69.0)
        self.assertEqual(confirmed["price_source_quality"], "pdp")
        self.assertEqual(confirmed["colors"], ["Black"])

    def test_evo_browser_fallback_fails_closed_when_pdp_confirmation_fails(self):
        scraper = EvoScraper()
        item = {
            "url": "https://www.evo.com/products/patagonia-baggies-5-shorts-women-s",
            "brand": "patagonia",
            "sale_price": 47.99,
            "original_price": 75.0,
        }

        with patch.object(scraper, "_fetch_pdp_json", return_value=None):
            confirmed = scraper._confirm_browser_item_with_pdp(item)

        self.assertIsNone(confirmed)
        self.assertTrue(scraper.pdp_confirmation_failed)

    def test_evo_browser_fallback_skips_missing_pdp_product(self):
        scraper = EvoScraper()
        item = {
            "url": "https://www.evo.com/products/discontinued-item",
            "brand": "patagonia",
            "sale_price": 47.99,
            "original_price": 75.0,
        }

        def missing_pdp(_handle):
            scraper.last_fetch_status = 404
            return None

        with patch.object(scraper, "_fetch_pdp_json", side_effect=missing_pdp):
            confirmed = scraper._confirm_browser_item_with_pdp(item)

        self.assertIsNone(confirmed)
        self.assertFalse(scraper.pdp_confirmation_failed)

    @staticmethod
    def _burton_ucp_product(product_id, title, variants):
        return {
            "id": f"gid://shopify/Product/{product_id}",
            "title": title,
            "handle": title.lower().replace(" ", "-"),
            "variants": variants,
        }

    @staticmethod
    def _burton_ucp_variant(color, size, available, amount=69995):
        return {
            "price": {"amount": amount, "currency": "USD"},
            "list_price": {"amount": amount, "currency": "USD"},
            "availability": {"available": available},
            "options": [{"name": "Color", "label": color}, {"name": "Size", "label": size}],
        }

    def _burton_card(self, source_id, name, sale="$461.97", original="$659.95", colors=None):
        slug = name.lower().replace(" ", "-").replace("'", "")
        return {
            "source_id": source_id,
            "url": f"/en-us/products/{slug}",
            "name": name,
            "image": "//www.burton.com/cdn/shop/files/custom.jpg",
            "sale_text": sale,
            "original_text": original,
            "colors": colors or [],
        }

    def test_burton_rendered_parser_pairs_live_card_prices_with_catalog_identity(self):
        products = {
            "9100998246657": self._burton_ucp_product(9100998246657, "Men's Burton Custom Camber Snowboard", [
                self._burton_ucp_variant("Black", "158", True),
                self._burton_ucp_variant("Graphic", "156", True),
                self._burton_ucp_variant("Archive", "154", False),
            ]),
            "22": self._burton_ucp_product(22, "Anon M6 Goggles", [self._burton_ucp_variant("Black", "OS", True)]),
            "33": self._burton_ucp_product(33, "Burton Recycled VT Beanie", [self._burton_ucp_variant("Black", "OS", True)]),
        }
        cards = [
            self._burton_card("9100998246657", "Men's Burton Custom Camber Snowboard", colors=["Graphic"]),
            self._burton_card("22", "Anon M6 Goggles", sale="$200.00", original="$300.00"),
            self._burton_card("33", "Burton Recycled VT Beanie", sale="$29.95", original="$29.95"),
        ]

        items = BurtonScraper(ucp_client=MagicMock()).parse_rendered_cards(cards, products)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["source_id"], "9100998246657")
        self.assertEqual(items[0]["brand"], "burton")
        self.assertEqual(items[0]["sale_price"], 461.97)
        self.assertEqual(items[0]["original_price"], 659.95)
        self.assertEqual(items[0]["sizes"], ["156", "158"])
        self.assertEqual(items[0]["colors"], ["Graphic"])
        self.assertEqual(items[0]["gender"], "men")
        self.assertEqual(items[0]["image"], "https://www.burton.com/cdn/shop/files/custom.jpg")

    def test_burton_parser_rejects_card_missing_from_catalog(self):
        with self.assertRaises(ValueError):
            BurtonScraper(ucp_client=MagicMock()).parse_rendered_cards(
                [self._burton_card("404", "Men's Burton Ghost Jacket")], {}
            )

    def _burton_snapshot_inputs(self, count):
        cards = []
        for i in range(count):
            card = self._burton_card("", f"Men's Burton Jacket {i}")
            card.pop("source_id")
            card["variant_ids"] = [str(5000 + i), str(7000 + i)]
            card["variant_id"] = card["variant_ids"][0]
            cards.append(card)
        products = {
            str(1000 + i): self._burton_ucp_product(1000 + i, f"Men's Burton Jacket {i}", [
                self._burton_ucp_variant("Black", "M", True),
            ])
            for i in range(count)
        }
        variant_map = {str(5000 + i): str(1000 + i) for i in range(count)}
        client = MagicMock()
        client.lookup_variant_products.side_effect = lambda ids: {
            value: variant_map[value] for value in ids if value in variant_map
        }
        client.lookup.side_effect = lambda ids: {value: products[value] for value in ids if value in products}
        client.search_all.return_value = ([], True)
        return cards, products, client, variant_map

    def _burton_snapshot(self, cards, client, *, min_items=1, sold_out=None, previous_results=None, **kwargs):
        scraper = BurtonScraper(
            ucp_client=client,
            previous_results=previous_results or Path("/nonexistent/burton-results.json"),
        )
        scraper.MIN_ITEMS = min_items
        options = {"expected_total": len(cards), "successful_pages": -(-len(cards) // 24), "terminated": True}
        options.update(kwargs)
        with patch.object(scraper, "_product_page_sold_out", side_effect=lambda path: (sold_out or {}).get(path)) as pdp:
            items = scraper.build_snapshot(cards, **options)
        return scraper, items, pdp

    def test_burton_snapshot_is_complete_when_ucp_resolves_every_rendered_product(self):
        cards, _, client, _ = self._burton_snapshot_inputs(30)

        scraper, items, pdp = self._burton_snapshot(cards, client, min_items=30)

        self.assertEqual(client.lookup_variant_products.call_count, 1)
        client.lookup.assert_called_once_with([str(1000 + i) for i in range(30)])
        pdp.assert_not_called()
        self.assertEqual(len(items), 30)
        self.assertEqual(items[0]["source_id"], "1000")
        self.assertTrue(scraper.crawl_complete)

    def _burton_previous_results(self, cards, ids):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"dealers": {"burton": {"items": [
            {"source_id": f"burton:{product_id}", "url": "https://www.burton.com" + cards[index]["url"]}
            for index, product_id in ids.items()
        ]}}}, handle)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return Path(handle.name)

    def test_burton_snapshot_looks_known_products_up_by_id_first(self):
        cards, products, client, _ = self._burton_snapshot_inputs(30)
        for index in range(30):
            products[str(1000 + index)]["handle"] = cards[index]["url"].rsplit("/", 1)[-1]
        previous = self._burton_previous_results(cards, {index: str(1000 + index) for index in range(28)})

        scraper, items, _ = self._burton_snapshot(cards, client, min_items=30, previous_results=previous)

        self.assertEqual(client.lookup.call_args_list[0].args[0], [str(1000 + i) for i in range(28)])
        self.assertEqual(list(client.lookup_variant_products.call_args_list[0].args[0]), ["5028", "5029"])
        self.assertEqual(client.lookup.call_args_list[1].args[0], ["1028", "1029"])
        self.assertEqual(len(items), 30)
        self.assertTrue(scraper.crawl_complete)

    def test_burton_snapshot_resolves_cards_from_outlet_search_by_handle(self):
        cards, products, client, _ = self._burton_snapshot_inputs(30)
        for index in range(30):
            products[str(1000 + index)]["handle"] = cards[index]["url"].rsplit("/", 1)[-1]
        decoy = dict(products["1000"], id="gid://shopify/Product/999", handle=products["1000"]["handle"] + "-full-price")
        client.search_all.return_value = ([products[str(1000 + i)] for i in range(29)] + [decoy], True)

        scraper, items, _ = self._burton_snapshot(cards, client, min_items=30)

        client.search_all.assert_called_once()
        self.assertEqual(list(client.lookup_variant_products.call_args_list[0].args[0]), ["5029"])
        self.assertEqual(client.lookup.call_args_list[0].args[0], ["1029"])
        self.assertEqual({item["source_id"] for item in items}, {str(1000 + i) for i in range(30)})
        self.assertTrue(scraper.crawl_complete)

    def test_burton_known_id_with_different_handle_is_re_resolved(self):
        cards, products, client, _ = self._burton_snapshot_inputs(30)
        for index in range(30):
            products[str(1000 + index)]["handle"] = cards[index]["url"].rsplit("/", 1)[-1]
        previous = self._burton_previous_results(cards, {0: "1001"})

        scraper, items, _ = self._burton_snapshot(cards, client, min_items=30, previous_results=previous)

        self.assertIn("5000", list(client.lookup_variant_products.call_args_list[0].args[0]))
        self.assertEqual({item["source_id"] for item in items}, {str(1000 + i) for i in range(30)})
        self.assertTrue(scraper.crawl_complete)

    def test_burton_single_price_card_is_full_price(self):
        cards, _, client, _ = self._burton_snapshot_inputs(30)
        cards[0].update({"sale_text": "", "original_text": "", "price_text": "$29.95"})

        scraper, items, _ = self._burton_snapshot(cards, client, min_items=29)

        self.assertEqual(len(items), 29)
        self.assertTrue(scraper.crawl_complete)

    def test_burton_snapshot_retries_sold_out_first_swatch_with_other_swatches(self):
        cards, _, client, variant_map = self._burton_snapshot_inputs(30)
        variant_map["7004"] = variant_map.pop("5004")

        scraper, items, pdp = self._burton_snapshot(cards, client, min_items=30)

        self.assertEqual(client.lookup_variant_products.call_count, 2)
        self.assertEqual(list(client.lookup_variant_products.call_args_list[1].args[0]), ["7004"])
        pdp.assert_not_called()
        self.assertEqual(len(items), 30)
        self.assertTrue(scraper.crawl_complete)

    def test_burton_snapshot_skips_unresolved_card_confirmed_sold_out(self):
        cards, _, client, variant_map = self._burton_snapshot_inputs(30)
        del variant_map["5004"]

        scraper, items, pdp = self._burton_snapshot(cards, client, sold_out={cards[4]["url"]: True})

        pdp.assert_called_once_with(cards[4]["url"])
        self.assertEqual(len(items), 29)
        self.assertNotIn("1004", {item["source_id"] for item in items})
        self.assertTrue(scraper.crawl_complete)

    def test_burton_snapshot_rejects_unresolved_card_not_confirmed_sold_out(self):
        for pdp_result in (False, None):
            with self.subTest(pdp_result=pdp_result):
                cards, _, client, variant_map = self._burton_snapshot_inputs(30)
                del variant_map["5004"]

                scraper, items, _ = self._burton_snapshot(cards, client, sold_out={cards[4]["url"]: pdp_result})

                self.assertEqual(items, [])
                self.assertFalse(scraper.crawl_complete)

    def test_burton_snapshot_rejects_missing_product_or_duplicate_resolution(self):
        for broken in ("product", "duplicate"):
            with self.subTest(broken=broken):
                cards, products, client, variant_map = self._burton_snapshot_inputs(30)
                if broken == "product":
                    products.pop("1007")
                else:
                    variant_map["5008"] = "1007"

                scraper, items, _ = self._burton_snapshot(cards, client)

                self.assertEqual(items, [])
                self.assertFalse(scraper.crawl_complete)

    def test_burton_snapshot_rejects_ucp_failure(self):
        cards, _, client, _ = self._burton_snapshot_inputs(30)
        client.lookup_variant_products.side_effect = UcpError("UCP lookup_catalog HTTP 429")

        scraper, items, _ = self._burton_snapshot(cards, client)

        self.assertEqual(items, [])
        self.assertFalse(scraper.crawl_complete)

    def test_burton_snapshot_requires_every_rendered_page_before_ucp_lookup(self):
        cards, _, client, _ = self._burton_snapshot_inputs(30)
        missing_variant = [dict(card) for card in cards]
        missing_variant[3]["variant_id"] = ""
        for card_list, kwargs in (
            (cards, {"successful_pages": 1}),
            (cards, {"terminated": False}),
            (cards, {"expected_total": 31}),
            (missing_variant, {}),
        ):
            with self.subTest(**kwargs):
                scraper, items, _ = self._burton_snapshot(card_list, client, **kwargs)
                self.assertEqual(items, [])
                client.lookup_variant_products.assert_not_called()
                self.assertFalse(scraper.crawl_complete)

    def test_burton_snapshot_skips_full_price_cards_and_enforces_item_floor(self):
        cards, _, client, _ = self._burton_snapshot_inputs(30)
        cards[0]["sale_text"] = ""
        cards[0]["original_text"] = "$659.95"

        scraper, items, _ = self._burton_snapshot(cards, client, min_items=30)

        self.assertEqual(len(items), 29)
        self.assertFalse(scraper.crawl_complete)

    def test_burton_product_page_sold_out_reads_variant_data(self):
        def page(variants):
            response = MagicMock()
            response.__enter__.return_value = response
            response.read.return_value = (
                '<html><script type="application/json" data-product-options-el="variant-data">'
                + json.dumps(variants) + "</script></html>"
            ).encode()
            return response

        scraper = BurtonScraper(ucp_client=MagicMock())
        scraper._pdp_pause = 0
        path = "/en-us/products/kids-burton-ascutney-2l-jacket-2431210-o"
        with patch("dealers.burton.urllib.request.urlopen", return_value=page([{"available": False}, {"available": False}])):
            self.assertTrue(scraper._product_page_sold_out(path))
        with patch("dealers.burton.urllib.request.urlopen", return_value=page([{"available": False}, {"available": True}])):
            self.assertFalse(scraper._product_page_sold_out(path))
        with patch("dealers.burton.urllib.request.urlopen", return_value=page([])):
            self.assertIsNone(scraper._product_page_sold_out(path))
        self.assertIsNone(scraper._product_page_sold_out("https://evil.example/x"))

    def test_backcountry_graphql_parser_uses_conservative_price_pair(self):
        payload = {
            "data": {"collection": {
                "collection": {"id": "burton-on-sale"},
                "totalCount": 159,
                "pageInfo": {"hasNextPage": True},
                "edges": [{"node": {
                    "id": "BURZ9R1",
                    "name": "Step On Re:Flex Snowboard Binding - 2027 - Women's",
                    "url": "/burton-step-on-reflex-snowboard-binding-2027-womens",
                    "stockStatus": "IN_STOCK",
                    "brand": {"name": "Burton"},
                    "aggregates": {
                        "minSalePrice": 160.0,
                        "minListPrice": 279.95,
                        "maxListPrice": 319.95,
                        "maxDiscount": 50,
                    },
                    "colors": [{
                        "name": "Black",
                        "pliImage": "/images/items/large/BUR/BURZ9R1/BLK.jpg",
                    }],
                }}],
            }},
        }

        items, metadata = BackcountryScraper().parse_graphql_response(payload)

        self.assertEqual(metadata, {
            "edge_count": 1,
            "has_next_page": True,
            "total_count": 159,
            "total_pages": 4,
        })
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["source_id"], "BURZ9R1")
        self.assertEqual(items[0]["sale_price"], 160.0)
        self.assertEqual(items[0]["original_price"], 279.95)
        self.assertEqual(items[0]["discount_pct"], 43)
        self.assertEqual(items[0]["gender"], "women")
        self.assertEqual(items[0]["image"], "https://content.backcountry.com/images/items/large/BUR/BURZ9R1/BLK.jpg")

    def test_backcountry_graphql_parser_rejects_cross_brand_contamination(self):
        payload = {
            "data": {"collection": {
                "collection": {"id": "burton-on-sale"},
                "totalCount": 1,
                "pageInfo": {"hasNextPage": False},
                "edges": [{"node": {
                    "id": "PAT1",
                    "name": "Nano Puff Jacket",
                    "url": "/patagonia-nano-puff-jacket",
                    "stockStatus": "IN_STOCK",
                    "brand": {"name": "Patagonia"},
                    "aggregates": {"minSalePrice": 100, "minListPrice": 200},
                    "colors": [],
                }}],
            }},
        }

        with self.assertRaisesRegex(ValueError, "unexpected Backcountry brand"):
            BackcountryScraper().parse_graphql_response(payload)

    def test_evo_rendered_shopify_snapshot_normalizes_product(self):
        snapshot = {
            "products": [{
                "id": 123,
                "vendor": "Arc'teryx",
                "type": "Shell Jackets",
                "handle": "beta-ar-jacket-men-s",
                "variants": [
                    {
                        "price": 30000,
                        "name": "Arc'teryx Beta AR Jacket - Men's - Black Sapphire / M",
                        "public_title": "Black Sapphire / M",
                    },
                    {
                        "price": 30000,
                        "name": "Arc'teryx Beta AR Jacket - Men's - Black Sapphire / L",
                        "public_title": "Black Sapphire / L",
                    },
                ],
            }],
            "inventory": {"123": {"inventory": 5, "lowestVariantPrice": 22500}},
            "cards": [{
                "url": "https://www.evo.com/products/beta-ar-jacket-men-s",
                "name": "Arc'teryx Beta AR Jacket - Men's",
                "current_price": "Current price $225.00",
                "original_price": "Original price $300.00",
                "image": "https://cdn.example/beta.jpg",
                "colors": ["Black Sapphire"],
            }],
        }
        items = EvoScraper().parse_browser_snapshot(snapshot, "men")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["sale_price"], 225.0)
        self.assertEqual(items[0]["original_price"], 300.0)
        self.assertEqual(items[0]["sizes"], ["L", "M"])
        self.assertEqual(items[0]["discount_pct"], 25)
        self.assertTrue(items[0]["in_stock"])

    def test_evo_rendered_snapshot_uses_product_image_when_card_image_is_missing(self):
        snapshot = {
            "products": [{
                "id": 236923,
                "vendor": "Arc'teryx",
                "type": "Gloves & Mittens",
                "handle": "236923-arc-teryx-sabre-mittens",
                "featured_image": {"src": "https://www.evo.com/cdn/shop/files/product-image-1043638.jpg"},
                "variants": [{"price": 9999, "public_title": "Black / L"}],
            }],
            "inventory": {"236923": {"inventory": 1, "lowestVariantPrice": 9999}},
            "cards": [{
                "url": "https://www.evo.com/products/236923-arc-teryx-sabre-mittens",
                "name": "Arc'teryx Sabre Mittens",
                "current_price": "Current price $99.99",
                "original_price": "Original price $180.00",
                "image": None,
                "colors": ["Black"],
            }],
        }

        items = EvoScraper().parse_browser_snapshot(snapshot, "men")

        self.assertEqual(
            items[0]["image"],
            "https://www.evo.com/cdn/shop/files/product-image-1043638.jpg",
        )

    def test_evo_rendered_snapshot_drops_analytics_products_without_a_current_card(self):
        snapshot = {
            "products": [
                {
                    "id": 1,
                    "vendor": "Burton",
                    "handle": "current-card",
                    "variants": [{"price": 20000, "public_title": "M"}],
                },
                {
                    "id": 2,
                    "vendor": "Burton",
                    "handle": "stale-analytics-row",
                    "variants": [{"price": 30000, "public_title": "L"}],
                },
            ],
            "inventory": {
                "1": {"inventory": 1, "lowestVariantPrice": 15000},
                "2": {"inventory": 1, "lowestVariantPrice": 25000},
            },
            "cards": [{
                "url": "https://www.evo.com/products/current-card",
                "name": "Burton Current Card Jacket",
                "current_price": "Current price $150.00",
                "original_price": "Original price $200.00",
                "image": "https://cdn.example/current.jpg",
                "colors": [],
            }],
        }

        items = EvoScraper().parse_browser_snapshot(snapshot, "auto", "burton")

        self.assertEqual([item["url"] for item in items], ["https://www.evo.com/products/current-card"])

    def test_evo_rendered_snapshot_isolates_burton_and_patagonia_vendors(self):
        snapshot = {
            "products": [
                {"id": 1, "vendor": "Burton", "type": "Snowboards", "handle": "burton-custom", "variants": [{"price": 69995, "public_title": "158"}]},
                {"id": 2, "vendor": "Patagonia", "type": "Jackets", "handle": "patagonia-nano", "variants": [{"price": 17900, "public_title": "Black / M"}]},
            ],
            "inventory": {
                "1": {"inventory": 2, "lowestVariantPrice": 69995},
                "2": {"inventory": 3, "lowestVariantPrice": 17900},
            },
            "cards": [
                {"url": "https://www.evo.com/products/burton-custom", "name": "Burton Custom Camber Snowboard", "current_price": "$699.95", "original_price": "$699.95", "colors": []},
                {"url": "https://www.evo.com/products/patagonia-nano", "name": "Patagonia Nano Puff Jacket - Women's", "current_price": "$179.00", "original_price": "$239.00", "colors": ["Black"]},
            ],
        }

        burton = EvoScraper().parse_browser_snapshot(snapshot, "auto", "burton")
        patagonia = EvoScraper().parse_browser_snapshot(snapshot, "auto", "patagonia")

        self.assertEqual([item["brand"] for item in burton], ["burton"])
        self.assertEqual(burton[0]["gender"], "unisex")
        self.assertEqual([item["brand"] for item in patagonia], ["patagonia"])
        self.assertEqual(patagonia[0]["gender"], "women")
        self.assertEqual(patagonia[0]["discount_pct"], 25)

    def test_evo_browser_page_retry_recovers_from_single_timeout(self):
        scraper = EvoScraper()

        class FakeResponse:
            status = 200

        class FakeLocator:
            def evaluate_all(self, _script):
                return [
                    "https://www.evo.com/collections/arcteryx?page=2",
                    "https://www.evo.com/collections/arcteryx?page=3",
                ]

        class FakePage:
            def __init__(self, index):
                self.index = index
                self.closed = False

            def set_default_navigation_timeout(self, _timeout):
                return None

            def goto(self, _url, wait_until=None, timeout=None):
                del wait_until, timeout
                if self.index == 1:
                    raise RuntimeError("transient timeout")
                return FakeResponse()

            def wait_for_timeout(self, _timeout):
                return None

            def locator(self, _selector):
                return FakeLocator()

            def close(self):
                self.closed = True

        class FakeBrowser:
            def __init__(self):
                self.pages = []

            def new_page(self):
                page = FakePage(len(self.pages) + 1)
                self.pages.append(page)
                return page

        browser = FakeBrowser()
        scraper._browser_snapshot = lambda _page, _brand: {"products": [], "inventory": {}, "cards": []}
        scraper.parse_browser_snapshot = lambda _snapshot, _gender, _brand: [{"url": "https://www.evo.com/products/test"}] * 40

        with patch.dict("os.environ", {"EVO_BROWSER_RETRY_DELAY_MS": "0"}):
            items, discovered_max_page = scraper._fetch_browser_page(
                browser=browser,
                base_url="https://www.evo.com/collections/arcteryx",
                slug="arcteryx",
                gender="auto",
                page_number=1,
                max_page=1,
            )

        self.assertEqual(len(items), 40)
        self.assertEqual(discovered_max_page, 3)
        self.assertEqual(len(browser.pages), 2)
        self.assertTrue(all(page.closed for page in browser.pages))

    def test_evo_complete_but_small_http_snapshot_uses_browser_fallback(self):
        scraper = EvoScraper()
        http_items = [{"url": f"https://www.evo.com/products/http-{i}"} for i in range(50)]
        browser_items = [{"url": f"https://www.evo.com/products/browser-{i}"} for i in range(120)]
        with patch.object(scraper, "_scrape_ucp", return_value=([], False)), patch.object(
            scraper, "_scrape_http", return_value=(http_items, True)
        ), patch.object(
            scraper, "_scrape_browser", return_value=(browser_items, True)
        ) as browser:
            self.assertEqual(scraper.scrape(), browser_items)
        browser.assert_called_once_with()
        self.assertTrue(scraper.crawl_complete)

    def test_rei_detail_parser_is_deterministic(self):
        body = (
            '<button class="size-selector__size-button" data-ui="size-selector-button:available">'
            '<span aria-hidden="true">M</span></button>'
            '<button class="color-btn" data-color="BLACK" data-ui="available"></button>'
            '<span class="color-selector-wrapper__selected-color">Black</span>'
        )
        detail = ReiScraper().parse_detail(body)
        self.assertEqual(detail["sizes"], ["M"])
        self.assertEqual(detail["size_stock"], {"M": "in_stock"})
        self.assertEqual(detail["color"], "Black")

    def test_rei_list_urls_paginate_search_results(self):
        scraper = ReiScraper()
        urls = scraper.list_urls()
        self.assertEqual(len(urls), 20)
        self.assertEqual(
            urls[:4],
            [
                "https://www.rei.com/search?q=arcteryx",
                "https://www.rei.com/search?q=arcteryx&page=2",
                "https://www.rei.com/search?q=arcteryx&page=3",
                "https://www.rei.com/search?q=arcteryx&page=4",
            ],
        )
        self.assertEqual(urls[-1], "https://www.rei.com/search?q=arcteryx&page=20")

    @patch("dealers.mec.time.sleep")
    @patch("dealers.mec.fetch_pdp")
    def test_mec_scrapling_fallback_promotes_official_pdp_price(self, fetch_pdp, sleep):
        session = object()
        item = {
            "url": "https://www.mec.ca/en/product/6037-632/arcteryx-olera-crew-womens",
            "sale_price": 200.0,
            "original_price": 200.0,
            "discount_pct": 0,
            "_hit": {"id": 1},
        }
        fetch_pdp.return_value = {
            "sale_price": 140.0,
            "original_price": 200.0,
            "discount_pct": 30,
            "color": "Solitude",
        }

        _enrich_items(session, [item], "scrapling")

        fetch_pdp.assert_called_once_with(session, item["url"])
        self.assertEqual(item["sale_price"], 140.0)
        self.assertEqual(item["original_price"], 200.0)
        self.assertEqual(item["discount_pct"], 30)
        self.assertEqual(item["price_source_quality"], "pdp")
        self.assertNotIn("_hit", item)
        sleep.assert_called_once_with(0.3)

    @patch("dealers.mec.time.sleep")
    @patch("dealers.mec.fetch_pdp", return_value={"_err": "http_failed"})
    def test_mec_pdp_failure_keeps_list_price_as_low_trust(self, fetch_pdp, sleep):
        session = object()
        item = {
            "url": "https://www.mec.ca/en/product/6030-116/example",
            "sale_price": 200.0,
            "original_price": 200.0,
            "discount_pct": 0,
            "_hit": {"id": 1},
        }

        _enrich_items(session, [item], "scrapling")

        fetch_pdp.assert_called_once_with(session, item["url"])
        self.assertEqual(item["sale_price"], 200.0)
        self.assertEqual(item["original_price"], 200.0)
        self.assertEqual(item["price_source_quality"], "list_fallback")
        self.assertNotIn("_hit", item)
        sleep.assert_called_once_with(0.3)

    def test_browser_stack_versions_are_pinned_to_live_working_combo(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn("camoufox[geoip]==0.4.11", requirements)
        self.assertIn("playwright==1.58.0", requirements)
        self.assertIn("patchright==1.58.2", requirements)
        self.assertIn("curl_cffi==0.15.0", requirements)
        self.assertIn("scrapling==0.3.12", requirements)

    def test_scrapling_browser_headers_support_linux_runner(self):
        from scrapling.engines.toolbelt import fingerprints

        original_os_name = fingerprints.__OS_NAME__
        fingerprints.__OS_NAME__ = "Linux"
        fingerprints.get_os_name.cache_clear()
        try:
            for browser_mode in (True, "chrome"):
                with self.subTest(browser_mode=browser_mode):
                    headers = fingerprints.generate_headers(browser_mode=browser_mode)
                    self.assertIn("Linux", headers["User-Agent"])
        finally:
            fingerprints.__OS_NAME__ = original_os_name
            fingerprints.get_os_name.cache_clear()


if __name__ == "__main__":
    unittest.main()
