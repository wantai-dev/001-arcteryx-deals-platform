import json
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from dealers.backcountry import Scraper as BackcountryScraper
from dealers.burton import Scraper as BurtonScraper
from dealers.evo import Scraper as EvoScraper
from dealers.mec import Scraper as MecScraper, _enrich_items
from dealers.rei import Scraper as ReiScraper


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

    def test_evo_ucp_paginates_then_confirms_each_product_with_pdp(self):
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

        with patch.dict(os.environ, {"EVO_UCP_INTER_PDP_DELAY_MS": "0"}), patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", side_effect=pages) as ucp_call, patch.object(
            scraper, "_fetch_pdp_json", side_effect=pdp
        ) as fetch_pdp:
            items, complete = scraper._scrape_ucp()

        self.assertTrue(complete)
        self.assertEqual(len(items), 2)
        self.assertEqual([item["price_source_quality"] for item in items], ["pdp", "pdp"])
        self.assertEqual([item["gender"] for item in items], ["women", "men"])
        self.assertEqual(items[0]["sale_price"], 120.0)
        self.assertEqual(items[0]["original_price"], 200.0)
        self.assertEqual(items[0]["sizes"], ["M"])
        self.assertEqual(items[0]["image"], "https://cdn.example/first.jpg")
        self.assertEqual(fetch_pdp.call_count, 2)
        first_args = ucp_call.call_args_list[0].args[2]
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
            }, {
                "title": "Burton Fish 3D Splitboard + Step On Splitboard Bindings",
                "handle": "burton-fish-bundle",
                "tags": ["type:custom-bundle"],
                "variants": [{"media": [{"type": "image", "url": image_url}]}],
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

        with patch.dict(os.environ, {"EVO_UCP_INTER_PDP_DELAY_MS": "0"}), patch.object(
            scraper, "_discover_ucp_endpoint", return_value="https://store.myshopify.com/api/ucp/mcp"
        ), patch.object(scraper, "_ucp_call", return_value=page), patch.object(
            scraper, "_fetch_pdp_json", side_effect=pdp
        ):
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

    def test_evo_http_snapshot_publishes_the_cheapest_pdp_variants_complete_pair(self):
        scraper = EvoScraper()
        scraper.COLLECTIONS = [("burton", "auto", "burton")]
        handle = "burton-profile-under-gloves"
        collection_product = {
            "vendor": "Burton",
            "handle": handle,
            "title": "Burton Profile Under Gloves",
            "product_type": "Gloves",
            "variants": [{"available": True, "price": "34.99", "compare_at_price": "529.95"}],
        }
        pdp_product = {
            "available": True,
            "handle": handle,
            "vendor": "Burton",
            "title": collection_product["title"],
            "variants": [
                {"available": True, "price": 3499, "compare_at_price": 5295, "option1": "Black", "option2": "M"},
                {"available": True, "price": 41999, "compare_at_price": 52995, "option1": "Blue", "option2": "L"},
            ],
        }

        with patch.object(scraper, "_fetch_json", return_value={"products": [collection_product]}), patch.object(
            scraper, "_fetch_pdp_json", return_value=pdp_product
        ):
            items, complete = scraper._scrape_http()

        self.assertTrue(complete)
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0]["sale_price"], items[0]["original_price"]), (34.99, 52.95))
        self.assertIn((items[0]["sale_price"], items[0]["original_price"]), [(34.99, 52.95), (419.99, 529.95)])
        self.assertEqual(items[0]["discount_pct"], 34)
        self.assertEqual(items[0]["price_source_quality"], "pdp")

    def test_evo_browser_item_confirmation_replaces_list_price_with_a_complete_pdp_pair(self):
        scraper = EvoScraper()
        item = {
            "url": "https://www.evo.com/products/burton-profile-under-gloves",
            "name": "Burton Profile Under Gloves",
            "brand": "burton",
            "sale_price": 34.99,
            "original_price": 529.95,
            "discount_pct": 93,
            "price_source_quality": "list_fallback",
        }
        pdp_product = {
            "available": True,
            "handle": "burton-profile-under-gloves",
            "vendor": "Burton",
            "title": item["name"],
            "variants": [
                {"available": True, "price": 3499, "compare_at_price": 5295},
                {"available": True, "price": 41999, "compare_at_price": 52995},
            ],
        }

        with patch.object(scraper, "_fetch_pdp_json", return_value=pdp_product):
            confirmed = scraper._confirm_browser_item_with_pdp(item)

        self.assertEqual((confirmed["sale_price"], confirmed["original_price"]), (34.99, 52.95))
        self.assertEqual(confirmed["discount_pct"], 34)
        self.assertEqual(confirmed["price_source_quality"], "pdp")

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

    def test_burton_rendered_parser_pairs_live_card_prices_with_catalog_identity(self):
        products = {
            "9100998246657": {
            "id": 9100998246657,
            "vendor": "Burton",
            "title": "Men's Burton Custom Camber Snowboard",
            "handle": "mens-burton-custom-camber-snowboard-106881",
            "product_type": "Snowboards",
            "options": [
                {"name": "Color", "position": 1},
                {"name": "Size", "position": 2},
            ],
            "images": [{"id": 90, "src": "//www.burton.com/cdn/shop/files/custom.jpg"}],
            "variants": [
                {"available": True, "price": "699.95", "compare_at_price": None, "option1": "Black", "option2": "158"},
                {"available": True, "price": "659.95", "compare_at_price": "659.95", "option1": "Graphic", "option2": "156", "image_id": 90},
                {"available": False, "price": "199.95", "compare_at_price": "699.95", "option1": "Archive", "option2": "154"},
            ],
        }, "22": {
            "id": 22,
            "vendor": "Anon",
            "title": "Anon M6 Goggles",
            "handle": "anon-m6-goggles",
            "variants": [{"available": True, "price": "200", "compare_at_price": "300"}],
        }, "33": {
            "id": 33,
            "vendor": "Burton",
            "title": "Burton Recycled VT Beanie",
            "handle": "burton-recycled-vt-beanie-243101",
            "variants": [{"available": True, "price": "29.95", "compare_at_price": "29.95"}],
        }}
        cards = [{
            "source_id": "9100998246657",
            "url": "/en-us/products/mens-burton-custom-camber-snowboard-106881",
            "name": "Men's Burton Custom Camber Snowboard",
            "image": "//www.burton.com/cdn/shop/files/custom.jpg",
            "sale_text": "$461.97",
            "original_text": "$659.95",
            "colors": ["Graphic"],
        }, {
            "source_id": "22",
            "url": "/en-us/products/anon-m6-goggles",
            "name": "Anon M6 Goggles",
            "image": "",
            "sale_text": "$200.00",
            "original_text": "$300.00",
            "colors": [],
        }, {
            "source_id": "33",
            "url": "/en-us/products/burton-recycled-vt-beanie-243101",
            "name": "Burton Recycled VT Beanie",
            "image": "",
            "sale_text": "$29.95",
            "original_text": "$29.95",
            "colors": [],
        }]

        items = BurtonScraper().parse_rendered_cards(cards, products)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["source_id"], "9100998246657")
        self.assertEqual(items[0]["brand"], "burton")
        self.assertEqual(items[0]["sale_price"], 461.97)
        self.assertEqual(items[0]["original_price"], 659.95)
        self.assertEqual(items[0]["sizes"], ["156", "158"])
        self.assertEqual(items[0]["colors"], ["Graphic"])
        self.assertEqual(items[0]["gender"], "men")
        self.assertEqual(items[0]["image"], "https://www.burton.com/cdn/shop/files/custom.jpg")

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
