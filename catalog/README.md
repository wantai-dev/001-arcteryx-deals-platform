# Official full-price catalog

This package builds the GearDrop Yearbook from current official, non-sale
styles. It is independent from the Deals `products` and `price_history` tables.

Official sources:

- Arc'teryx US: the brand's public `outdoor` product feed. The feed already
  represents the current mainline catalog; category feeds supply provenance.
- Burton US: `GET /en-us/collections/all/products.json`, documented by
  `https://www.burton.com/agents.md`. Only vendor `Burton` rows tagged
  `Current` are retained; `Anon`, `Outlet`, and `Future` rows are excluded.
- Patagonia AU: `GET /collections/all/products.json`, documented by
  `https://www.patagonia.com.au/agents.md`. Only rows tagged `flag:Order` are
  retained; sale rows are excluded. Australia is used because Patagonia's US
  storefront does not expose a dependable machine-readable response from the
  current crawler network.

Burton and Patagonia colour pages are grouped by their official `YGroup_` or
`group:` style number. A style stores the factual price range, colour names,
gender, official categories/tags, seasons, and one official product URL.
Descriptions, image URLs/files, and size-level inventory are deliberately not
stored.

## Local validation

Run all three official sources without writing anything:

```bash
python -m catalog.official_catalog --dry-run
```

Run a small, non-authoritative probe:

```bash
python -m catalog.official_catalog --brand burton --limit 5 --dry-run
python -m catalog.official_catalog --brand patagonia --product-id patagonia:37996 --dry-run
```

Partial and single-brand runs never age unseen products and cannot sync to
Supabase. Two complete authoritative misses are required before a style becomes
inactive.

## Supabase sync

Apply `supabase/migrations/20260812130000_three_brand_full_price_catalog.sql`,
set service-role `SUPABASE_URL` and `SUPABASE_KEY`, and explicitly add
`--sync-supabase`. A normal run never performs remote writes, and sync refuses
anything other than a complete three-brand run.

The `Refresh Official Yearbook Catalog` workflow runs this complete sync once a
day. It uses both GitHub concurrency and a Supabase crawler lease, has a bounded
runtime, and then reads the public table back with the anon credential. The
readback must contain exactly the active IDs from the authoritative run, meet
the per-brand minimums, and have `last_seen_at` at or after the run start. Any
collection, sync, or readback failure leaves the workflow failed; source
completeness failures occur before the first remote write.
