# GearDrop 1.2 iOS Release Readiness

Last updated: 2026-09-07 CST.

This document is the evidence ledger for **1.2.0 / Build 12**. Earlier builds do not satisfy a row for this candidate.

## Candidate status

| Gate | Required evidence | Current status |
|---|---|---|
| Source freeze | Exact commit, clean tree, app version 1.2.0 and iOS build 12 | Pending root integration and version freeze |
| Local gate | Tests, typecheck, config, assets, store metadata, Expo Doctor, live data/rates, iOS export | Pending on final integrated commit |
| Preferences migration | Valid v1+region and v2 migration; malformed/read/write failure; pre-hydration and concurrent writes | Pure-store regression tests added; rerun on final commit |
| Market/currency | Real catalog markets, paired persistence, valid conversion and safe invalid-rate fallback | Static/unit coverage present; device pass pending |
| Notifications | Runtime registered from root; permission, one scheduled check, target match, tap route, relaunch behavior | Pending final integration and signed-device pass |
| Appearance/localization | System/Light/Dark and five languages across all primary flows | Pending device matrix |
| StoreKit | Current localized products/prices, purchase, cancel, pending, entitlement, restore, offline recovery | Pending signed-device sandbox evidence |
| Privacy/support | Production URLs and disclosed data flow match final binary | Pending fresh HTTP and source/readback check |
| Screenshots | 5 locales × 6 opaque 1320×2868 PNGs from exact signed candidate | Pending; missing files intentionally fail |
| App Store Connect | Build VALID, IAP state, metadata and screenshots read back from fresh session | Pending external readback |
| Submission | Exact candidate attached and submitted | User authorized release; waiting final acceptance and root-controlled production submission |

## Notification wording acceptance

Review copy and product UI must say that price checks occur on-device when iOS schedules background work. A force-quit stops future checks until GearDrop is reopened. Do not claim continuous, instant, exact-time, or server/email model notifications unless the final shipped implementation and privacy disclosure prove them.

## Release commands

Run from `app/` on the final integrated commit:

```sh
npm test
npm run typecheck
npm run verify:config
npm run verify:release-assets
npm run verify:store-metadata
npm run verify:store-screenshots
npm run doctor
npm run verify:rates
npm run verify:live-data
npx expo export --platform ios --output-dir /tmp/geardrop-12-ios-export
```

A screenshot validation failure is expected until all 30 signed-build images exist. Record it as an open blocker; never substitute prototype or old-build art.

## Evidence record

```text
source_commit=
working_tree_clean=
app_version=
ios_build_number=
tests=
typecheck=
verify_config=
verify_release_assets=
verify_store_metadata=
verify_store_screenshots=
expo_doctor=
verify_rates=
verify_live_data=
ios_export_modules=
ios_export_bundle_bytes=
signed_build_id=
signed_artifact_sha256=
device_matrix=
storekit_matrix=
notification_matrix=
asc_build_state=
asc_metadata_readback=
asc_screenshot_readback=
```

Do not mark a field complete from an older build, simulator-only behavior when a physical device is required, source inspection alone, or another agent’s report without reproducing the evidence.
