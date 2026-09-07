# GearDrop 1.2 iOS Release Readiness

Last updated: 2026-09-07 17:24 Asia/Taipei.

This ledger records **1.2.0 / Build 13**, with frozen binary source `6d411d7776e08d3a74be176b35de646811048ab0`. Subsequent documentation-only commits do not change that binary provenance. The website is deployed; Build 13 is valid and available to the existing internal TestFlight group. App Store 1.2.0 has not been submitted for review.

## Candidate status

| Gate | Current evidence | Remaining requirement |
|---|---|---|
| Source freeze | Clean integration and native trees at `6d411d7`; version 1.2.0 / build 13 | None for this binary |
| Local gate | Root ran `npm run verify`: 151 pass / 0 fail, typecheck, config/assets/metadata, Doctor 20/20, live/rates, iOS export 1537 modules / 44 assets; `verify_local_ok` | None for local gate |
| Repository tests | Root Python unittest 258 / OK; Node 23 pass / 0 fail | None for these regressions |
| Preferences migration | Final pure-store tests cover migration, persistence errors and concurrent writes; native Build 12→13 CAD preference retained | Complete final signed physical-device smoke |
| Market/currency | Native 13 Me/Deals/Yearbook share AU=AUD, DK=DKK, SE=SEK; legacy CAD preserved across tabs and relaunch | Complete final signed physical-device smoke |
| Notifications | Final monitor/target/permission/route regressions pass; native simulator watch and USD target persist | Signed physical-device background, tap route, relaunch and offline matrix |
| Appearance/localization | Final five-language category coverage has zero gaps; German/Dark native and French/Dark + Japanese/Light Web layout observations | Remaining signed physical-device language/appearance matrix |
| StoreKit | Three live IAPs APPROVED; native 13 loads current products; cancel and no-purchase restore observed without false Pro | Signed-device sandbox purchase, pending, purchased restore, entitlement and offline evidence |
| Privacy/support | Root public HTTP 200 readbacks; production privacy bytes equal candidate | None for URL/source consistency |
| Signed artifact | EAS FINISHED; root IPA version/profile/arm64 and codesign deep/strict verified | None for artifact verification |
| Screenshots | `npm run verify:store-screenshots` exits 1: all 30 candidate files missing | Exact candidate 5 × 6 opaque 1320×2868 PNGs and ASC readback |
| App Store Connect | Build 13 VALID, attached to editable 1.2.0; existing internal group IN_BETA_TESTING; five-language metadata read back across 10 resources | Final screenshots and signed-device evidence |
| Submission | 1.2.0 PREPARE_FOR_SUBMISSION; existing 1.0 READY_FOR_SALE | User authorized release; submit after acceptance gates above |

## Production and artifact evidence

- Website: `https://geardrop.100app.dev`, root HTTP 200 readback, `X-Code-Revision=6d411d7776e08d3a74be176b35de646811048ab0`.
- Data publication: revision `e3ef16435ab519057f6a`, artifact `ba829f2a7aa7088cd58b`; publication source revision `4e67f95` is distinct from running website code. All 604 category repairs applied with zero concurrent skips/readback errors; independent subsequent repair plan has zero remaining changes, and public static/API categories agree.
- Official catalog: authoritative sync and independent readback 1,459 products across three brands; daily workflow enabled. Counts are observations from this release, not permanent live values.
- EAS build: `6e8bb8fd-e08c-4a81-a6cb-59e536396e96`, production / STORE, FINISHED.
- IPA: 30,187,639 bytes; SHA-256 `a23fddba5c83d3c4e26466841a0c1992143757200df463fdd3547e14dcb0dd30`.
- Apple build: `902aee5d-31bb-44aa-b5b6-54835f3f5abf`, VALID; `altool` reported `UPLOAD SUCCEEDED with no errors`.
- Full release report, file list and evidence hashes: `.agent/release-evidence/RELEASE-1.2.0-13.md` in the persistent integration worktree. Evidence/artifacts are intentionally ignored by Git.

## Remaining device and screenshot conditions

The current iPhone Mirroring surface requires the user to lock the paired iPhone and keep it near the Mac. Available paired device models are iPhone 14 Pro and 16 Pro. The screenshot contract in `store-metadata/SCREENSHOT_PLAN.md` requires the exact signed candidate on iPhone 16 Pro Max at 1320×2868. A request to use same-source native 6.9-inch simulator captures while retaining physical-device acceptance is awaiting the user's answer; this ledger does not grant that exception.

Native simulator purchase cancellation and no-purchase restore do not prove successful sandbox purchase or purchased restore. Simulator notification permission/persistence does not prove actual iOS background delivery. Physical verification remains open.

The unshipped Expo Web QA surface has nested-button DOM warnings. The deployed static website and iOS native runtime do not use that DOM path. Resolve it before any future Expo Web production release; do not report its console as error-free.

## Notification wording acceptance

Price checks occur on-device when iOS schedules background work. A force-quit stops future checks until GearDrop is reopened. Do not claim continuous, instant or exact-time checks. Optional SKU email subscriptions are independent; local removal does not unsubscribe email, which uses the email's unsubscribe link. No test email was sent in this release verification.

## Reproducible commands

From `app/` on frozen source `6d411d7`:

```sh
npm run verify
npm run verify:store-screenshots
```

From the integration repository root:

```sh
.agent/release-tools/py/bin/python -m unittest discover -s tests
node --test tests/*.js
```

The first App command passed with `verify_local_ok`; the screenshot command failed for the 30 missing files. Native simulator Release separately ended with `BUILD SUCCEEDED`. Do not replace physical-device or final screenshot evidence with older builds, source inspection, simulator-only behavior or another agent's report.
