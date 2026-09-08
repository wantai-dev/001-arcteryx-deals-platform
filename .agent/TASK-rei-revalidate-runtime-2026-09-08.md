# TASK: Restore formal REI price revalidation

## Why

Production price audit epoch `2026-09-08T13:02:08Z` confirmed that `rei:243257`
is stale in production (`139.83/280 USD`) while two independent official PDP reads
returned `280/280 USD`. The repository-owned targeted revalidation workflow failed
on GitHub-hosted runners with HTTP 403 and must be repaired without bypassing the
formal production synchronization path.

## Current status

- State: production repaired, fixed sample replay passed, and unsupported GitHub REI
  egress is being removed from the scheduled/manual workflow contract.
- Baseline: `origin/main` at `2ccdeb4b0b068354086c728ead45ad047794ea23`.
- Branch: `codex/auto-fix-data-health-20260908-rei-runtime`.
- First repair commit: `9edd8af8593f8a4e93d41ebaed8944409da9f129`.
- Repair budget: round 2 of 2 for this epoch and failure signature.

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
- Source: GitHub canary run `34235395519`
  - The repaired warm-up succeeded, but the exact REI PDP still returned HTTP 403 from
    the GitHub-hosted Azure runner. This is an egress restriction, not a parser failure.
- Source: formal Lightsail wrapper log
  `/home/ec2-user/arcteryx/revalidate-targeted-20260908T1407Z.log`
  - The lease-protected repository wrapper ran only `rei:243257` and reported
    `rei ok=1 价变=1 缺货=0 隔离=0 错=0`.
- Source: fixed-sample replay artifact
  `/Users/J/.codex/automations/automation-5/runs/20260908T130208Z-2ccdeb4/price-audit-replay-after-rei-fix.json`
  - The original 70/10/10/10 queue remained eligible and passed: sampled 100,
    verified 97, correct 97, confirmed wrong 0, unverifiable 3, accuracy 1.0.
  - `rei:243257` read `280/280/0 USD` from production and twice from the official PDP.
- Source: `tools/wait_for_data_release.py` at 2026-09-08T14:24:52.817Z
  - Published `code_revision=9edd8af8593f8a4e93d41ebaed8944409da9f129`,
    `data_revision=b725cc4a45046bf5b985`,
    `artifact_revision=d7ee638964d76737164e`, active products 6,446.
- SSENSE is retired and is outside this repair scope. It must not be probed or restored.

## Assumptions to verify

- REI may eventually lift the GitHub-hosted Azure egress restriction. Until separately
  proven, that path remains unsupported and must not be used as a capability probe.

## Next steps

1. Land the workflow guard that schedules only EVO/MEC and rejects REI before writes.
2. Synchronize automation-5 so exact REI recovery uses the lease-protected direct-server
   wrapper and retains the four daily full-audit windows.
3. Persist final gate evidence in automation memory.

## Dead ends / prohibited paths

- Do not repeat the unchanged GitHub-hosted REI request.
- Do not edit production data manually or write outside repository workflows.
- Do not use search snippets, caches, inferred prices, or another SKU/region.
- Do not probe or change SSENSE.

## Local validation

- `uv run --with-requirements requirements.txt python -m unittest discover -s tests`
  - `Ran 268 tests` / `OK`.
- `node --test tests/*.js`
  - 30 passed, 0 failed.
- Parsed all 10 workflow YAML files with PyYAML.
- `python3 -m py_compile dealers/revalidate.py tools/audit_price_accuracy.py`
  - exit 0.
- `bash -n server_run_revalidate.sh`
  - exit 0.
- `git diff --check`
  - exit 0.
