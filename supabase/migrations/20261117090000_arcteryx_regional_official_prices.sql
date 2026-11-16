-- Arc'teryx official full-price list prices per Outlet country for the Yearbook.
-- catalog_products keeps its US canonical row; this table adds one row per
-- (product, country) from the same official product feed. Deals tables are untouched.

create table if not exists public.catalog_product_prices (
  catalog_product_id text not null
    references public.catalog_products (catalog_product_id) on delete restrict,
  country text not null
    check (country in ('us', 'ca', 'gb', 'de', 'fr', 'nl', 'fi', 'ie', 'se', 'at', 'ch', 'it', 'es', 'dk', 'be')),
  brand_key text not null default 'arcteryx' check (brand_key = 'arcteryx'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  list_price numeric(12, 2) not null check (list_price >= 0),
  list_price_max numeric(12, 2) not null check (list_price_max >= list_price),
  source_name text not null check (source_name = 'arcteryx_official_product_feed'),
  source_url text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active'
    check (status in ('active', 'missing', 'inactive')),
  missing_runs integer not null default 0 check (missing_runs >= 0),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_changed_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (catalog_product_id, country),
  check (catalog_product_id ~ '^arcteryx:[a-z0-9][a-z0-9._-]{1,63}$'),
  check (
    (country = 'us' and currency = 'USD')
    or (country = 'ca' and currency = 'CAD')
    or (country = 'gb' and currency = 'GBP')
    or (country = 'se' and currency = 'SEK')
    or (country = 'ch' and currency = 'CHF')
    or (country = 'dk' and currency = 'DKK')
    or (country in ('de', 'fr', 'nl', 'fi', 'ie', 'at', 'it', 'es', 'be') and currency = 'EUR')
  ),
  check (source_url ~ ('^https://arcteryx[.]com/' || country || '/[a-z]{2}/shop/')),
  check (last_seen_at >= first_seen_at),
  check (last_changed_at >= first_seen_at)
);

create index if not exists catalog_product_prices_country_status_idx
  on public.catalog_product_prices (country, status, last_seen_at desc);

alter table public.catalog_product_prices enable row level security;

drop policy if exists catalog_prices_public_read_active on public.catalog_product_prices;
create policy catalog_prices_public_read_active
  on public.catalog_product_prices for select
  to anon, authenticated
  using (status = 'active');

revoke all on table public.catalog_product_prices from public, anon, authenticated;
grant select on table public.catalog_product_prices to anon, authenticated;
grant select, insert, update, delete on table public.catalog_product_prices to service_role;
