import unittest
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
SERVER_RUN_SCRIPTS = (
    "server_run_update.sh",
    "server_run_dealers.sh",
    "server_run_mec.sh",
    "server_run_revalidate.sh",
)


class ServerRunLeaseTests(unittest.TestCase):
    def test_success_requires_explicit_end_of_run_marker(self):
        for filename in SERVER_RUN_SCRIPTS:
            with self.subTest(filename=filename):
                script = (PROJECT / filename).read_text()
                marker_default = script.index("RUN_COMPLETED=false")
                success_guard = script.index(
                    '[ "$exit_code" -eq 0 ] && [ "$RUN_COMPLETED" = true ]'
                )
                if filename == "server_run_update.sh":
                    end_banner = script.rindex(" DONE =====\"")
                else:
                    end_banner = script.rindex(" END =====\"")
                marker_complete = script.rindex("RUN_COMPLETED=true")

                self.assertLess(marker_default, success_guard)
                self.assertLess(success_guard, end_banner)
                self.assertLess(end_banner, marker_complete)
                self.assertIn('message="incomplete run (exit $exit_code)"', script)

    def test_dealer_quality_gates_enforce_product_freshness(self):
        files = (
            "server_run_dealers.sh",
            "server_run_mec.sh",
            ".github/workflows/refresh-mec.yml",
            ".github/workflows/freshness-monitor.yml",
            ".github/workflows/revalidate-dealer-prices.yml",
            ".github/workflows/refresh-dealers.yml",
        )
        for filename in files:
            with self.subTest(filename=filename):
                self.assertIn(
                    "--max-product-age-hours 72",
                    (PROJECT / filename).read_text(),
                )

    def test_primary_revalidation_rotates_a_bounded_dealer_cohort(self):
        script = (PROJECT / "server_run_revalidate.sh").read_text()
        self.assertIn(
            'REVALIDATE_MAX_ROWS_PER_DEALER="${REVALIDATE_MAX_ROWS_PER_DEALER:-50}"',
            script,
        )
        self.assertIn("export REVALIDATE_MAX_ROWS_PER_DEALER", script)


if __name__ == "__main__":
    unittest.main()
