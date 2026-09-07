# GearDrop 1.2 iOS Release Readiness

Last updated: 2026-09-07, Build 14 preparation.

This ledger records the pending **1.2.0 / Build 14** candidate. Build 14 is not source-frozen, built, signed, uploaded, attached, device-accepted, or captured. Build 13 from source `6d411d7776e08d3a74be176b35de646811048ab0` is VALID and available to the existing internal TestFlight group, but a physical-device check found that the alert modal labels an official list price as the current price. Build 13 is therefore superseded and none of its candidate-specific acceptance fields complete a Build 14 gate. A physical purchase attempt also returned an undifferentiated failure without an Apple confirmation sheet; Build 14 will preserve actionable, sanitized failure outcomes before this path is retested. The website independently advanced to `ae306995aa91cb6526d4af378f0c7b630605275c` through the SEO rollout; App Store 1.2.0 has not been submitted for review.

## Candidate status

| Gate | Current evidence | Remaining requirement |
|---|---|---|
| Source freeze | Build 14 is pinned in release configuration; alert price-source correction is still being integrated | Freeze the exact final source and clean integration/native trees |
| Local gate | Build 13 historical gate passed | Rerun tests, typecheck, config/assets/metadata, Doctor, live/rates and iOS export on frozen Build 14 |
| Repository tests | Build 13 historical Python and Node suites passed | Rerun complete Python and Node suites on frozen Build 14 |
| Preferences migration | Build 13 tests and device observations exist | Repeat the required signed physical-device smoke on Build 14 |
| Market/currency | Build 13 market and legacy-currency observations exist | Repeat the required signed physical-device smoke on Build 14 |
| Notifications | Build 13 exposed the alert current-price source defect | Verify corrected source semantics, scheduling, tap route, relaunch and offline behavior on signed Build 14 |
| Appearance/localization | Build 13 layout and localization observations exist | Complete the signed Build 14 language/appearance matrix |
| StoreKit | Three live IAPs were APPROVED during Build 13 acceptance | Verify current products, cancel, sandbox purchase, pending, purchased restore, entitlement and offline behavior on signed Build 14 |
| Privacy/support | Website currently serves the Build 13 source disclosure | Recheck final Build 14 source against production URL bytes and data flow |
| Signed artifact | Build 13 EAS artifact was independently verified | Produce and independently verify the Build 14 EAS artifact, version, profile, architecture and signature |
| Screenshots | Build 13 had no accepted final screenshot set | Capture exact signed Build 14: 5 × 6 opaque 1320×2868 PNGs, pass the gate and read back ASC |
| App Store Connect | Build 13 is VALID, attached to editable 1.2.0 and in the existing internal group | Upload Build 14, wait for VALID, attach it to 1.2.0 and verify the existing internal group and five-language metadata |
| Submission | 1.2.0 remains PREPARE_FOR_SUBMISSION; existing 1.0 remains public | User authorized release; submit only after the Build 14 acceptance gates above |

## Current production and superseded Build 13 evidence

- Website: `https://geardrop.100app.dev`, root HTTP 200 readback after the independent SEO rollout, API `X-Code-Revision=ae306995aa91cb6526d4af378f0c7b630605275c`. The homepage, catalog API and Arc'teryx aggregation page returned HTTP 200.
- Latest observed data publication: revision `d5ef1e7fde596d64f8e1`, artifact `a60fc6b14231177f6109`, publication source `ae306995aa91cb6526d4af378f0c7b630605275c`, 6,794 active products; evidence `web-current-after-seo-merge.json`. Earlier in this release all 604 category repairs applied with zero concurrent skips/readback errors, the independent subsequent repair plan had zero remaining changes, and public static/API categories agreed. These are timestamped observations, not permanent live values.
- Official catalog: authoritative sync and independent readback 1,459 products across three brands; daily workflow enabled. Counts are observations from this release, not permanent live values.
- Superseded Build 13 EAS build: `6e8bb8fd-e08c-4a81-a6cb-59e536396e96`, production / STORE, FINISHED.
- Superseded Build 13 IPA: 30,187,639 bytes; SHA-256 `a23fddba5c83d3c4e26466841a0c1992143757200df463fdd3547e14dcb0dd30`.
- Superseded Apple Build 13: `902aee5d-31bb-44aa-b5b6-54835f3f5abf`, VALID and available to the existing internal group. It must not be selected for submission.
- Build 13 report, file list and evidence hashes: `.agent/release-evidence/RELEASE-1.2.0-13.md` in the persistent integration worktree. Evidence/artifacts are intentionally ignored by Git and remain historical.

## Remaining device and screenshot conditions

The screenshot contract in `store-metadata/SCREENSHOT_PLAN.md` requires the exact signed Build 14 candidate on iPhone 16 Pro Max at 1320×2868. The user has not approved 6.9-inch simulator captures as final screenshots; this ledger does not grant that exception. Physical-device observations from Build 13 remain useful regression targets but do not complete Build 14 acceptance.

Simulator purchase cancellation and no-purchase restore do not prove successful sandbox purchase or purchased restore. Simulator notification permission/persistence does not prove actual iOS background delivery. Build 14 physical verification remains open.

The unshipped Expo Web QA surface has nested-button DOM warnings. The deployed static website and iOS native runtime do not use that DOM path. Resolve it before any future Expo Web production release; do not report its console as error-free.

## Notification wording acceptance

Price checks occur on-device when iOS schedules background work. A force-quit stops future checks until GearDrop is reopened. Do not claim continuous, instant or exact-time checks. Optional SKU email subscriptions are independent; local removal does not unsubscribe email, which uses the email's unsubscribe link. No test email was sent in this release verification.

## Reproducible commands

From `app/` after the exact Build 14 source is frozen:

```sh
npm run verify
npm run verify:store-screenshots
```

From the integration repository root:

```sh
.agent/release-tools/py/bin/python -m unittest discover -s tests
node --test tests/*.js
```

Record fresh Build 14 output for every command. The screenshot command must continue to fail until all 30 exact-candidate files exist. Do not replace Build 14 physical-device or final screenshot evidence with Build 13, source inspection, simulator-only behavior or another agent's report.
