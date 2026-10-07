import ast
import hashlib
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import tools.audit_price_accuracy as audit
from tools.evo_price_evidence import (
    check_evo_output_pair,
    evo_js_url,
    fetch_evo_official_read,
    has_evo_variant_evidence,
    parse_evo_official_read,
)

URL = "https://www.evo.com/products/audit-fixture"
READ_AT = "2026-10-08T01:02:03Z"


def variant(variant_id, sale, compare, available=True):
    return {"id": variant_id, "price": sale, "compare_at_price": compare, "available": available}


def official(variants, **product_values):
    product = {"id": 10, "handle": "audit-fixture", "available": True, "variants": variants}
    product.update(product_values)
    raw = json.dumps(product).encode()
    return parse_evo_official_read(raw, URL, read_at_utc=READ_AT)


def row(sale=34.99, original=52.95, discount=34):
    return {
        "sku_id": "evo:audit-fixture", "dealer": "evo", "url": URL,
        "sale_price": sale, "original_price": original, "discount_pct": discount,
    }


class EvoPriceEvidenceTests(unittest.TestCase):
    def test_cross_variant_pair_is_absent_but_correct_pair_is_proven(self):
        read = official([
            variant("sale", 3499, 5295),
            variant("expensive", 52995, 52995),
            variant("sold-out", 999, 99999, False),
        ])
        self.assertEqual((read["sale_price"], read["original_price"]), (34.99, 52.95))
        self.assertTrue(has_evo_variant_evidence(read))
        wrong = check_evo_output_pair(read, row(original=529.95))
        self.assertFalse(wrong["pair_exists"])
        self.assertTrue(wrong["sale_is_available_minimum"])
        correct = check_evo_output_pair(read, row())
        self.assertTrue(correct["pair_exists"])
        self.assertEqual(correct["matching_variant_ids"], ["sale"])

    def test_tied_sale_selects_lower_normalized_original_and_keeps_membership(self):
        read = official([variant("higher", 1000, 3000), variant("lower", 1000, 2000)])
        self.assertEqual(read["original_price"], 20)
        self.assertEqual(read["evo_evidence"]["variant_id"], "lower")
        self.assertEqual(read["evo_evidence"]["minimum_sale_pairs"], [[1000, 2000], [1000, 3000]])
        other = check_evo_output_pair(read, row(10, 30))
        self.assertTrue(other["pair_exists"])
        self.assertTrue(other["sale_is_available_minimum"])
        self.assertFalse(other["matches_canonical_pair"])

    def test_identical_pairs_keep_first_variant(self):
        read = official([variant("first", 1000, 2000), variant("second", "1000", "2000")])
        self.assertEqual(read["evo_evidence"]["variant_id"], "first")

    def test_invalid_sale_never_contributes_compare(self):
        invalid = [None, True, False, 0, -1, "NaN", "Infinity", "junk", 3499.5]
        read = official([
            *(variant(f"bad-{index}", value, 999999) for index, value in enumerate(invalid)),
            variant("valid", 3499, 5295),
        ])
        self.assertEqual((read["sale_price"], read["original_price"]), (34.99, 52.95))
        self.assertEqual(read["evo_evidence"]["excluded_invalid_sale_count"], len(invalid))
        self.assertEqual(len(read["evo_evidence"]["available_variants"]), 1)

    def test_compare_fallback_is_explicit_and_never_borrows_other_row(self):
        for compare, reason in [
            (None, "missing_compare_fallback"),
            (True, "invalid_compare_fallback"),
            (False, "invalid_compare_fallback"),
            (0, "invalid_compare_fallback"),
            (-1, "invalid_compare_fallback"),
            ("NaN", "invalid_compare_fallback"),
            ("Infinity", "invalid_compare_fallback"),
            ("junk", "invalid_compare_fallback"),
            (3499.5, "invalid_compare_fallback"),
            (3498, "compare_below_sale_fallback"),
        ]:
            with self.subTest(compare=compare):
                read = official([variant("fallback", 3499, compare), variant("other", 5000, 90000)])
                self.assertEqual((read["sale_price"], read["original_price"]), (34.99, 34.99))
                self.assertEqual(read["evo_evidence"]["normalization_reason"], reason)
                self.assertTrue(read["evo_evidence"]["compare_fallback"])
                self.assertTrue(check_evo_output_pair(read, row(34.99, 34.99))["pair_exists"])

    def test_only_explicit_boolean_availability_counts(self):
        unknown = [None, "true", "false", 1, 0]
        read = official([
            *(variant(f"unknown-{index}", 1, 99999, value) for index, value in enumerate(unknown)),
            variant("known", 3499, 5295),
        ])
        self.assertEqual(read["sale_price"], 34.99)
        self.assertEqual(read["evo_evidence"]["unknown_availability_count"], len(unknown))
        for value in unknown:
            with self.subTest(value=value):
                result = official([variant("unknown", 1000, 2000, value)])
                self.assertEqual(result["_err"], "evo_no_valid_available_sale")

    def test_sold_out_is_distinct_from_unknown_or_malformed(self):
        self.assertEqual(official([variant("gone", 1000, 2000, False)])["_err"], "official_unavailable")
        mixed = official([variant("gone", 1000, 2000, False), "malformed"])
        self.assertEqual(mixed["_err"], "evo_no_valid_available_sale")
        self.assertEqual(official([variant("known", 1000, 2000)], available=False)["_err"], "official_unavailable")

    def test_aggregate_without_variants_stays_unverifiable(self):
        for variants in [[], None, {"price": 3499}]:
            with self.subTest(variants=variants):
                read = official(variants, price=3499, compare_at_price=5295)
                self.assertIn("_err", read)
                self.assertFalse(has_evo_variant_evidence(read))
                self.assertFalse(read["evo_evidence"]["pair_exists"])

    def test_raw_hash_and_exact_row_provenance_are_preserved(self):
        product = {"id": 10, "handle": "audit-fixture", "variants": [variant(20, 3499, 5295)]}
        raw = json.dumps(product).encode()
        read = parse_evo_official_read(raw, URL, read_at_utc=READ_AT)
        evidence = read["evo_evidence"]
        self.assertEqual(evidence["raw_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(evidence["source_url"], URL + ".js")
        self.assertEqual(evidence["read_at_utc"], READ_AT)
        self.assertEqual(evidence["product_id"], 10)
        self.assertEqual(evidence["variant_id"], 20)
        self.assertEqual(evidence["raw_price_cents"], 3499)
        self.assertEqual(evidence["raw_compare_at_price_cents"], 5295)
        self.assertTrue(evidence["pair_exists"])
        self.assertTrue(evidence["sale_is_available_minimum"])
        self.assertEqual(audit.normalize_read(read)["evo_evidence"], evidence)

    def test_non_integer_decimal_cents_are_excluded_without_float_rounding(self):
        raw = b'{"variants":[{"id":1,"available":true,"price":3499.00000000000001,"compare_at_price":5295},{"id":2,"available":true,"price":4000,"compare_at_price":5000}]}'
        read = parse_evo_official_read(raw, URL)
        self.assertEqual(read["sale_price"], 40)
        self.assertEqual(read["evo_evidence"]["excluded_invalid_sale_count"], 1)

    def test_cents_strings_follow_integer_lexical_contract(self):
        for invalid in ["3499.0", "1e3", "３４９９", "1,000", "-3499", "++3499"]:
            with self.subTest(invalid=invalid):
                read = official([variant("bad", invalid, 99999), variant("valid", 4000, 5000)])
                self.assertEqual(read["sale_price"], 40)
        read = official([variant("valid", " +3499 ", "5295")])
        self.assertEqual(read["sale_price"], 34.99)
        read = official([variant("valid-json-number", 3499.0, 5295.0)])
        self.assertEqual(read["sale_price"], 34.99)

    def test_huge_cents_that_would_make_infinite_dollars_are_excluded(self):
        read = official([variant("huge", 10 ** 400, 10 ** 401), variant("valid", 3499, 5295)])
        self.assertEqual((read["sale_price"], read["original_price"]), (34.99, 52.95))
        read = official([variant("valid-sale", 3499, 10 ** 400)])
        self.assertEqual(read["original_price"], 34.99)
        self.assertEqual(read["evo_evidence"]["normalization_reason"], "invalid_compare_fallback")

    def test_invalid_json_and_wrong_product_preserve_failure_evidence(self):
        for raw in [b"<html>blocked</html>", b"[]", b"null"]:
            with self.subTest(raw=raw):
                read = parse_evo_official_read(raw, URL)
                self.assertIn("_err", read)
                self.assertEqual(read["evo_evidence"]["raw_sha256"], hashlib.sha256(raw).hexdigest())
                self.assertIn("evo_evidence", audit.normalize_read(read))
        self.assertEqual(official([variant(1, 1000, 2000)], handle="another-product")["_err"], "evo_product_handle_mismatch")

    def test_invalid_output_pair_cannot_be_proven(self):
        read = official([variant("known", 3499, 5295)])
        for invalid in [True, False, None, "NaN", "sNaN", "Infinity", -1, 0, 34.991]:
            with self.subTest(invalid=invalid):
                self.assertFalse(check_evo_output_pair(read, row(sale=invalid))["pair_exists"])
                self.assertFalse(check_evo_output_pair(read, row(original=invalid))["pair_exists"])

    def test_known_nonminimum_pair_exists_but_is_rejected(self):
        read = official([variant("minimum", 3499, 5295), variant("higher", 5000, 6000)])
        candidate = row(50, 60, 17)
        proof = check_evo_output_pair(read, candidate)
        self.assertTrue(proof["pair_exists"])
        self.assertFalse(proof["sale_is_available_minimum"])
        self.assertFalse(audit.db_matches(candidate, read))

    def test_fetch_reads_raw_bytes_and_rejects_redirects(self):
        raw = json.dumps({"variants": [variant(1, 3499, 5295)]}).encode()
        session = Mock()
        session.get.return_value = SimpleNamespace(status_code=200, content=raw)
        result = fetch_evo_official_read(URL, session)
        self.assertTrue(has_evo_variant_evidence(result))
        self.assertEqual(session.get.call_args.args, (URL + ".js",))
        self.assertFalse(session.get.call_args.kwargs["allow_redirects"])
        session.get.return_value = SimpleNamespace(status_code=302, content=b"redirect")
        self.assertEqual(fetch_evo_official_read(URL, session)["_err"], "evo_http 302")

    def test_fetch_errors_do_not_include_exception_detail(self):
        session = Mock()
        session.get.side_effect = RuntimeError("private exception detail")
        self.assertEqual(fetch_evo_official_read(URL, session), {"_err": "evo_http RuntimeError"})

    def test_fetch_refuses_untrusted_urls(self):
        for url in ["https://example.test/products/item", "http://www.evo.com/products/item", "https://user:password@www.evo.com/products/item", "https://www.evo.com/shop/item"]:
            with self.subTest(url=url):
                session = Mock()
                self.assertEqual(fetch_evo_official_read(url, session)["_err"], "evo_invalid_product_url")
                session.get.assert_not_called()
        self.assertEqual(evo_js_url(URL + ".js?variant=10"), URL + ".js")

    def test_audit_runs_when_production_fetch_selector_and_browser_raise(self):
        raw = json.dumps({"variants": [variant(1, 3499, 5295)]}).encode()
        session = Mock()
        session.get.return_value = SimpleNamespace(status_code=200, content=raw)
        with (
            patch("dealers.evo_price.select_variant_price", side_effect=AssertionError("production selector called")) as selector,
            patch("dealers.revalidate.select_variant_price", side_effect=AssertionError("production selector alias called")) as selector_alias,
            patch("dealers.evo.Scraper.parse_pdp_product", side_effect=AssertionError("production parser called")) as parser,
            patch("dealers.revalidate.fetch_evo_pdp", side_effect=AssertionError("production fetch called")) as production_fetch,
            patch.object(audit, "open_camoufox_browser", side_effect=AssertionError("browser called")) as browser,
        ):
            first = audit.read_evo(row(), session)
            second = audit.read_evo(row(), session)
            result = audit.build_audits([row()], {row()["sku_id"]: first}, {row()["sku_id"]: second})
        self.assertEqual(result[0]["verdict"], "correct")
        selector.assert_not_called()
        selector_alias.assert_not_called()
        parser.assert_not_called()
        production_fetch.assert_not_called()
        browser.assert_not_called()
        module = Path(__file__).resolve().parent.parent / "tools" / "evo_price_evidence.py"
        imports = [node for node in ast.walk(ast.parse(module.read_text())) if isinstance(node, ast.ImportFrom)]
        self.assertFalse(any((node.module or "").startswith("dealers") for node in imports))

    def test_audit_artifact_round_trip_keeps_db_pair_and_source_evidence(self):
        read = official([variant(1, 3499, 5295), variant(2, 52995, 52995)])
        wrong = row(original=529.95, discount=93)
        result = audit.build_audits([wrong], {wrong["sku_id"]: read}, {wrong["sku_id"]: read})
        saved = json.loads(json.dumps(result))[0]
        self.assertEqual(saved["verdict"], "confirmed_wrong")
        self.assertFalse(saved["db_pair_evidence"][0]["pair_exists"])
        self.assertTrue(saved["official_reads"][0]["evo_evidence"]["pair_exists"])
        self.assertEqual(saved["official_reads"][1]["evo_evidence"]["raw_price_cents"], 3499)

    def test_one_failed_read_cannot_confirm_a_wrong_pair(self):
        read = official([variant(1, 3499, 5295)])
        candidate = row(original=529.95, discount=93)
        result = audit.build_audits(
            [candidate], {candidate["sku_id"]: read},
            {candidate["sku_id"]: {"_err": "evo_http 403"}},
        )[0]
        self.assertEqual(result["verdict"], "unverifiable")
        self.assertEqual(result["error"], "evo_http 403")

    def test_a_one_cent_change_is_an_inconsistent_official_read(self):
        first = official([variant(1, 3499, 5295)])
        second = official([variant(1, 3500, 5295)])
        candidate = row(original=529.95, discount=93)
        result = audit.build_audits(
            [candidate], {candidate["sku_id"]: first}, {candidate["sku_id"]: second}
        )[0]
        self.assertEqual(result["verdict"], "unverifiable")
        self.assertEqual(result["error"], "inconsistent_official_reads")

    def test_noncanonical_tied_pair_is_confirmed_wrong_despite_membership(self):
        read = official([variant("canonical", 1000, 2000), variant("other", 1000, 3000)])
        candidate = row(10, 30, 67)
        result = audit.build_audits([candidate], {candidate["sku_id"]: read}, {candidate["sku_id"]: read})[0]
        self.assertEqual(result["verdict"], "confirmed_wrong")
        self.assertEqual(result["error"], "db_noncanonical_variant_pair")
        self.assertTrue(result["db_pair_evidence"][0]["pair_exists"])


if __name__ == "__main__":
    unittest.main()
