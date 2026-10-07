import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tools.audit_price_accuracy as audit_module
from tools.audit_price_accuracy import (
    DEALER_TARGETS,
    AuditSetupError,
    build_audits,
    normalize_read,
    sample_rows,
    sample_rows_from_artifact,
    summarize,
)
from tools.evo_price_evidence import parse_evo_official_read


def row(sku_id, dealer, sale=100.0, original=120.0, discount=17):
    return {
        "sku_id": sku_id,
        "dealer": dealer,
        "status": "active",
        "sale_price": sale,
        "original_price": original,
        "discount_pct": discount,
        "url": f"https://example.test/{sku_id}",
        "currency": "USD",
        "region": "us",
        "color": "Black",
    }


class PriceAuditTests(unittest.TestCase):
    def test_stratified_sample_is_exact_and_reproducible(self):
        rows = []
        counts = {
            "arcteryx_outlet": 90,
            "evo": 20,
            "mec": 20,
            "rei": 20,
        }
        for dealer, count in counts.items():
            rows.extend(row(f"{dealer}:{index}", dealer) for index in range(count))

        first, first_seed = sample_rows(rows, "2026-07-31T00:00:00Z", "abc123")
        second, second_seed = sample_rows(rows, "2026-07-31T00:00:00Z", "abc123")

        self.assertEqual(first_seed, second_seed)
        self.assertEqual(
            [item["sku_id"] for item in first],
            [item["sku_id"] for item in second],
        )
        self.assertEqual(len(first), 100)
        self.assertEqual(len({item["sku_id"] for item in first}), 100)
        by_dealer = {}
        for item in first:
            by_dealer[item["dealer"]] = by_dealer.get(item["dealer"], 0) + 1
        self.assertEqual(
            by_dealer,
            {
                "arcteryx_outlet": 70,
                "evo": 10,
                "mec": 10,
                "rei": 10,
            },
        )

    def test_prior_artifact_reuses_exact_sku_order_with_current_rows(self):
        rows = [
            row(f"{dealer}:{index}", dealer)
            for dealer, count in DEALER_TARGETS.items()
            for index in range(count)
        ]
        artifact = {
            "sample_seed": 123,
            "audits": [{"sku_id": item["sku_id"]} for item in reversed(rows)],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.json"
            path.write_text(json.dumps(artifact), encoding="utf-8")
            sample, seed = sample_rows_from_artifact(rows, path)

        self.assertEqual(seed, 123)
        self.assertEqual(
            [item["sku_id"] for item in sample],
            [item["sku_id"] for item in reversed(rows)],
        )

    def test_main_marks_ineligible_fixed_sample_as_lifecycle_inconclusive(self):
        rows = [
            row(f"{dealer}:{index}", dealer)
            for dealer, count in DEALER_TARGETS.items()
            for index in range(count)
        ]
        artifact = {
            "sample_seed": 123,
            "audits": [{"sku_id": item["sku_id"]} for item in rows],
        }
        with tempfile.TemporaryDirectory() as directory:
            sample_path = Path(directory) / "source.json"
            output_path = Path(directory) / "result.json"
            sample_path.write_text(json.dumps(artifact), encoding="utf-8")
            with patch.object(audit_module, "load_online_rows", return_value=rows[1:]), patch.object(
                audit_module.sys,
                "argv",
                [
                    "audit_price_accuracy.py",
                    "--sample-file",
                    str(sample_path),
                    "--output",
                    str(output_path),
                    "--run-start",
                    "2026-08-24T00:00:00Z",
                    "--origin-sha",
                    "abc123",
                ],
            ):
                return_code = audit_module.main()
            result = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(return_code, 2)
        self.assertFalse(result["gate"]["passed"])
        self.assertEqual(result["gate"]["status"], "inconclusive_lifecycle")
        self.assertIn("sample rows are no longer eligible", result["setup_error"])
        self.assertEqual(result["audits"], [])

    def test_sample_fails_when_a_dealer_cannot_meet_its_quota(self):
        rows = [
            row(f"{dealer}:{index}", dealer)
            for dealer, count in DEALER_TARGETS.items()
            for index in range(count - (1 if dealer == "rei" else 0))
        ]

        with self.assertRaisesRegex(
            AuditSetupError,
            "insufficient eligible rows for rei",
        ):
            sample_rows(rows, "2026-07-31T00:00:00Z", "abc123")

    def test_build_audits_keeps_unverifiable_out_of_accuracy(self):
        sample = [
            row("outlet:correct", "arcteryx_outlet"),
            row("evo:wrong", "evo"),
            row("rei:blocked", "rei"),
        ]
        first = {
            "outlet:correct": {
                "sale_price": 100,
                "original_price": 120,
                "discount_pct": 17,
            },
            "evo:wrong": parse_evo_official_read(
                json.dumps({"variants": [{
                    "id": 1, "available": True, "price": 9000, "compare_at_price": 12000,
                }]}).encode(),
                "https://www.evo.com/products/audit-fixture",
            ),
            "rei:blocked": {"_err": "goto Error: blocked"},
        }
        second = dict(first)

        audits = build_audits(sample, first, second)
        summary = summarize(audits)

        self.assertEqual(
            [audit["verdict"] for audit in audits],
            ["correct", "confirmed_wrong", "unverifiable"],
        )
        self.assertEqual(summary["verified"], 2)
        self.assertEqual(summary["correct"], 1)
        self.assertEqual(summary["confirmed_wrong"], 1)
        self.assertEqual(summary["unverifiable"], 1)
        self.assertEqual(summary["accuracy"], 0.5)

    def test_evo_price_without_raw_variant_evidence_is_unverifiable(self):
        candidate = row("evo:no-proof", "evo")
        read = {"sale_price": 100, "original_price": 120, "discount_pct": 17}
        result = build_audits([candidate], {candidate["sku_id"]: read}, {candidate["sku_id"]: read})
        self.assertEqual(result[0]["verdict"], "unverifiable")
        self.assertEqual(result[0]["error"], "evo_missing_variant_evidence")

    def test_evo_two_reads_must_agree_before_a_wrong_pair_is_confirmed(self):
        candidate = row("evo:changes", "evo")
        def read(sale):
            return parse_evo_official_read(json.dumps({"variants": [{
                "id": 1, "available": True, "price": sale, "compare_at_price": 12000,
            }]}).encode(), "https://www.evo.com/products/audit-fixture")
        first, second = read(9000), read(10000)
        result = build_audits([candidate], {candidate["sku_id"]: first}, {candidate["sku_id"]: second})
        self.assertEqual(result[0]["verdict"], "unverifiable")
        self.assertEqual(result[0]["error"], "inconsistent_official_reads")
        self.assertIn("evo_evidence", result[0]["official_reads"][0])

    @patch("tools.audit_price_accuracy.time.sleep")
    def test_evo_pass_does_not_start_a_browser(self, _sleep):
        candidate = row("evo:raw", "evo")
        read = {"_err": "evo_http 403"}
        with patch.object(audit_module, "read_evo", return_value=read), patch.object(
            audit_module, "open_camoufox_browser", side_effect=AssertionError("browser called")
        ) as browser:
            result = audit_module.read_evo_pass([candidate])
        self.assertEqual(result[candidate["sku_id"]], read)
        browser.assert_not_called()

    def test_official_unavailable_is_fail_closed(self):
        self.assertEqual(
            normalize_read({"_unavailable": True}),
            {"_err": "official_unavailable"},
        )

    @patch("tools.audit_price_accuracy.time.sleep")
    def test_transient_reader_error_retries_only_failed_rows(self, _sleep):
        calls = []

        def reader(rows):
            calls.append([item["sku_id"] for item in rows])
            if len(calls) == 1:
                return {
                    "rei:retry": {"_err": "cf_stub"},
                    "rei:terminal": {"_err": "color_variant_not_found"},
                }
            return {
                "rei:retry": {
                    "sale_price": 100.0,
                    "original_price": 120.0,
                    "discount_pct": 17,
                }
            }

        rows = [row("rei:retry", "rei"), row("rei:terminal", "rei")]
        with patch.dict(audit_module.PASS_READERS, {"rei": reader}), patch.dict(
            os.environ,
            {
                "AUDIT_TRANSIENT_RETRY_ATTEMPTS": "1",
                "AUDIT_TRANSIENT_RETRY_DELAY_SECONDS": "0",
            },
        ):
            result = audit_module.run_official_pass(rows, 1)

        self.assertEqual(calls, [["rei:retry", "rei:terminal"], ["rei:retry"]])
        self.assertEqual(result["rei:retry"]["sale_price"], 100.0)
        self.assertEqual(result["rei:terminal"]["_err"], "color_variant_not_found")

    def test_workflow_has_no_supabase_write_secret(self):
        workflow = (
            Path(__file__).resolve().parent.parent
            / ".github"
            / "workflows"
            / "audit-dealer-prices.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("contents: read", workflow)
        self.assertIn("Enforce read-only credential boundary", workflow)
        self.assertIn("tools/audit_price_accuracy.py", workflow)
        self.assertIn("tools/prepare_price_audit_sample.py", workflow)
        self.assertIn("--sample-file artifacts/source-sample.json", workflow)
        self.assertIn("sample_gzip_base64", workflow)
        self.assertIn("sample_sha256", workflow)
        self.assertIn("if: always()", workflow)
        self.assertNotIn("${{ secrets.SUPABASE", workflow)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY: ${{", workflow)

        audit_source = (
            Path(__file__).resolve().parent.parent
            / "tools"
            / "audit_price_accuracy.py"
        ).read_text(encoding="utf-8")
        for forbidden in (
            "SUPABASE_KEY",
            "create_client(",
            ".table(",
        ):
            self.assertNotIn(forbidden, audit_source)


if __name__ == "__main__":
    unittest.main()
