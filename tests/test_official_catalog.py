import contextlib
import copy
import http.client
import io
import json
import unittest
from dataclasses import replace

from catalog.official_catalog import (
    BRAND_KEYS,
    SHOPIFY_SOURCES,
    CatalogClient,
    CatalogSourceError,
    collect_shopify_catalog,
    empty_state,
    merge_catalog_state,
    normalize_arcteryx_product,
    normalize_shopify_style,
    sync_to_supabase,
)


def arcteryx_raw(**overrides):
    row = {
        "sku": "X000010934",
        "name": "Alpha SV Bib Pant Men's",
        "gender": "men",
        "collection": "Alpha",
        "price": 750,
        "currencyCode": "USD",
        "url": "us/en/shop/mens/alpha-sv-bib-pant-0934",
        "description": "not archived",
        "mainImage": {"pathname": "/images/F26/alpha.jpg"},
        "colourOptions": {
            "options": [
                {
                    "primaryColour": "Black",
                    "image": {
                        "colourLabel": "Black",
                        "url": "https://images.example/F26/alpha.jpg",
                    },
                }
            ]
        },
    }
    row.update(overrides)
    return row


def shopify_row(
    *,
    shopify_id,
    vendor,
    title,
    handle,
    product_type,
    tags,
    color,
    price,
    compare_at_price=None,
    sku="STYLE-COLOR-M",
    available=True,
):
    return {
        "id": shopify_id,
        "vendor": vendor,
        "title": title,
        "handle": handle,
        "product_type": product_type,
        "tags": tags,
        "body_html": "<p>not archived</p>",
        "images": [{"src": "https://cdn.example/not-archived.jpg"}],
        "options": [
            {"name": "Color", "position": 1, "values": [color]},
            {"name": "Size", "position": 2, "values": ["M"]},
        ],
        "variants": [
            {
                "id": shopify_id * 10,
                "sku": sku,
                "title": f"{color} / M",
                "price": str(price),
                "compare_at_price": (
                    None if compare_at_price is None else str(compare_at_price)
                ),
                "available": available,
            }
        ],
    }


def tiny_source(brand):
    return replace(
        SHOPIFY_SOURCES[brand],
        min_raw_rows=1,
        max_raw_rows=20,
        min_full_price_rows=1,
        max_full_price_rows=20,
        min_styles=1,
        max_styles=20,
    )


class FakeShopifyClient:
    def __init__(self, pages):
        self.pages = pages

    def fetch_shopify_page(self, source, page):
        return copy.deepcopy(self.pages.get((source.brand_key, page), []))


class OfficialCatalogTests(unittest.TestCase):
    def test_transient_remote_disconnect_is_retried_and_normalized(self):
        attempts = 0

        def disconnected(*_args, **_kwargs):
            nonlocal attempts
            attempts += 1
            raise http.client.RemoteDisconnected("closed")

        client = CatalogClient(
            delay=0,
            retries=2,
            timeout=1,
            opener=disconnected,
            sleep=lambda _seconds: None,
        )

        with self.assertRaisesRegex(CatalogSourceError, "failed after 2 attempts"):
            client.fetch_feed("mens")
        self.assertEqual(attempts, 2)

    def test_arcteryx_normalization_is_factual_and_ignores_description_and_images(self):
        first = normalize_arcteryx_product(
            arcteryx_raw(), ["shell-jackets"], {"shell-jackets": "official_category_feed"}
        )
        changed_protected_content = arcteryx_raw(
            description="changed",
            mainImage={"pathname": "/images/F26/different.jpg"},
        )
        second = normalize_arcteryx_product(
            changed_protected_content,
            ["shell-jackets"],
            {"shell-jackets": "official_category_feed"},
        )

        self.assertEqual(first["catalog_product_id"], "arcteryx:x000010934")
        self.assertEqual(first["list_price"], 750)
        self.assertEqual(first["season_codes"], ["F26"])
        self.assertEqual(first["source_hash"], second["source_hash"])
        serialized = json.dumps(first)
        for forbidden in ("description", "body_html", "image", "inventory"):
            self.assertNotIn(forbidden, serialized)

    def test_burton_collects_current_brand_styles_and_excludes_outlet_and_anon(self):
        current = shopify_row(
            shopify_id=1,
            vendor="Burton",
            title="Men's Burton Custom Camber Snowboard",
            handle="mens-burton-custom-camber-snowboard-106881",
            product_type="BOARDS",
            tags=["Base_Product", "Current", "YGroup_106881"],
            color="Graphic",
            price="699.95",
            sku="106881-156",
        )
        outlet = shopify_row(
            shopify_id=2,
            vendor="Burton",
            title="Burton Outlet Board",
            handle="burton-outlet-board-200000-o",
            product_type="BOARDS",
            tags=["Base_Product", "Outlet", "YGroup_200000"],
            color="Graphic",
            price="399.95",
        )
        anon = shopify_row(
            shopify_id=3,
            vendor="Anon",
            title="Anon Goggles",
            handle="anon-goggles-300000",
            product_type="GOGGLES",
            tags=["Base_Product", "Current", "YGroup_300000"],
            color="Black",
            price="199.95",
        )
        client = FakeShopifyClient({("burton", 1): [current, outlet, anon]})

        products, complete = collect_shopify_catalog(
            client, tiny_source("burton")
        )

        self.assertTrue(complete)
        self.assertEqual(len(products), 1)
        product = products[0]
        self.assertEqual(product["catalog_product_id"], "burton:106881")
        self.assertEqual(product["gender"], "men")
        self.assertEqual(product["categories"], ["boards"])
        self.assertEqual(product["currency"], "USD")
        self.assertEqual(
            product["source_url"],
            "https://www.burton.com/en-us/products/mens-burton-custom-camber-snowboard-106881",
        )

    def _burton_row(self, shopify_id, handle, tags, sku, title="Burton Board"):
        return shopify_row(
            shopify_id=shopify_id,
            vendor="Burton",
            title=title,
            handle=handle,
            product_type="BOARDS",
            tags=tags,
            color="Graphic",
            price="649.95",
            sku=sku,
        )

    def test_burton_recovers_missing_ygroup_from_handle_and_skus_and_skips_donation(self):
        tagged = self._burton_row(
            1, "mens-burton-custom-camber-snowboard-106881",
            ["Base_Product", "Current", "YGroup_106881"], "106881-156",
        )
        untagged = self._burton_row(
            2, "burton-pretty-good-company-camber-snowboard-311751",
            ["Base_Product", "Current", "Wholesale"], "3117511E0ORG135",
            title="Burton Pretty Good Company Camber Snowboard",
        )
        donation = self._burton_row(
            3, "chill-foundation-donation", ["Current"], "DONATION",
            title="CHILL Foundation Donation",
        )
        client = FakeShopifyClient({("burton", 1): [tagged, untagged, donation]})

        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            products, complete = collect_shopify_catalog(
                client, tiny_source("burton")
            )

        self.assertTrue(complete)
        self.assertEqual(
            [product["catalog_product_id"] for product in products],
            ["burton:106881", "burton:311751"],
        )
        self.assertIn("skipped 1 full-price rows", stderr.getvalue())
        self.assertIn("CHILL Foundation Donation", stderr.getvalue())

    def test_burton_does_not_recover_style_when_skus_disagree_with_handle(self):
        tagged = self._burton_row(
            1, "mens-burton-custom-camber-snowboard-106881",
            ["Current", "YGroup_106881"], "106881-156",
        )
        mismatched = self._burton_row(
            2, "burton-mystery-board-311751", ["Current"], "999999-156",
        )
        client = FakeShopifyClient({("burton", 1): [tagged, mismatched]})

        with contextlib.redirect_stderr(io.StringIO()):
            products, _complete = collect_shopify_catalog(
                client, tiny_source("burton")
            )

        self.assertEqual(
            [product["catalog_product_id"] for product in products],
            ["burton:106881"],
        )

    def test_burton_fails_when_unidentifiable_rows_exceed_allowance(self):
        tagged = self._burton_row(
            1, "mens-burton-custom-camber-snowboard-106881",
            ["Current", "YGroup_106881"], "106881-156",
        )
        first = self._burton_row(2, "gift-card", ["Current"], "GIFT")
        second = self._burton_row(3, "donation", ["Current"], "DONATE")
        client = FakeShopifyClient({("burton", 1): [tagged, first, second]})

        with self.assertRaisesRegex(
            CatalogSourceError, "2 full-price rows without a provable style ID"
        ):
            collect_shopify_catalog(client, tiny_source("burton"))

    def test_patagonia_rows_without_style_tags_still_fail(self):
        row = shopify_row(
            shopify_id=1,
            vendor="Patagonia",
            title="Untagged Jacket",
            handle="untagged-jacket-123456",
            product_type="Jackets",
            tags=["flag:Order"],
            color="Black",
            price="299.00",
            sku="123456-BLK-M",
        )
        client = FakeShopifyClient({("patagonia", 1): [row]})

        with self.assertRaisesRegex(CatalogSourceError, "invalid style IDs"):
            collect_shopify_catalog(client, tiny_source("patagonia"))

    def test_patagonia_groups_colour_pages_by_official_style_and_uses_regular_price(self):
        green = shopify_row(
            shopify_id=10,
            vendor="Patagonia",
            title="Airfarer Cap",
            handle="airfarer-cap-37996-plws",
            product_type="Non-Apparel, Hats",
            tags=[
                "flag:Order",
                "group:37996",
                "gender:Gender-Neutral",
                "gender:Men's",
                "gender:Women's",
                "colour:Green",
                "season:W26",
                "type:Headwear",
                "subtype:Caps",
            ],
            color="P-6 Logo: Weathered Stone",
            price="49.95",
            sku="37996-PLWS-ALL",
        )
        black = shopify_row(
            shopify_id=11,
            vendor="Patagonia",
            title="Airfarer Cap",
            handle="airfarer-cap-37996-stbk",
            product_type="Headwear,Front Bill Hats",
            tags=[
                "flag:Order",
                "group:37996",
                "gender:Gender-Neutral",
                "colour:Black",
                "season:W26",
                "type:Headwear",
                "subtype:Caps",
            ],
            color="Strata Stencil: Black",
            price="54.95",
            sku="37996-STBK-ALL",
            available=False,
        )
        sale = shopify_row(
            shopify_id=12,
            vendor="Patagonia",
            title="Sale Cap",
            handle="sale-cap-99999-red",
            product_type="Headwear",
            tags=["flag:Sale", "sale:Yes", "group:99999"],
            color="Red",
            price="20.00",
            compare_at_price="40.00",
        )
        client = FakeShopifyClient({("patagonia", 1): [green, black, sale]})

        products, complete = collect_shopify_catalog(
            client, tiny_source("patagonia")
        )

        self.assertTrue(complete)
        self.assertEqual(len(products), 1)
        product = products[0]
        self.assertEqual(product["catalog_product_id"], "patagonia:37996")
        self.assertEqual(product["gender"], "unisex")
        self.assertEqual(product["list_price"], 49.95)
        self.assertEqual(product["list_price_max"], 54.95)
        self.assertEqual(product["currency"], "AUD")
        self.assertEqual(
            product["color_names"],
            ["P-6 Logo: Weathered Stone", "Strata Stencil: Black"],
        )
        self.assertIn("headwear", product["categories"])
        self.assertEqual(product["season_codes"], ["W26"])
        for forbidden in ("body_html", "images", "variants"):
            self.assertNotIn(forbidden, product)

    def test_patagonia_ignores_non_identifier_group_labels_when_ygroup_is_stable(self):
        magazine = shopify_row(
            shopify_id=13,
            vendor="Patagonia",
            title="Roaring Journals Magazine - Edition One",
            handle="roaring-journals-magazine-edition-one-roaring-journals-edition-1",
            product_type="Unclassified",
            tags=[
                "flag:Order",
                "group:Roaring Journals",
                "YGroup_RJ",
                "YGroup_Roaring Journals",
            ],
            color="Miscellaneous",
            price="0.00",
            sku="Roaring Journals - Edition 1-Free",
        )
        client = FakeShopifyClient({("patagonia", 1): [magazine]})

        products, _ = collect_shopify_catalog(client, tiny_source("patagonia"))

        self.assertEqual(products[0]["catalog_product_id"], "patagonia:rj")

    def test_style_name_uses_deterministic_official_majority_across_colour_pages(self):
        rows = []
        for shopify_id, title, color in (
            (14, "Men's Synchilla® Fleece Pants", "Natural"),
            (15, "Men's Synchilla® Pants", "Green"),
            (16, "Men's Synchilla® Pants", "Black"),
        ):
            rows.append(
                shopify_row(
                    shopify_id=shopify_id,
                    vendor="Patagonia",
                    title=title,
                    handle=f"synchilla-pants-21665-{color.lower()}",
                    product_type="Pants",
                    tags=["flag:Order", "group:21665", "gender:Men's", "season:W26"],
                    color=color,
                    price="199.95",
                )
            )

        first = normalize_shopify_style(tiny_source("patagonia"), "21665", rows)
        second = normalize_shopify_style(
            tiny_source("patagonia"), "21665", list(reversed(rows))
        )

        self.assertEqual(first["name"], "Men's Synchilla® Pants")
        self.assertEqual(first["source_url"], second["source_url"])
        self.assertEqual(first["source_hash"], second["source_hash"])

    def test_shopify_hash_ignores_protected_content(self):
        source = tiny_source("burton")
        raw = shopify_row(
            shopify_id=20,
            vendor="Burton",
            title="Burton Test Board",
            handle="burton-test-board-123456",
            product_type="BOARDS",
            tags=["Current", "YGroup_123456"],
            color="Graphic",
            price="500",
        )
        changed = copy.deepcopy(raw)
        changed["body_html"] = "completely different"
        changed["images"] = [{"src": "https://different.example/image.jpg"}]

        first = normalize_shopify_style(source, "123456", [raw])
        second = normalize_shopify_style(source, "123456", [changed])

        self.assertEqual(first["source_hash"], second["source_hash"])

    def test_pagination_duplicate_fails_closed(self):
        row = shopify_row(
            shopify_id=30,
            vendor="Burton",
            title="Burton Duplicate",
            handle="burton-duplicate-654321",
            product_type="BOARDS",
            tags=["Current", "YGroup_654321"],
            color="Graphic",
            price="600",
        )
        client = FakeShopifyClient({("burton", 1): [row, copy.deepcopy(row)]})

        with self.assertRaisesRegex(CatalogSourceError, "duplicate"):
            collect_shopify_catalog(client, tiny_source("burton"))

    def test_snapshots_are_idempotent_and_brand_ids_do_not_collide(self):
        burton = normalize_shopify_style(
            tiny_source("burton"),
            "37996",
            [
                shopify_row(
                    shopify_id=40,
                    vendor="Burton",
                    title="Burton Style 37996",
                    handle="burton-style-37996",
                    product_type="APPAREL",
                    tags=["Current", "YGroup_37996"],
                    color="Black",
                    price="80",
                )
            ],
        )
        patagonia = normalize_shopify_style(
            tiny_source("patagonia"),
            "37996",
            [
                shopify_row(
                    shopify_id=41,
                    vendor="Patagonia",
                    title="Patagonia Style 37996",
                    handle="patagonia-style-37996-black",
                    product_type="Tops",
                    tags=["flag:Order", "group:37996", "gender:Gender-Neutral"],
                    color="Black",
                    price="90",
                )
            ],
        )
        observed_at = "2026-08-12T00:00:00+00:00"
        first, first_snapshots = merge_catalog_state(
            empty_state(),
            [burton, patagonia],
            observed_at=observed_at,
            requested_brands=BRAND_KEYS,
            complete_brands=set(BRAND_KEYS),
        )
        second, second_snapshots = merge_catalog_state(
            first,
            [burton, patagonia],
            observed_at="2026-08-13T00:00:00+00:00",
            requested_brands=BRAND_KEYS,
            complete_brands=set(BRAND_KEYS),
        )

        self.assertEqual(len(first["products"]), 2)
        self.assertEqual(len(first_snapshots), 2)
        self.assertEqual(second_snapshots, [])
        self.assertEqual(len(second["snapshots"]), 2)
        self.assertTrue(first["last_run"]["authoritative"])

    def test_only_completed_brand_ages_and_two_misses_deactivate(self):
        burton = normalize_shopify_style(
            tiny_source("burton"),
            "123456",
            [
                shopify_row(
                    shopify_id=50,
                    vendor="Burton",
                    title="Burton Test",
                    handle="burton-test-123456",
                    product_type="BOARDS",
                    tags=["Current", "YGroup_123456"],
                    color="Graphic",
                    price="500",
                )
            ],
        )
        patagonia = normalize_shopify_style(
            tiny_source("patagonia"),
            "123456",
            [
                shopify_row(
                    shopify_id=51,
                    vendor="Patagonia",
                    title="Patagonia Test",
                    handle="patagonia-test-123456-blue",
                    product_type="Jackets",
                    tags=["flag:Order", "group:123456", "gender:Women's"],
                    color="Blue",
                    price="300",
                )
            ],
        )
        state, _ = merge_catalog_state(
            empty_state(),
            [burton, patagonia],
            observed_at="2026-08-10T00:00:00+00:00",
            requested_brands=BRAND_KEYS,
            complete_brands=set(BRAND_KEYS),
        )
        once, _ = merge_catalog_state(
            state,
            [patagonia],
            observed_at="2026-08-11T00:00:00+00:00",
            requested_brands=BRAND_KEYS,
            complete_brands={"burton"},
        )
        twice, _ = merge_catalog_state(
            once,
            [patagonia],
            observed_at="2026-08-12T00:00:00+00:00",
            requested_brands=BRAND_KEYS,
            complete_brands={"burton"},
        )
        rows = {row["catalog_product_id"]: row for row in twice["products"]}

        self.assertEqual(rows["burton:123456"]["status"], "inactive")
        self.assertEqual(rows["burton:123456"]["missing_runs"], 2)
        self.assertEqual(rows["patagonia:123456"]["status"], "active")
        self.assertEqual(rows["patagonia:123456"]["missing_runs"], 0)

    def test_partial_run_does_not_age_unseen_products(self):
        product = normalize_arcteryx_product(arcteryx_raw(), ["pants"])
        state, _ = merge_catalog_state(
            empty_state(),
            [product],
            observed_at="2026-08-10T00:00:00+00:00",
            requested_brands=("arcteryx",),
            complete_brands={"arcteryx"},
        )
        partial, _ = merge_catalog_state(
            state,
            [],
            observed_at="2026-08-11T00:00:00+00:00",
            requested_brands=("arcteryx",),
            complete_brands=set(),
        )

        self.assertEqual(partial["products"][0]["status"], "active")
        self.assertEqual(partial["products"][0]["missing_runs"], 0)

    def test_remote_sync_refuses_non_authoritative_runs_before_credentials(self):
        state = empty_state()
        state["last_run"] = {"authoritative": False}

        with self.assertRaisesRegex(CatalogSourceError, "three-brand"):
            sync_to_supabase(state, [], authoritative=False)


if __name__ == "__main__":
    unittest.main()
