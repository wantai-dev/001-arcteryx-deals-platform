-- Australia joins the Arc'teryx regional official prices.
-- arcteryx.com.au is a Shopify store outside the official product feed, so its
-- rows come from the store's UCP catalog with their own source name and product
-- URL shape. Every other country keeps its existing feed contract unchanged.

alter table public.catalog_product_prices
  drop constraint if exists catalog_product_prices_country_check,
  drop constraint if exists catalog_product_prices_check1,
  drop constraint if exists catalog_product_prices_check2,
  drop constraint if exists catalog_product_prices_source_name_check,
  drop constraint if exists catalog_product_prices_country_currency_check,
  drop constraint if exists catalog_product_prices_source_check;

alter table public.catalog_product_prices
  add constraint catalog_product_prices_country_check
    check (country in ('us', 'ca', 'gb', 'de', 'fr', 'nl', 'fi', 'ie', 'se', 'at', 'ch', 'it', 'es', 'dk', 'be', 'au')),
  add constraint catalog_product_prices_country_currency_check
    check (
      (country = 'us' and currency = 'USD')
      or (country = 'ca' and currency = 'CAD')
      or (country = 'gb' and currency = 'GBP')
      or (country = 'se' and currency = 'SEK')
      or (country = 'ch' and currency = 'CHF')
      or (country = 'dk' and currency = 'DKK')
      or (country = 'au' and currency = 'AUD')
      or (country in ('de', 'fr', 'nl', 'fi', 'ie', 'at', 'it', 'es', 'be') and currency = 'EUR')
    ),
  add constraint catalog_product_prices_source_check
    check (
      (
        country <> 'au'
        and source_name = 'arcteryx_official_product_feed'
        and source_url ~ ('^https://arcteryx[.]com/' || country || '/[a-z]{2}/shop/')
      )
      or (
        country = 'au'
        and source_name = 'arcteryx_au_shopify_ucp'
        and source_url ~ '^https://arcteryx[.]com[.]au/products/[a-z0-9][a-z0-9-]*$'
      )
    );
