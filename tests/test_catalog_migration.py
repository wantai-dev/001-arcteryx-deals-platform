import unittest
from pathlib import Path

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "supabase"
    / "migrations"
    / "20260812130000_three_brand_full_price_catalog.sql"
)


class CatalogMigrationGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_catalog_migration_does_not_touch_deals_tables_or_policies(self):
        self.assertNotIn("alter table public.products", self.sql)
        self.assertNotIn("alter table public.price_history", self.sql)
        self.assertNotIn("on public.products", self.sql)
        self.assertNotIn("on public.price_history", self.sql)

    def test_multi_brand_identity_and_full_price_scope_are_explicit(self):
        self.assertIn("catalog_product_id text primary key", self.sql)
        self.assertIn("brand_key in ('arcteryx', 'burton', 'patagonia')", self.sql)
        self.assertIn("unique (brand_key, official_product_id)", self.sql)
        self.assertIn("catalog_scope = 'full_price'", self.sql)
        self.assertIn("list_price_max", self.sql)

    def test_source_url_contracts_cover_only_official_domains(self):
        self.assertIn("https://arcteryx[.]com/us/en/shop/", self.sql)
        self.assertIn("https://www[.]burton[.]com/en-us/products/", self.sql)
        self.assertIn("https://www[.]patagonia[.]com[.]au/products/", self.sql)
        self.assertNotIn("backcountry", self.sql)
        self.assertNotIn("evo[.]com", self.sql)

    def test_catalog_tables_have_rls_and_public_read_only_grants(self):
        self.assertIn(
            "alter table public.catalog_products enable row level security", self.sql
        )
        self.assertIn(
            "alter table public.catalog_product_snapshots enable row level security",
            self.sql,
        )
        self.assertIn(
            "grant select on table public.catalog_products to anon, authenticated",
            self.sql,
        )
        self.assertNotIn(
            "grant insert on table public.catalog_products to anon", self.sql
        )

    def test_snapshots_are_append_only_for_service_role(self):
        self.assertIn(
            "grant select, insert on table public.catalog_product_snapshots to service_role",
            self.sql,
        )
        self.assertNotIn(
            "grant select, insert, update, delete on table public.catalog_product_snapshots to service_role",
            self.sql,
        )

    def test_rights_conscious_schema_excludes_content_and_images(self):
        for forbidden in ("description", "body_html", "image_url", "images json"):
            self.assertNotIn(forbidden, self.sql)


if __name__ == "__main__":
    unittest.main()


REGIONAL_MIGRATION = MIGRATION.with_name("20261117090000_arcteryx_regional_official_prices.sql")


class RegionalPriceMigrationGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = REGIONAL_MIGRATION.read_text(encoding="utf-8").lower()

    def test_regional_prices_hang_off_the_canonical_catalog_without_touching_it(self):
        self.assertIn("create table if not exists public.catalog_product_prices", self.sql)
        self.assertIn("references public.catalog_products (catalog_product_id)", self.sql)
        self.assertIn("primary key (catalog_product_id, country)", self.sql)
        self.assertNotIn("alter table public.catalog_products", self.sql)
        self.assertNotIn("public.products", self.sql)
        self.assertNotIn("public.price_history", self.sql)

    def test_country_currency_and_official_url_contracts_are_enforced(self):
        self.assertIn("brand_key = 'arcteryx'", self.sql)
        self.assertIn("country = 'gb' and currency = 'gbp'", self.sql)
        self.assertIn("currency = 'eur'", self.sql)
        self.assertIn("^https://arcteryx[.]com/' || country", self.sql)
        self.assertNotIn("'jp'", self.sql)

    def test_regional_prices_are_public_read_only(self):
        self.assertIn("alter table public.catalog_product_prices enable row level security", self.sql)
        self.assertIn("using (status = 'active')", self.sql)
        self.assertIn("grant select on table public.catalog_product_prices to anon, authenticated", self.sql)
        self.assertNotIn("grant insert on table public.catalog_product_prices to anon", self.sql)



AU_REGIONAL_MIGRATION = MIGRATION.with_name("20261118030000_arcteryx_au_regional_price.sql")


class AustraliaRegionalPriceMigrationGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = AU_REGIONAL_MIGRATION.read_text(encoding="utf-8").lower()

    def test_only_relaxes_the_regional_contracts_it_replaces(self):
        for name in (
            "catalog_product_prices_country_check",
            "catalog_product_prices_check1",
            "catalog_product_prices_check2",
            "catalog_product_prices_source_name_check",
            # Its own constraints too, so a re-run is idempotent.
            "catalog_product_prices_country_currency_check",
            "catalog_product_prices_source_check",
        ):
            self.assertIn(f"drop constraint if exists {name}", self.sql)
        self.assertNotIn("drop table", self.sql)
        self.assertNotIn("alter table public.catalog_products ", self.sql)
        self.assertNotIn("public.products", self.sql)
        self.assertNotIn("policy", self.sql)
        self.assertNotIn("grant", self.sql)

    def test_australia_is_bound_to_aud_its_ucp_source_and_store_urls(self):
        self.assertIn("'be', 'au')", self.sql)
        self.assertIn("country = 'au' and currency = 'aud'", self.sql)
        self.assertIn("source_name = 'arcteryx_au_shopify_ucp'", self.sql)
        self.assertIn("^https://arcteryx[.]com[.]au/products/", self.sql)
        # Feed countries keep the exact official feed source and shop URL contract.
        self.assertIn("country <> 'au'", self.sql)
        self.assertIn("source_name = 'arcteryx_official_product_feed'", self.sql)
        self.assertIn("^https://arcteryx[.]com/' || country || '/[a-z]{2}/shop/'", self.sql)
