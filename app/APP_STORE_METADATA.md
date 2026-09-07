# GearDrop 1.2 App Store Metadata

## Release boundary

The canonical five-language package is `store-metadata/next-version.json`, prepared for **1.2.0 / Build 12**. It is a release candidate until the exact version/build is frozen and read back from App Store Connect. Do not apply it to the existing 1.1 review record.

Run `npm run verify:store-metadata` before and after every metadata edit. The verifier enforces Apple field limits, the 100-byte keyword limit, five exact locales, six unique screenshot headlines, required legal links, brand-neutral public copy, no hard-coded StoreKit prices, and no promises of instant alerts or trial eligibility.

## Product claims

GearDrop 1.2 supports a paired market/currency choice, regional comparison, three-brand Deals and Yearbook browsing, saved item/model targets, five UI languages, and System/Light/Dark appearance. Price checks run on-device when iOS schedules background work. After a force quit, the user must reopen GearDrop before checks can resume. Notifications require permission and have no guaranteed delivery time.

Low-price signals, deal summaries, and filters remain available on Free. Free includes 30 days of price history, up to 20 saved items/models, and one active price alert. Pro unlocks 12 months of price history, unlimited saved items/models, and unlimited active price alerts. These limits must match `FREE_WATCHLIST_LIMIT` and `FREE_ALERT_LIMIT` in the final source before submission.

GearDrop Pro prices and products displayed in the app come from Apple StoreKit. Metadata must not state a price, discount, introductory offer, or free-trial eligibility.

## Screenshot order

1. Deals feed with the selected market.
2. Product detail with a real price signal.
3. Same product family compared across regions.
4. Saved item/model with a real target and alert state.
5. Pro/full-history view with a current localized StoreKit price.
6. Three-brand Yearbook with a deterministically linked live offer.

All 30 screenshots must be fresh opaque 1320×2868 PNG captures from the exact signed candidate. Missing files must fail validation. Prototype, fixture, old-build, and recomposed evidence cannot be used as signed-build screenshots. See `store-metadata/SCREENSHOT_PLAN.md`.

## App Review notes draft

GearDrop is a native React Native / Expo app. It displays outdoor product and price-history data, saves preferences and watched products on-device, and supports three outdoor brands.

Version 1.2 lets a user select a market and display currency, compare regional prices, save an item or model, and set a target price. Price checks use iOS Background Tasks and local notifications. iOS decides when background work runs; delivery is not immediate or guaranteed at an exact time. If the user force-quits GearDrop, they must reopen it before checks can resume.

Pro access comes only from the RevenueCat `Pro` entitlement. The paywall reads the available products and localized prices from Apple StoreKit and provides purchase and Restore Purchases actions. The listing makes no claim that a user is eligible for a free trial.

Products expected for the release:
- `dev.100app.geardrop.pro.monthly`
- `dev.100app.geardrop.pro.annual`
- `dev.100app.geardrop.pro.lifetime`

Support: https://geardrop.100app.dev/support.html
Privacy: https://geardrop.100app.dev/privacy.html
Terms: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

Replace this draft with exact signed-build navigation steps and current App Store Connect product states after the device purchase matrix. Do not place sandbox credentials in source control.

## Apply sequence

1. Freeze the exact 1.2.0 / Build 12 source and signed artifact.
2. Run the full local release gate and physical-device checklist.
3. Complete StoreKit purchase/restore and notification scheduling checks.
4. Capture and validate all 30 localized screenshots.
5. Read the editable version, build, IAP, localization, and screenshot state from App Store Connect.
6. Apply the five manifest localizations and matching screenshot sets.
7. Read back every field and screenshot count in a fresh session before submission.
