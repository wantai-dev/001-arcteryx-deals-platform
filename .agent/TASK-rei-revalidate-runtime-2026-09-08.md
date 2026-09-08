# TASK: Restore formal REI price revalidation

## Why

Production price audit epoch `2026-09-08T13:02:08Z` confirmed that `rei:243257`
is stale in production (`139.83/280 USD`) while two independent official PDP reads
returned `280/280 USD`. The repository-owned targeted revalidation workflow failed
on GitHub-hosted runners with HTTP 403 and must be repaired without bypassing the
formal production synchronization path.

## Current status

- State: implementation and local validation complete; production deployment pending.
- Baseline: `origin/main` at `2ccdeb4b0b068354086c728ead45ad047794ea23`.
- Branch: `codex/auto-fix-data-health-20260908-rei-runtime`.
- Repair budget: round 1 of 2 for this epoch and failure signature.

## Verified facts

- Source: `/Users/J/.codex/automations/automation-5/runs/20260908T130208Z-2ccdeb4/price-audit-initial.json`
  - Audit sampled 100 and verified 97; one confirmed wrong SKU is `rei:243257`.
  - Official REI PDP was read twice as `280/280 USD`.
- Source: `/Users/J/.codex/automations/automation-5/runs/20260908T130208Z-2ccdeb4/revalidate-34231084955.log`
  - Exact formal revalidation run `34231084955` ended in HTTP 403 for REI.
- Source: automation memory and prior run records
  - The same REI 403 signature has three terminal workflow failures spanning two
    planned windows, so repeating the unchanged GitHub-hosted request is prohibited.
- Source: CodeGraph exploration of current source
  - Both audit and revalidation import the same Camoufox browser opener and REI PDP
    parser. The audit warms `https://www.rei.com/` before the PDP; commit `b24ef1c`
    removed that warm-up from revalidation while adding immediate denial handling.
- Source: read-only Lightsail inspection at 2026-09-08T13:50Z
  - The formal server wrapper is deployed at `2ccdeb4`, but recent daily runs process
    the full EVO inventory and time out after roughly 100 of 1,595 rows before REI.
- SSENSE is retired and is outside this repair scope. It must not be probed or restored.

## Assumptions to verify

- The difference is runtime/session lifecycle or runner egress, not the REI price parser.
- A repository-owned alternate execution path may already exist in history or current
  workflows and can be restored without adding an out-of-band production writer.

## Next steps

1. Validate the restored first-party warm-up and bounded server cohort.
2. Push the repair branch; fast-forward `main` only after evidence-backed verification.
3. Run exact `rei:243257` revalidation, verify production/static/publication, then replay
   the original 100-SKU sample.

## Dead ends / prohibited paths

- Do not repeat the unchanged GitHub-hosted REI request.
- Do not edit production data manually or write outside repository workflows.
- Do not use search snippets, caches, inferred prices, or another SKU/region.
- Do not probe or change SSENSE.

## Local validation

- `uv run --with-requirements requirements.txt python -m unittest discover -s tests`
  - `Ran 267 tests` / `OK`.
- `node --test tests/*.js`
  - 30 passed, 0 failed.
- Parsed all 10 workflow YAML files with PyYAML.
- `python3 -m py_compile dealers/revalidate.py tools/audit_price_accuracy.py`
  - exit 0.
- `bash -n server_run_revalidate.sh`
  - exit 0.
- `git diff --check`
  - exit 0.
