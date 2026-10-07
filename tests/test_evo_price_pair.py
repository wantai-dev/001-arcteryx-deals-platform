import io
import json
import unittest
from unittest.mock import patch

from dealers.evo import Scraper as EvoScraper
from dealers.evo_price import select_variant_price
from dealers.revalidate import fetch_evo_pdp, parse_evo_browser_snapshot


URL = "https://www.evo.com/products/burton-profile-under-gloves"
INVALID_CENTS = (
    None, 0, -1, float("nan"), float("inf"), float("-inf"), True, False,
    3499.5, "3499.5", "3499.0", "NaN", "Infinity", "$3499", "bad", "", {}, [],
)


def browser_variants(shopify_variants):
    """Translate fixture field names without interpreting fixture prices."""
    if not isinstance(shopify_variants, list):
        return shopify_variants
    result = []
    for variant in shopify_variants:
        if not isinstance(variant, dict):
            result.append(variant)
            continue
        translated = {}
        for source, target in (
            ("id", "id"), ("price", "priceInCents"),
            ("compare_at_price", "compareAtPriceInCents"),
        ):
            if source in variant:
                translated[target] = variant[source]
        if "available" in variant:
            value = variant["available"]
            translated["isOutOfStock"] = not value if isinstance(value, bool) else value
        result.append(translated)
    return result


def read_entry_points(variants):
    product = {
        "available": True,
        "price": 1,
        "compare_at_price": 52995,
        "variants": variants,
    }
    snapshot = {
        "ShopifyAnalytics": {"meta": {"product": {"id": 1}}},
        "igProductData": {"1": {"lowestVariantPrice": 1}},
        "RegiosDOPP_ProductPage": {
            "compareAtPriceInCents": 52995,
            "variants": browser_variants(variants),
        },
    }
    with patch("dealers.revalidate.urllib.request.urlopen", return_value=io.BytesIO(json.dumps(product).encode())):
        direct = fetch_evo_pdp(URL)
    return {
        "scraper_pdp": EvoScraper.parse_pdp_product(product),
        "direct_revalidation": direct,
        "browser_revalidation": parse_evo_browser_snapshot(snapshot, URL),
    }


class EvoVariantSelectorTests(unittest.TestCase):
    def test_returns_the_cheapest_variants_complete_pair(self):
        gloves = {"id": "gloves", "price": 3499, "compare_at_price": 5295}
        expensive = {"id": "expensive", "price": 41999, "compare_at_price": 52995}

        result = select_variant_price([gloves, expensive])

        self.assertEqual(result, {"variant": gloves, "sale_price": 34.99, "original_price": 52.95})
        self.assertIs(result["variant"], gloves)
        self.assertIn((result["sale_price"], result["original_price"]), [(34.99, 52.95), (419.99, 529.95)])

    def test_accepts_positive_integer_cents_as_integer_string_or_float(self):
        for cents in (3499, "3499", " 3499 ", 3499.0):
            with self.subTest(cents=cents):
                result = select_variant_price([{"price": cents, "compare_at_price": "5295"}])
                self.assertEqual((result["sale_price"], result["original_price"]), (34.99, 52.95))

    def test_invalid_sale_cents_cannot_supply_an_original_price(self):
        valid = {"id": "valid", "price": 9900, "compare_at_price": 19900}
        for cents in INVALID_CENTS:
            with self.subTest(cents=cents):
                result = select_variant_price([
                    {"id": "invalid", "price": cents, "compare_at_price": 99999}, valid,
                ])
                self.assertIs(result["variant"], valid)
                self.assertEqual((result["sale_price"], result["original_price"]), (99.0, 199.0))

    def test_missing_sale_is_skipped_with_its_compare_at_price(self):
        valid = {"price": 3499, "compare_at_price": 5295}
        result = select_variant_price([{"compare_at_price": 52995}, valid])

        self.assertIs(result["variant"], valid)
        self.assertEqual((result["sale_price"], result["original_price"]), (34.99, 52.95))

    def test_missing_or_invalid_original_falls_back_to_the_same_sale(self):
        for compare in INVALID_CENTS + (1000,):
            with self.subTest(compare=compare):
                result = select_variant_price([
                    {"price": 3499, "compare_at_price": compare},
                    {"price": 41999, "compare_at_price": 52995},
                ])
                self.assertEqual((result["sale_price"], result["original_price"]), (34.99, 34.99))
        result = select_variant_price([{"price": 3499}])
        self.assertEqual((result["sale_price"], result["original_price"]), (34.99, 34.99))

    def test_equal_sales_choose_the_lower_original_in_either_input_order(self):
        lower = {"id": "lower", "price": 3499, "compare_at_price": 5295}
        higher = {"id": "higher", "price": 3499, "compare_at_price": 52995}
        for variants in ([higher, lower], [lower, higher]):
            with self.subTest(ids=[variant["id"] for variant in variants]):
                result = select_variant_price(variants)
                self.assertIs(result["variant"], lower)
                self.assertEqual((result["sale_price"], result["original_price"]), (34.99, 52.95))

    def test_equal_sales_compare_the_normalized_original(self):
        full_price = {"id": "full-price", "price": 3499, "compare_at_price": None}
        discounted = {"id": "discounted", "price": 3499, "compare_at_price": 5295}
        for variants in ([discounted, full_price], [full_price, discounted]):
            with self.subTest(ids=[variant["id"] for variant in variants]):
                result = select_variant_price(variants)
                self.assertIs(result["variant"], full_price)
                self.assertEqual((result["sale_price"], result["original_price"]), (34.99, 34.99))

    def test_identical_pairs_preserve_first_variant_identity(self):
        first = {"id": "first", "price": 3499, "compare_at_price": 5295}
        second = {"id": "second", "price": 3499, "compare_at_price": 5295}
        for variants in ([first, second], [second, first]):
            with self.subTest(first_id=variants[0]["id"]):
                self.assertIs(select_variant_price(variants)["variant"], variants[0])

    def test_browser_field_names_use_the_same_selection_contract(self):
        variants = [
            {"id": "gloves", "priceInCents": 3499, "compareAtPriceInCents": 5295},
            {"id": "expensive", "priceInCents": 41999, "compareAtPriceInCents": 52995},
        ]
        result = select_variant_price(variants, price_key="priceInCents", compare_key="compareAtPriceInCents")

        self.assertIs(result["variant"], variants[0])
        self.assertEqual((result["sale_price"], result["original_price"]), (34.99, 52.95))

    def test_no_usable_sale_returns_none(self):
        for variants in ([], [None, "bad", {}], [{"price": cents} for cents in INVALID_CENTS]):
            with self.subTest(variants=variants):
                self.assertIsNone(select_variant_price(variants))


class EvoPricePairEntryPointTests(unittest.TestCase):
    def assert_prices(self, results, expected_pair, available_pairs, discount):
        for name, result in results.items():
            with self.subTest(entry_point=name):
                self.assertIsNotNone(result)
                actual = (result["sale_price"], result["original_price"])
                self.assertIn(actual, available_pairs)
                self.assertEqual(actual, expected_pair)
                if name == "scraper_pdp":
                    self.assertIs(result["available"], True)
                else:
                    self.assertEqual(result["discount_pct"], discount)

    def assert_unknown(self, results):
        for name, result in results.items():
            with self.subTest(entry_point=name):
                self.assertIsNone(result)

    def test_three_entry_points_keep_the_cheapest_variant_price_pair(self):
        results = read_entry_points([
            {"id": "gloves", "available": True, "price": 3499, "compare_at_price": 5295},
            {"id": "expensive", "available": True, "price": 41999, "compare_at_price": 52995},
        ])
        # These are hand-written fixture facts, independent of the selector.
        self.assert_prices(results, (34.99, 52.95), [(34.99, 52.95), (419.99, 529.95)], 34)

    def test_integer_string_and_float_cents_work_in_all_entry_points(self):
        for price, compare in ((3499, 5295), ("3499", "5295"), (3499.0, 5295.0)):
            with self.subTest(price=price, compare=compare):
                results = read_entry_points([
                    {"available": True, "price": price, "compare_at_price": compare},
                    {"available": True, "price": 41999, "compare_at_price": 52995},
                ])
                self.assert_prices(results, (34.99, 52.95), [(34.99, 52.95), (419.99, 529.95)], 34)

    def test_cheapest_sold_out_variant_cannot_supply_either_price(self):
        results = read_entry_points([
            {"available": False, "price": 999, "compare_at_price": 52995},
            {"available": True, "price": 3499, "compare_at_price": 5295},
            {"available": True, "price": 9900, "compare_at_price": 19900},
        ])
        self.assert_prices(results, (34.99, 52.95), [(34.99, 52.95), (99.0, 199.0)], 34)

    def test_all_explicitly_sold_out_variants_report_unavailable(self):
        results = read_entry_points([
            {"available": False, "price": 3499, "compare_at_price": 5295},
            {"available": False, "price": 41999, "compare_at_price": 52995},
        ])
        self.assertEqual(results["scraper_pdp"], {"available": False, "variants": []})
        self.assertEqual(results["direct_revalidation"], {"_unavailable": True})
        self.assertEqual(results["browser_revalidation"], {"_unavailable": True})

    def test_invalid_available_sale_does_not_poison_a_valid_variants_pair(self):
        for cents in INVALID_CENTS:
            with self.subTest(cents=cents):
                results = read_entry_points([
                    {"available": True, "price": cents, "compare_at_price": 52995},
                    {"available": True, "price": 3499, "compare_at_price": 5295},
                ])
                self.assert_prices(results, (34.99, 52.95), [(34.99, 52.95)], 34)

    def test_missing_sale_does_not_supply_another_variants_original(self):
        results = read_entry_points([
            {"available": True, "compare_at_price": 52995},
            {"available": True, "price": 3499, "compare_at_price": 5295},
        ])
        self.assert_prices(results, (34.99, 52.95), [(34.99, 52.95)], 34)

    def test_no_valid_available_sale_is_unknown_rather_than_sold_out(self):
        for cents in INVALID_CENTS:
            with self.subTest(cents=cents):
                self.assert_unknown(read_entry_points([
                    {"available": True, "price": cents, "compare_at_price": 52995},
                ]))
        self.assert_unknown(read_entry_points([{"available": True, "compare_at_price": 52995}]))

    def test_missing_original_does_not_use_other_variants_or_product_aggregate(self):
        results = read_entry_points([
            {"available": True, "price": 3499},
            {"available": True, "price": 41999, "compare_at_price": 52995},
        ])
        self.assert_prices(results, (34.99, 34.99), [(34.99, 34.99), (419.99, 529.95)], 0)

    def test_invalid_or_lower_original_normalizes_within_its_variant(self):
        for compare in INVALID_CENTS + (1000,):
            with self.subTest(compare=compare):
                results = read_entry_points([
                    {"available": True, "price": 3499, "compare_at_price": compare},
                    {"available": True, "price": 41999, "compare_at_price": 52995},
                ])
                self.assert_prices(results, (34.99, 34.99), [(34.99, 34.99), (419.99, 529.95)], 0)

    def test_equal_lowest_sales_choose_the_lower_original_in_either_order(self):
        lower = {"available": True, "price": 3499, "compare_at_price": 5295}
        higher = {"available": True, "price": 3499, "compare_at_price": 52995}
        for variants in ([higher, lower], [lower, higher]):
            with self.subTest(variants=variants):
                self.assert_prices(read_entry_points(variants), (34.99, 52.95), [(34.99, 52.95), (34.99, 529.95)], 34)

    def test_equal_lowest_sales_choose_the_lower_normalized_original(self):
        full_price = {"available": True, "price": 3499, "compare_at_price": None}
        discounted = {"available": True, "price": 3499, "compare_at_price": 5295}
        for variants in ([discounted, full_price], [full_price, discounted]):
            with self.subTest(variants=variants):
                self.assert_prices(read_entry_points(variants), (34.99, 34.99), [(34.99, 34.99), (34.99, 52.95)], 0)

    def test_unknown_stock_flags_never_count_as_available(self):
        for flag in (None, 0, 1, "true", "false", "", {}, []):
            with self.subTest(flag=flag):
                self.assert_unknown(read_entry_points([
                    {"available": flag, "price": 3499, "compare_at_price": 5295},
                ]))
        self.assert_unknown(read_entry_points([{"price": 3499, "compare_at_price": 5295}]))

    def test_unknown_cheaper_variant_is_excluded_from_a_confirmed_available_pair(self):
        results = read_entry_points([
            {"price": 999, "compare_at_price": 52995},
            {"available": True, "price": 3499, "compare_at_price": 5295},
        ])
        self.assert_prices(results, (34.99, 52.95), [(34.99, 52.95)], 34)

    def test_sold_out_and_unknown_stock_is_unknown_rather_than_all_sold_out(self):
        self.assert_unknown(read_entry_points([
            {"available": False, "price": 3499, "compare_at_price": 5295},
            {"price": 41999, "compare_at_price": 52995},
        ]))

    def test_empty_or_malformed_variants_do_not_become_product_aggregate_prices(self):
        for variants in (None, [], {}, "bad", [None, "bad", {}]):
            with self.subTest(variants=variants):
                self.assert_unknown(read_entry_points(variants))

    def test_malformed_product_payloads_fail_closed(self):
        for product in (None, [], "bad", 1):
            with self.subTest(product=product):
                self.assertIsNone(EvoScraper.parse_pdp_product(product))
                with patch("dealers.revalidate.urllib.request.urlopen", return_value=io.BytesIO(json.dumps(product).encode())):
                    self.assertIsNone(fetch_evo_pdp(URL))

    def test_explicit_product_unavailability_is_authoritative(self):
        product = {
            "available": False,
            "variants": [{"available": True, "price": 3499, "compare_at_price": 5295}],
        }
        self.assertEqual(EvoScraper.parse_pdp_product(product), {"available": False, "variants": []})
        with patch("dealers.revalidate.urllib.request.urlopen", return_value=io.BytesIO(json.dumps(product).encode())):
            self.assertEqual(fetch_evo_pdp(URL), {"_unavailable": True})


if __name__ == "__main__":
    unittest.main()
