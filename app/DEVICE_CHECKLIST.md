# GearDrop 1.2 Device Checklist

Record every result against the exact signed 1.2.0 / Build 14 candidate. Build 13 observations are historical and do not complete a Build 14 row.

## Device and build

```text
source_commit=
build_id=
artifact_sha256=
device_model=
iOS_version=
install_source=
test_storefront=
```

## Core navigation and accessibility

- [ ] Fresh install opens Deals without a red screen.
- [ ] Tabs appear in order: Deals, Yearbook, Watchlist, Me.
- [ ] Primary interactive controls have at least a 44×44 pt target.
- [ ] Keyboard does not cover search, target-price, purchase, restore, or support controls.
- [ ] Dynamic Type and VoiceOver expose readable labels and no clipped primary action.
- [ ] All 11 approved category silhouettes render correctly: Yearbook intentionally uses them as shipped UI, while other screens use them when remote images fail.

## Market, language, and appearance

- [ ] Market and currency save as one choice and survive relaunch.
- [ ] Switching Original → CNY with cached rates immediately shows CNY and cached status.
- [ ] Invalid or unavailable rates keep the original amount/currency and never show NaN, Infinity, or a negative alert target.
- [ ] English, Simplified Chinese, German, French, and Japanese cover Deals, detail, Yearbook, Watchlist, Me, Paywall, and Privacy.
- [ ] System, Light, and Dark follow the selected appearance without relaunch.
- [ ] Muted/faint text remains readable; product-photo background is consistent.

## Watch and notifications

- [ ] Save an item and a model, set/edit/remove a target, and verify the documented free limit.
- [ ] Denied notification permission shows a recoverable state and does not claim an alert is active.
- [ ] With permission granted, arm a target and confirm the runtime schedules its background task.
- [ ] Confirm a due target produces the expected local notification and tapping it opens the correct product/model.
- [ ] Relaunch preserves watches, targets, and notification preference.
- [ ] Force quit, wait through a scheduled window, and confirm the app makes no promise of running; reopen and verify scheduling resumes.
- [ ] Airplane/offline and stale-data paths do not produce a false price-drop notification.

Record:
```text
notification_permission=
scheduled_task_identifier=
scheduled_at=
delivered_at=
tap_destination=
force_quit_result=
reopen_resume_result=
```

## StoreKit / Pro

- [ ] Paywall loads current StoreKit products and localized prices for the test storefront.
- [ ] Annual is selected by default without a fabricated saving or trial.
- [ ] Monthly, annual, and lifetime purchase paths are tested as available.
- [ ] Cancellation and pending purchase keep Free access and show recoverable copy.
- [ ] Active `Pro` entitlement unlocks only the implemented Pro features.
- [ ] Restore Purchases works after reinstall; no-purchase restore does not unlock Pro.
- [ ] Offline/relaunch state matches RevenueCat customer information without a local Pro toggle.

## Purchase and outbound links

- [ ] Buy opens the original merchant URL in the system browser.
- [ ] Privacy, support, Terms, and Manage Subscription links open their intended destinations.
- [ ] Final price/stock disclaimer is visible where required.

## Localized App Store captures

For each of `en-US`, `zh-Hans`, `de-DE`, `fr-FR`, and `ja`:

- [ ] Capture six specified screens from this exact signed build at 1320×2868.
- [ ] StoreKit price matches locale/storefront.
- [ ] No tester identity, debug UI, placeholder, fixture, fake notification, invented price, or prototype content.
- [ ] Run `npm run verify:store-screenshots`; all 30 images pass RGB/no-alpha/dimension checks.

## Final record

```text
core_navigation=pass/fail
market_currency=pass/fail
five_languages=pass/fail
appearance=pass/fail
watch_notifications=pass/fail
storekit=pass/fail
links=pass/fail
screenshots=pass/fail
open_issues=
tester=
tested_at=
```
