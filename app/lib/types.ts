export type ProductRow = {
  id: number;
  sku_id: string | null;
  brand: string | null;
  model: string | null;
  full_name: string | null;
  color: string | null;
  sizes: string[] | string | null;
  size_stock: Record<string, string> | string | null;
  original_price: number | string | null;
  sale_price: number | string | null;
  discount_pct: number | string | null;
  currency: string | null;
  symbol: string | null;
  gender: string | null;
  region: string | null;
  region_name: string | null;
  category: string | null;
  url: string | null;
  image_url: string | null;
  images: string[] | string | null;
  description: string | null;
  status?: 'active' | 'missing' | 'inactive' | 'unavailable' | null;
  last_seen_at?: string | null;
  missing_runs?: number | null;
  url_http_status?: number | null;
  url_checked_at?: string | null;
  last_updated: string | null;
  created_at: string | null;
  dealer: string | null;
  first_seen: string | null;
  official_product_id?: string | null;
};

export type GearBrand = 'arcteryx' | 'burton' | 'patagonia';

export type Product = Omit<ProductRow, 'brand' | 'sku_id' | 'sizes' | 'size_stock' | 'images' | 'original_price' | 'sale_price' | 'discount_pct' | 'symbol' | 'currency' | 'region'> & {
  brand: GearBrand;
  sku_id: string;
  sizes: string[];
  size_stock: Record<string, string>;
  images: string[];
  original_price: number;
  sale_price: number;
  discount_pct: number;
  symbol: string;
  currency: string;
  region: string;
  official_product_id?: string | null;
  _brand: GearBrand;
  _series: string;
  _platform: string;
};

export type PriceHistoryRow = {
  sku_id?: string | null;
  sale_price: number | string | null;
  original_price: number | string | null;
  currency?: string | null;
  recorded_at: string | null;
};

export type ChartPoint = {
  day: string;
  sale: number;
  original: number;
};

export type SignalKind = 'all_time_low' | 'ninety_day_low' | 'drop_today' | 'steady' | 'insufficient';

export type DealSignal = {
  kind: SignalKind;
  label: string;
  tone: 'success' | 'neutral';
  verdict: string;
  isLow: boolean;
  minPrice: number | null;
  pointCount: number;
  dropAmount?: number;
};

export type WatchEntry = {
  skuId: string;
  savedAt: string;
  savedPrice: number;
  symbol: string;
  alertTarget?: number;
  id?: string;
  scope?: 'sku' | 'model';
  modelKey?: string;
  snapshot?: WatchProductSnapshot;
  savedMoney?: MoneyAmount;
  alert?: LocalPriceAlert;
};

export type MoneyAmount = {
  amount: number;
  currency: string;
};

export type WatchProductSnapshot = {
  skuId?: string;
  brand: GearBrand;
  name: string;
  model?: string;
  gender?: string;
  category?: string;
  officialProductId?: string;
  currency: string;
  symbol: string;
  price: number;
  imageUrl?: string;
  sourceUrl?: string;
};

export type AlertMode = 'percent10' | 'historicalLow' | 'custom';

export type LocalPriceAlert = {
  mode: AlertMode;
  targetAmount: number;
  targetCurrency: string;
  localEnabled: boolean;
  email?: string;
  armed: boolean;
  rearmAbove: number;
  lastTriggeredAt?: string;
  lastTriggeredPrice?: number;
};

export type PriceAlertRequest = {
  email: string;
  sku_id: string;
  target_price: number | null;
};

export type CatalogBrandKey = GearBrand;
export type CatalogGender = 'men' | 'women' | 'kids' | 'unisex';

export type CatalogProductRow = {
  catalog_product_id: string | null;
  brand_key: string | null;
  official_product_id: string | null;
  brand: string | null;
  catalog_scope: string | null;
  market: string | null;
  country: string | null;
  language: string | null;
  name: string | null;
  gender: string | null;
  collection: string | null;
  categories: string[] | string | null;
  category_sources: Record<string, string> | string | null;
  list_price: number | string | null;
  list_price_max: number | string | null;
  currency: string | null;
  color_names: string[] | string | null;
  primary_colors: string[] | string | null;
  season_codes: string[] | string | null;
  source_name: string | null;
  source_url: string | null;
  source_hash: string | null;
  status: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_changed_at: string | null;
};

export type CatalogProduct = {
  catalog_product_id: string;
  brand_key: CatalogBrandKey;
  official_product_id: string;
  brand: string;
  catalog_scope: 'full_price';
  market: string;
  country: string;
  language: 'en';
  name: string;
  gender: CatalogGender;
  collection: string | null;
  categories: string[];
  category_sources: Record<string, string>;
  list_price: number;
  list_price_max: number;
  currency: string;
  color_names: string[];
  primary_colors: string[];
  season_codes: string[];
  source_name: string;
  source_url: string;
  source_hash: string;
  status: 'active';
  first_seen_at: string;
  last_seen_at: string;
  last_changed_at: string;
};
