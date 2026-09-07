import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

function assertNoTrademark(value: string, label: string) {
  assert.ok(!/arc'?teryx|始祖鸟/i.test(value), `${label} must not contain protected brand terms`);
}

type AppConfig = {
  expo: {
    name: string;
    slug: string;
    version: string;
    scheme: string;
    icon: string;
    userInterfaceStyle?: string;
    locales?: Record<string, {
      ios?: Record<string, string>;
      android?: Record<string, string>;
    }>;
    ios?: {
      bundleIdentifier?: string;
      buildNumber?: string;
      supportsTablet?: boolean;
      config?: {
        usesNonExemptEncryption?: boolean;
      };
    };
    plugins?: Array<string | [string, Record<string, unknown>]>;
  };
};

type PackageJson = {
  version: string;
  main: string;
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

type EasJson = {
  cli?: {
    appVersionSource?: string;
  };
  build?: {
    production?: {
      autoIncrement?: boolean;
    };
    simulator?: Record<string, unknown>;
  };
  submit?: {
    production?: {
      ios?: {
        ascAppId?: string;
      };
    };
  };
};

const appConfig = readJson<AppConfig>('app.json');
const packageJson = readJson<PackageJson>('package.json');
const easJson = readJson<EasJson>('eas.json');
const metadata = readFileSync(join(root, 'APP_STORE_METADATA.md'), 'utf8');
const supportPage = readFileSync(join(root, '..', 'support.html'), 'utf8');
const webProductDetail = readFileSync(join(root, '..', 'product-detail.html'), 'utf8');
const actionsSource = readFileSync(join(root, 'lib/actions.ts'), 'utf8');
const layoutSource = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
const regionContextSource = readFileSync(join(root, 'contexts/RegionContext.tsx'), 'utf8');
const marketContextSource = readFileSync(join(root, 'contexts/MarketContext.tsx'), 'utf8');
const preferencesContextSource = readFileSync(join(root, 'contexts/PreferencesContext.tsx'), 'utf8');
const preferencesLibSource = readFileSync(join(root, 'lib/preferences.ts'), 'utf8');
const proContextSource = readFileSync(join(root, 'contexts/ProContext.tsx'), 'utf8');
const currencySource = readFileSync(join(root, 'lib/currency.ts'), 'utf8');
const iapSource = readFileSync(join(root, 'lib/iap.ts'), 'utf8');
const i18nSource = readFileSync(join(root, 'lib/i18n.ts'), 'utf8');
const meSource = readFileSync(join(root, 'app/(tabs)/me.tsx'), 'utf8');
const dealsSource = readFileSync(join(root, 'app/(tabs)/index.tsx'), 'utf8');
const tabsLayoutSource = readFileSync(join(root, 'app/(tabs)/_layout.tsx'), 'utf8');
const yearbookScreenSource = readFileSync(join(root, 'app/(tabs)/yearbook.tsx'), 'utf8');
const yearbookSource = readFileSync(join(root, 'lib/yearbook.ts'), 'utf8');
const catalogSource = readFileSync(join(root, 'lib/catalog.ts'), 'utf8');
const dealsFilterSource = readFileSync(join(root, 'lib/deals.ts'), 'utf8');
const productPreviewSource = readFileSync(join(root, 'lib/productPreview.ts'), 'utf8');
const supabaseSource = readFileSync(join(root, 'lib/supabase.ts'), 'utf8');
const privacySource = readFileSync(join(root, 'app/privacy.tsx'), 'utf8');
const dealCardSource = readFileSync(join(root, 'components/DealCard.tsx'), 'utf8');
const filterChipsSource = readFileSync(join(root, 'components/FilterChips.tsx'), 'utf8');
const controlRowSource = readFileSync(join(root, 'components/ControlRow.tsx'), 'utf8');
const filterSheetSource = readFileSync(join(root, 'components/FilterSheet.tsx'), 'utf8');
const watchlistSource = readFileSync(join(root, 'app/(tabs)/watchlist.tsx'), 'utf8');
const watchlistLibSource = readFileSync(join(root, 'lib/watchlist.ts'), 'utf8');
const productDetailSource = readFileSync(join(root, 'app/product/[skuId].tsx'), 'utf8');
const alertModalSource = readFileSync(join(root, 'components/AlertModal.tsx'), 'utf8');
const priceAlertsSource = readFileSync(join(root, 'lib/priceAlerts.ts'), 'utf8');
const liveDataVerifierSource = readFileSync(join(root, 'scripts/verify-live-data.ts'), 'utf8');
const notificationRouteSource = readFileSync(join(root, 'lib/notificationRoute.ts'), 'utf8');
const priceMonitorTaskSource = readFileSync(join(root, 'lib/priceMonitorTask.tsx'), 'utf8');
const paywallSource = readFileSync(join(root, 'app/paywall.tsx'), 'utf8');
const brandLogoSource = readFileSync(join(root, 'components/BrandLogo.tsx'), 'utf8');
const themeSource = readFileSync(join(root, 'lib/theme.ts'), 'utf8');
const topoSource = readFileSync(join(root, 'components/TopoPlaceholder.tsx'), 'utf8');
const defaultImageSource = readFileSync(join(root, 'components/DefaultImage.tsx'), 'utf8');
const expo = appConfig.expo;

assert.equal(expo.name, 'GearDrop');
assert.equal(expo.slug, 'geardrop');
assert.equal(expo.version, '1.2.0');
assert.equal(expo.scheme, 'geardrop');
assert.equal(expo.userInterfaceStyle, 'automatic');
assert.equal(expo.locales?.['zh-Hans']?.ios?.CFBundleDisplayName, '值de');
assert.equal(expo.locales?.['zh-Hans']?.ios?.CFBundleName, '值de');
assert.equal(expo.locales?.['zh-Hans']?.android?.app_name, '值de');
assert.equal(expo.ios?.bundleIdentifier, 'dev.100app.geardrop');
assert.equal(expo.ios?.supportsTablet, false, 'release candidate must remain iPhone-only until iPad UI and screenshots are verified');
assert.equal(expo.ios?.buildNumber, '12');
assert.equal(expo.ios?.config?.usesNonExemptEncryption, false);
assertNoTrademark(expo.name, 'expo.name');
assertNoTrademark(expo.slug, 'expo.slug');
assertNoTrademark(expo.scheme, 'expo.scheme');
assertNoTrademark(expo.ios?.bundleIdentifier || '', 'ios.bundleIdentifier');

for (const assetPath of [
  './assets/icon.png',
  './assets/splash-icon.png',
  './assets/favicon.png',
  './assets/android-icon-foreground.png',
  './assets/android-icon-background.png',
  './assets/android-icon-monochrome.png',
  './assets/brand/geardrop-logo.png',
  './assets/brand/geardrop-mark.png',
]) {
  assert.ok(existsSync(join(root, assetPath)), `missing asset ${assetPath}`);
}

const pluginNames = new Set((expo.plugins || []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin)));
for (const plugin of ['expo-router', 'expo-splash-screen', 'expo-notifications', 'expo-web-browser', 'expo-font', 'expo-image', 'expo-localization']) {
  assert.ok(pluginNames.has(plugin), `missing Expo plugin ${plugin}`);
}
const splashPlugin = (expo.plugins || []).find(
  (plugin): plugin is [string, Record<string, unknown>] => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
);
assert.ok(splashPlugin, 'missing configured Expo splash plugin');
assert.equal(splashPlugin[1].backgroundColor, '#F7F5EF');
assert.equal(splashPlugin[1].image, './assets/splash-icon.png');
assert.equal(splashPlugin[1].imageWidth, 280);
assert.equal(splashPlugin[1].resizeMode, 'contain');

for (const dependency of ['expo', 'expo-router', 'expo-splash-screen', '@supabase/supabase-js', '@react-native-async-storage/async-storage', 'expo-notifications', 'expo-image', 'expo-localization', 'react-native-svg', 'react-native-purchases']) {
  assert.ok(packageJson.dependencies[dependency], `missing dependency ${dependency}`);
}
assert.equal(
  packageJson.dependencies['react-native-reanimated'],
  '4.5.1',
  'Expo SDK 57 requires the bundled Reanimated version; an unbounded peer resolves to an incompatible Worklets API',
);
assert.equal(
  packageJson.dependencies['react-native-worklets'],
  '0.10.1',
  'Expo SDK 57 expo-modules-core requires Worklets 0.10.x with executeSync',
);

assert.equal(packageJson.main, 'expo-router/entry');
assert.equal(packageJson.version, '1.2.0');
assert.ok(packageJson.scripts.typecheck, 'missing typecheck script');
assert.ok(packageJson.scripts.doctor, 'missing doctor script');
assert.ok(packageJson.scripts.test, 'missing test script');
assert.ok(packageJson.scripts['verify:release-assets'], 'missing release asset verification script');
assert.ok(packageJson.scripts['verify:store-metadata'], 'missing App Store metadata verification script');
assert.ok(packageJson.scripts['verify:store-screenshots'], 'missing final App Store screenshot verification script');
assert.ok(packageJson.scripts['eas:build:ios'], 'missing EAS iOS build script');
assert.ok(packageJson.scripts['eas:submit:ios'], 'missing EAS iOS submit script');
assert.ok(easJson.build?.production, 'missing production build profile');
assert.ok(easJson.build?.simulator, 'missing simulator build profile');
assert.equal(easJson.cli?.appVersionSource, 'local', 'Build 12 must use the committed local version source');
assert.equal(easJson.build?.production?.autoIncrement, false, 'production build must not increment committed Build 12');
assert.ok(easJson.submit?.production?.ios, 'missing production iOS submit profile');
assert.equal(easJson.submit?.production?.ios?.ascAppId, '6790165332', 'production submit must target the GearDrop App Store Connect record');
assert.ok(existsSync(join(root, '..', 'privacy.html')), 'missing root privacy.html for App Store privacy policy URL');
assert.ok(existsSync(join(root, '..', 'support.html')), 'missing root support.html for App Store support URL');
assert.ok(metadata.includes('https://geardrop.100app.dev/privacy.html'), 'metadata missing privacy policy URL');
assert.ok(metadata.includes('https://geardrop.100app.dev/support.html'), 'metadata missing support URL');
assert.ok(!/Privacy Policy URL[\s\S]*?TODO/.test(metadata), 'metadata privacy policy URL still has TODO');
assert.ok(actionsSource.includes('WebBrowser.openBrowserAsync(url)'), 'Buy flow must stay wrapped by openBuyUrl');
assert.ok(actionsSource.includes("SUPPORT_URL = 'https://geardrop.100app.dev/support.html'"), 'app must use the dedicated public support URL');
assert.ok(actionsSource.includes('shouldShowBanner: true'), 'foreground local notifications must request banner display');
assert.ok(actionsSource.includes('IosAuthorizationStatus.AUTHORIZED'), 'iOS notification permission must use ios.status');
assert.ok(!meSource.includes("Alert.alert(ok ? 'Notification scheduled'"), 'sample notification success must not block the system banner with an app alert');
assert.ok(layoutSource.includes('Notifications.addNotificationResponseReceivedListener'), 'root layout must observe notification taps');
assert.ok(layoutSource.includes('Notifications.getLastNotificationResponse'), 'root layout must handle launch-from-notification');
assert.ok(layoutSource.includes('notificationRoute(notification.request.content.data)'), 'notification observer must validate notification data before routing');
assert.ok(layoutSource.includes('router.replace(destination)'), 'notification observer must route only to the validated destination');
assert.ok(layoutSource.includes('Notifications.clearLastNotificationResponse()'), 'notification observer must consume the handled response');
assert.ok(notificationRouteSource.includes("'/product/[skuId]'"), 'notification routes must preserve exact product identifiers');
assert.ok(notificationRouteSource.includes("data?.url === '/watchlist'"), 'notification routes must keep the Watchlist fallback');
assert.ok(layoutSource.includes('<PreferencesProvider>'), 'root layout must provide language and currency preferences');
assert.ok(layoutSource.includes('<PriceMonitorRegistration />'), 'root layout must register the 1.2 price monitor runtime');
assert.ok(priceMonitorTaskSource.includes('BackgroundTask.registerTaskAsync'), 'price monitor must register an iOS background task');
assert.ok(priceMonitorTaskSource.includes('Notifications.scheduleNotificationAsync'), 'price monitor must deliver due local alerts');
assert.ok(priceMonitorTaskSource.includes('trigger: null'), 'due local price notifications must be scheduled immediately after evaluation');
assert.ok(regionContextSource.includes("geardrop.region.v1"), 'global region state must persist across app restarts');
assert.ok(marketContextSource.includes('region, currency, setMarket'), 'MarketContext must expose the paired region and currency preference');
assert.ok(preferencesContextSource.includes("geardrop.preferences.v1"), 'language and currency preferences must persist across app restarts');
assert.ok(preferencesContextSource.includes("geardrop.currency-rates.v1"), 'currency rates must have an offline cache');
assert.ok(preferencesLibSource.includes('"all"'), 'preference migration must preserve the all-regions choice');
assert.ok(preferencesContextSource.includes('setPreferencesError(true)') && meSource.includes('p.retryPreferences()'), 'preference storage failures must expose a retry in Me');
assert.match(preferencesContextSource, /try\s*{[\s\S]*AsyncStorage\.getItem\(RATES_STORAGE_KEY\)[\s\S]*}\s*catch/, 'cached rate reads must handle storage failures');
assert.ok(!preferencesContextSource.includes('if (preferences.currency === "original")'), 'original-currency display must still load FX for cross-market sorting');
assert.ok(currencySource.includes('api.frankfurter.dev/v2/rates'), 'display conversion must use the configured reference-rate endpoint');
assert.ok(currencySource.includes("target === 'original'"), 'currency conversion must support original-price display');
assert.ok(i18nSource.includes("'zh-Hans'") && i18nSource.includes("'ja'"), 'translation catalog must include supported non-English languages');
assert.ok(dealsSource.includes('useMarket()'), 'Deals must consume the paired global market context');
assert.ok(!dealsSource.includes("region: 'us'"), 'Deals must not own a local default region filter');
assert.ok(dealsSource.includes('numColumns={2}'), 'Deals must render as a 2-column grid');
assert.ok(
  dealsSource.includes('keyboardShouldPersistTaps="handled"'),
  'Deals must let the first product tap through while the search keyboard is open',
);
assert.ok(dealsSource.includes('<MarketPill') && dealsSource.includes('<MarketSheet'), 'Deals market selector must use the title-bar pill and paired market sheet');
assert.ok(dealsSource.includes('await setMarket({ region: nextRegion, currency: nextCurrency })'), 'Deals market sheet must persist region and currency atomically');
assert.ok(dealsSource.includes('<BrandLogo'), 'Deals header must render the GearDrop logo');
assert.ok(privacySource.includes('<BrandLogo'), 'Privacy screen must render the GearDrop logo');
assert.ok(!dealsSource.includes('heroSection'), 'Deals must not keep the old single-row hero stream');
assert.ok(filterChipsSource.includes('<ControlRow'), 'Deals filters must use the shared ControlRow');
assert.ok(filterChipsSource.includes('<FilterSheet'), 'Deals filters must use the shared FilterSheet');
for (const section of ['brand', 'platform', 'category', 'gender', 'minDiscount', 'lowOnly']) {
  assert.ok(filterChipsSource.includes(`key: "${section}"`), `Deals FilterSheet must keep the ${section} section`);
}
assert.ok(yearbookScreenSource.includes('<ControlRow'), 'Yearbook filters must use the shared ControlRow');
assert.ok(yearbookScreenSource.includes('<FilterSheet'), 'Yearbook filters must use the shared FilterSheet');
assert.ok(controlRowSource.includes('minHeight: 44') && controlRowSource.includes('width: 44'), 'ControlRow actions must preserve 44pt targets');
assert.ok(
  filterSheetSource.includes('style={styles.scroll}') &&
    filterSheetSource.includes('contentContainerStyle={styles.content}'),
  'Filter sheet sections must scroll for localized and larger text',
);
assert.ok(filterSheetSource.includes('minHeight: 44') && filterSheetSource.includes('minWidth: 44'), 'FilterSheet chips must preserve 44pt targets');
assert.ok(tabsLayoutSource.includes('name="yearbook"') && tabsLayoutSource.includes("t('tabs.yearbook')"), 'tab layout must expose the localized Yearbook route');
assert.ok(yearbookScreenSource.includes('keyboardShouldPersistTaps="handled"'), 'Yearbook search must preserve first-tap navigation while the keyboard is open');
assert.ok(yearbookScreenSource.includes('fetchYearbookProducts()'), 'Yearbook screen must load the official catalog through the read-only client');
assert.ok(yearbookSource.includes("method = 'official_id'") && yearbookSource.includes("method = 'exact_name'"), 'Yearbook deals must use deterministic ID or unique exact-name matching');
assert.ok(yearbookSource.includes('if (candidates.length === 1)'), 'Yearbook must fail closed on ambiguous normalized-name matches');
assert.ok(catalogSource.includes("arcteryx: Object.freeze") || catalogSource.includes('BRANDS'), 'catalog must use the shared three-brand registry');
assert.ok(dealsFilterSource.includes("filters.brand !== 'all'"), 'Deals filtering must support product brand independently from source');
assert.ok(productPreviewSource.includes("geardrop.product-preview.v2"), 'multi-brand release must invalidate the single-brand preview cache');
assert.ok(supabaseSource.includes(".from('catalog_products')") && supabaseSource.includes(".eq('status', 'active')"), 'Yearbook client must read only active catalog rows');
assert.match(dealCardSource, /from ["']expo-image["']/, 'DealCard images must use expo-image');
assert.ok(dealCardSource.includes('aspectRatio: 4 / 5'), 'DealCard image slot must stay 4:5');
assert.ok(dealCardSource.includes('contentFit="cover"'), 'DealCard images must use cover fit');
assert.ok(dealCardSource.includes('lowRibbon') && dealCardSource.includes('regionBadge'), 'DealCard must overlay low/discount and region badges on the photo');
assert.ok(productDetailSource.includes("from 'expo-image'"), 'Product hero images must use expo-image');
assert.ok(productDetailSource.includes('aspectRatio: 4 / 5'), 'Product hero must stay 4:5');
assert.ok(watchlistSource.includes("from 'expo-image'"), 'Watchlist thumbnails must use expo-image');
assert.ok(watchlistSource.includes('aspectRatio: 4 / 5'), 'Watchlist thumbnails must stay 4:5');
assert.ok(themeSource.includes("photo: '#F1F0EC'"), 'theme must define the fixed light photo frame token');
assert.ok(themeSource.includes("onPhotoDisc: '#A6321F'"), 'theme must define fixed on-photo discount token');
assert.ok(topoSource.includes('<DefaultImage'), 'Topo placeholder must delegate to the shared category image');
assert.ok(defaultImageSource.includes('colors.photo') && defaultImageSource.includes('colors.photoTopo'), 'Default image must use fixed photo-frame tokens');
assert.ok(paywallSource.includes('PRO_FEATURES'), 'Paywall must render from a PRO_FEATURES data source');
assert.ok(paywallSource.includes('<BrandLogo markOnly'), 'Paywall must use the GearDrop mark');
assert.ok(brandLogoSource.includes('geardrop-logo.png') && brandLogoSource.includes('geardrop-mark.png'), 'BrandLogo must use the selected GearDrop assets');
for (const benefit of ['paywall.priceHistory', 'paywall.alerts', 'paywall.watchlist']) {
  assert.ok(paywallSource.includes(`title: "${benefit}"`), `Paywall must include shipped benefit ${benefit}`);
}
assert.ok(!paywallSource.includes('title: "paywall.lowSignal"'), 'Paywall must not market the free low-price signal as Pro-only');
assert.ok(i18nSource.includes("'paywall.priceHistory': '12-month price history'"), 'Paywall must state the 12-month Pro history window');
assert.ok(i18nSource.includes("'paywall.subtitle': 'Low-price signals, summaries, and filters stay free."), 'Paywall must keep signals, summaries, and filters on Free');
assert.ok(watchlistLibSource.includes('FREE_WATCHLIST_LIMIT = 20'), 'Free watchlist capacity must remain 20');
assert.ok(watchlistLibSource.includes('FREE_ALERT_LIMIT = 1'), 'Free active alert capacity must remain 1');
assert.ok(paywallSource.includes("t('paywall.title')"), 'Paywall must render the localized value proposition');
assert.ok(proContextSource.includes("import('react-native-purchases')"), 'Pro provider must load the RevenueCat native SDK');
assert.ok(proContextSource.includes('sdk.getOfferings()'), 'Pro provider must load StoreKit-backed offerings');
assert.ok(proContextSource.includes('loadProResources('), 'Pro provider must use the independently tested entitlement/offering loader');
assert.ok(proContextSource.includes('sdk.purchasePackage'), 'Pro provider must purchase the selected RevenueCat package');
assert.ok(proContextSource.includes('sdk.restorePurchases()'), 'Pro provider must expose user-triggered restore purchases');
assert.ok(proContextSource.includes('restoreProPurchase(') && paywallSource.includes('paywall.restoreFailed'), 'restore failures must use the tested outcome helper and distinct UI copy');
assert.ok(proContextSource.includes('sdk.presentCodeRedemptionSheet()'), 'Pro provider must use Apple offer-code redemption');
assert.ok(proContextSource.includes('sdk.addCustomerInfoUpdateListener(listener)'), 'Pro provider must auto-apply redeemed StoreKit entitlements');
assert.ok(proContextSource.includes('customerInfo.managementURL') && meSource.includes('APPLE_SUBSCRIPTIONS_URL'), 'active Pro users must have a real subscription-management destination');
assert.ok(proContextSource.includes('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'), 'Pro provider must use the configured public RevenueCat iOS SDK key');
assert.ok(iapSource.includes("PRO_ENTITLEMENT_ID = 'Pro'"), 'IAP contract must use the configured Pro entitlement');
assert.ok(iapSource.includes("intro.periodUnit === 'WEEK'") && iapSource.includes('intro.periodNumberOfUnits'), 'StoreKit weekly trials must use the structured period fields');
for (const productId of ['dev.100app.geardrop.pro.monthly', 'dev.100app.geardrop.pro.annual', 'dev.100app.geardrop.pro.lifetime']) {
  assert.ok(iapSource.includes(productId), `IAP contract missing product ${productId}`);
}
assert.ok(paywallSource.includes('plan.price'), 'Paywall must render StoreKit-localized prices');
assert.ok(paywallSource.includes('handleRestore'), 'Paywall must offer restore purchases');
assert.ok(paywallSource.includes('handleRedeemOfferCode') && paywallSource.includes("t('paywall.redeemCode')"), 'Paywall must expose Apple offer-code redemption');
assert.ok(paywallSource.includes('TERMS_URL') && paywallSource.includes('PRIVACY_URL'), 'Paywall must link terms and privacy');
assert.ok(!paywallSource.includes('setPro(true)'), 'Paywall must not grant Pro locally');
assert.ok(!meSource.includes('onValueChange={setPro}'), 'Me screen must not expose a local Pro toggle');
assert.ok(meSource.includes('openSupportUrl'), 'Me screen must expose the public support form');
assert.ok(meSource.includes('Constants.expoConfig?.version') && meSource.includes('Constants.expoConfig?.ios?.buildNumber'), 'Me must show the installed version and build');
for (const hardcodedPrice of ['$3.99', '$23.99', '$49.99']) {
  assert.ok(!paywallSource.includes(hardcodedPrice), `Paywall must not hardcode ${hardcodedPrice}`);
}
assert.ok(existsSync(join(root, '.env.example')), 'missing RevenueCat public SDK key example');
assert.ok(dealCardSource.includes('formatMoney(product.sale_price'), 'Deal cards must use display-currency formatting');
assert.ok(productDetailSource.includes('formatMoney(currentProduct.sale_price'), 'Product detail must use display-currency formatting');
assert.ok(watchlistSource.includes('formatMoney(product.sale_price'), 'Watchlist must use display-currency formatting');
assert.ok(productDetailSource.includes('<AlertModal'), 'Product detail must keep the original-currency alert modal');
assert.ok(alertModalSource.includes('<KeyboardAvoidingView'), 'Price alert modal must move above the on-screen keyboard');
assert.ok(
  alertModalSource.includes("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}"),
  'Price alert modal must define keyboard avoidance behavior on iOS and Android',
);
assert.ok(productDetailSource.includes('await insertPriceAlert'), 'Alert flow must write price_alerts');
assert.ok(productDetailSource.includes('buildPriceAlertRequest'), 'Alert flow must use the tested price alert request helper');
assert.ok(productDetailSource.includes("watchlist.saveAlertForSource"), 'Alert flow must persist item/model targets for the price monitor');
assert.ok(priceMonitorTaskSource.includes('evaluatePriceAlerts'), 'Price monitor must evaluate persisted target prices');
assert.ok(productDetailSource.includes('openBuyUrl(currentProduct.url)'), 'Buy button must use openBuyUrl');
assert.ok(priceAlertsSource.includes('/rest/v1/rpc/register_price_alert'), 'price alert helper must target the hardened registration RPC');
assert.ok(!priceAlertsSource.includes('/rest/v1/price_alerts'), 'native client must not write price_alerts directly');
assert.ok(!priceAlertsSource.includes('unsubscribe_token'), 'native client must not create unsubscribe tokens');
assert.ok(webProductDetail.includes('/rest/v1/rpc/register_price_alert'), 'website price alerts must use the hardened registration RPC');
assert.ok(!webProductDetail.includes('/rest/v1/price_alerts'), 'website must not write price_alerts directly');
assert.ok(supportPage.includes('/rest/v1/rpc/submit_support_request'), 'support page must use the validated support RPC');
assert.ok(supportPage.includes('p_website'), 'support page must include the abuse-control honeypot field');
assert.ok(liveDataVerifierSource.includes('PLATFORM_REGION_MIN_ROWS'), 'live data verification must gate every required platform/region slice');
assert.ok(liveDataVerifierSource.includes('YEARBOOK_BRAND_MIN_ROWS'), 'live data verification must gate every Yearbook brand independently');
assert.ok(!liveDataVerifierSource.includes('products.length >= 5000'), 'live data verification must not use a volatile aggregate catalog floor');

console.log(
  'config_ok name=GearDrop version=1.2.0 bundle=dev.100app.geardrop buildNumber=12 usesNonExemptEncryption=false privacyUrl=https://geardrop.100app.dev/privacy.html plugins=' +
    [...pluginNames].join(','),
);
