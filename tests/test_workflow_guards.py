import os
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class WorkflowGuardTests(unittest.TestCase):
    def test_official_catalog_sync_is_complete_bounded_and_read_back(self):
        workflow = (ROOT / ".github/workflows/refresh-official-catalog.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn('cron: "40 17 * * *"', workflow)
        self.assertIn("group: geardrop-official-yearbook-sync", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("timeout-minutes: 150", workflow)
        self.assertIn("timeout 7200 python -u -m catalog.official_catalog", workflow)
        self.assertIn("--sync-supabase", workflow)
        self.assertNotIn("--brand", workflow)
        self.assertNotIn("--limit", workflow)
        self.assertIn("--scope official-catalog", workflow)
        self.assertIn("tools/check_official_catalog.py", workflow)
        self.assertIn("if: always() && steps.lease.outputs.acquired == 'true'", workflow)

    def test_monitor_runs_independent_checks_then_aggregates(self):
        workflow = (ROOT / ".github/workflows/freshness-monitor.yml").read_text(encoding="utf-8")
        for step_id in ("outlet_quality", "dealer_quality", "platform_region_quality", "static_fallbacks"):
            self.assertIn(f"id: {step_id}", workflow)
        self.assertEqual(workflow.count("continue-on-error: true"), 4)
        self.assertIn("name: Aggregate production quality gate", workflow)
        self.assertIn("if: always()", workflow)
        self.assertIn('if [ "$failed" -ne 0 ]', workflow)

    def test_outlet_rechecks_active_terminal_url_results(self):
        workflow = (ROOT / ".github/workflows/refresh-outlet.yml").read_text(encoding="utf-8")
        primary_runner = (ROOT / "server_run_update.sh").read_text(encoding="utf-8")
        self.assertIn(
            "--status active --stored-http-status 404 --stored-http-status 410",
            workflow,
        )
        self.assertIn(
            "--status active --stored-http-status 404 --stored-http-status 410",
            primary_runner,
        )

    def test_outlet_release_after_is_captured_at_sync_boundary(self):
        workflow = (ROOT / ".github/workflows/refresh-outlet.yml").read_text(
            encoding="utf-8"
        )
        self.assertEqual(workflow.count("SYNC_COMPLETED_AT=$(date -u"), 1)
        self.assertLess(
            workflow.index("python -u supabase_sync.py"),
            workflow.index("SYNC_COMPLETED_AT=$(date -u"),
        )
        self.assertLess(
            workflow.index("SYNC_COMPLETED_AT=$(date -u"),
            workflow.index("python -u tools/check_product_urls.py"),
        )

    def test_forced_outlet_refresh_still_claims_lease(self):
        workflow = (ROOT / ".github/workflows/refresh-outlet.yml").read_text(encoding="utf-8")
        self.assertIn('acquired=$(python tools/crawler_lease.py acquire --scope outlet', workflow)
        self.assertNotIn('if [ "$FORCE_RUN" = "true" ]; then\n              acquired=true', workflow)
        self.assertIn('if [ "$acquired" = "true" ]; then\n              lease_owned=true', workflow)

    def test_mec_fallback_installs_camoufox_runtime_before_preflight(self):
        workflow = (ROOT / ".github/workflows/refresh-mec.yml").read_text(encoding="utf-8")
        self.assertLess(
            workflow.index("python tools/fetch_camoufox.py"),
            workflow.index("python tools/check_mec_browser_runtime.py"),
        )

    def test_evo_only_revalidation_skips_mec_browser_preflight(self):
        workflow = (ROOT / ".github/workflows/revalidate-dealer-prices.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "if: ${{ contains(format(',{0},', env.REVALIDATE_DEALERS), ',mec,') }}",
            workflow,
        )

    def test_mec_fallback_allows_full_pdp_enrichment_window(self):
        workflow = (ROOT / ".github/workflows/refresh-mec.yml").read_text(encoding="utf-8")
        self.assertIn("timeout-minutes: 120", workflow)
        self.assertIn("timeout 3600 python -u -m dealers.mec", workflow)

    def test_workflows_fetch_camoufox_with_authenticated_helper(self):
        names = (
            "refresh-outlet.yml",
            "refresh-dealers.yml",
            "refresh-mec.yml",
            "revalidate-dealer-prices.yml",
            "audit-dealer-prices.yml",
        )
        for name in names:
            workflow = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
            with self.subTest(workflow=name):
                self.assertIn("GITHUB_TOKEN: ${{ github.token }}", workflow)
                self.assertIn("python tools/fetch_camoufox.py", workflow)
                self.assertNotIn("python -m camoufox fetch", workflow)

    def test_scheduled_revalidation_uses_a_bounded_rotating_cohort(self):
        workflow = (ROOT / ".github/workflows/revalidate-dealer-prices.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "REVALIDATE_MAX_ROWS_PER_DEALER: "
            "${{ github.event_name == 'schedule' && '50' || '' }}",
            workflow,
        )
        self.assertIn(
            "REVALIDATE_DEALERS: "
            "${{ github.event_name == 'schedule' && 'evo' || inputs.dealers }}",
            workflow,
        )
        self.assertNotIn("github.event_name == 'schedule' && 'evo,mec'", workflow)
        self.assertIn("REVALIDATE_SKU_IDS: ${{ inputs.sku_ids }}", workflow)

    def test_revalidation_refuses_rei_before_any_production_write(self):
        workflow = (ROOT / ".github/workflows/revalidate-dealer-prices.yml").read_text(
            encoding="utf-8"
        )
        guard = workflow.index("name: Reject unsupported dealer egress")
        repair = workflow.index("name: Repair derived dealer discounts")
        revalidate = workflow.index("name: Revalidate known dealer URLs")
        self.assertLess(guard, repair)
        self.assertLess(guard, revalidate)
        self.assertIn("REI PDP access is unavailable from GitHub-hosted egress", workflow)
        self.assertIn('default: "evo,mec"', workflow)
        self.assertNotIn(
            "repair_dealer_discounts.py --dealer mec --dealer evo --dealer rei",
            workflow,
        )

    def test_revalidation_commands_use_only_the_validated_dealer_scope(self):
        workflow = (ROOT / ".github/workflows/revalidate-dealer-prices.yml").read_text(
            encoding="utf-8"
        )

        def step_script(name):
            step = workflow.split(f"name: {name}\n", 1)[1].split("\n      - ", 1)[0]
            return "\n".join(
                line[10:] for line in step.split("run: |\n", 1)[1].splitlines()
            )

        # Stub python as a shell function: exercise the real workflow shell and
        # inspect argv without running scripts, network calls, or database writes.
        capture = "python() { printf '%s\\0' \"$@\"; }\n"
        steps = {
            "Repair derived dealer discounts": ["tools/repair_dealer_discounts.py"],
            "Verify dealer data quality": ["tools/check_data_quality.py", "--online"],
        }
        quality_flags = [
            "--max-age-hours", "36", "--max-product-age-hours", "72", "--min-rows", "50"
        ]
        for scope in ("evo", "mec", "evo,mec", "mec,evo"):
            for name, prefix in steps.items():
                with self.subTest(scope=scope, step=name):
                    result = subprocess.run(
                        ["bash", "-eu", "-o", "pipefail", "-c", capture + step_script(name)],
                        env={**os.environ, "REVALIDATE_DEALERS": scope},
                        capture_output=True, check=True,
                    )
                    args = result.stdout.decode().rstrip("\0").split("\0")
                    expected = prefix + [
                        value for dealer in scope.split(",") for value in ("--dealer", dealer)
                    ]
                    if name == "Verify dealer data quality":
                        expected += quality_flags
                    self.assertEqual(args, expected)

        guard = step_script("Reject unsupported dealer egress")
        for scope in ("rei", "evo,rei", "mec,rei", "ssense", "", "evo,invalid"):
            with self.subTest(rejected_scope=scope):
                result = subprocess.run(
                    ["bash", "-eu", "-o", "pipefail", "-c", guard],
                    env={**os.environ, "REQUESTED_DEALERS": scope},
                    capture_output=True,
                )
                self.assertNotEqual(result.returncode, 0)

    def test_revalidation_keeps_repair_only_and_write_serialization(self):
        workflow = (ROOT / ".github/workflows/revalidate-dealer-prices.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "if: ${{ github.event_name != 'workflow_dispatch' || inputs.repair_only != true }}",
            workflow,
        )
        self.assertIn(
            "if: ${{ inputs.repair_only == true || steps.revalidate.outcome == 'success' }}",
            workflow,
        )
        self.assertIn("group: arcteryx-production-refresh-writes", workflow)
        self.assertIn("cancel-in-progress: false", workflow)

    def test_revalidation_preserves_failure_without_fresh_runner_retries(self):
        workflow = (ROOT / ".github/workflows/revalidate-dealer-prices.yml").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("retry-targeted-rei", workflow)
        self.assertNotIn("continue-on-error", workflow)
        self.assertEqual(workflow.count("run: python -u -m dealers.revalidate"), 1)

    def test_active_sources_are_in_primary_and_fallback_dealer_runs(self):
        workflow = (ROOT / ".github/workflows/refresh-dealers.yml").read_text(encoding="utf-8")
        primary_runner = (ROOT / "server_run_dealers.sh").read_text(encoding="utf-8")
        for source in (workflow, primary_runner):
            self.assertIn("burton backcountry evo rei", source)
            self.assertNotIn("burton backcountry evo rei ssense", source)
            self.assertIn("--dealer burton --dealer backcountry", source)
            self.assertIn("tools/retire_dealer.py --dealer ssense", source)


if __name__ == "__main__":
    unittest.main()
