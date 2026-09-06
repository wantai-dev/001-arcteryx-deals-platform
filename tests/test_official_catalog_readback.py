import unittest
from datetime import datetime, timezone

from tools.check_official_catalog import CatalogReadbackError, verify_rows


def state(*, authoritative=True):
    products = []
    for brand, count in (("arcteryx", 2), ("burton", 2), ("patagonia", 2)):
        products.extend(
            {"catalog_product_id": f"{brand}:{index}", "status": "active"}
            for index in range(count)
        )
    return {
        "last_run": {
            "authoritative": authoritative,
            "complete_brands": ["arcteryx", "burton", "patagonia"],
        },
        "products": products,
    }


def rows():
    return [
        {
            "catalog_product_id": product["catalog_product_id"],
            "brand_key": product["catalog_product_id"].split(":", 1)[0],
            "status": "active",
            "last_seen_at": "2026-09-07T10:00:00+00:00",
        }
        for product in state()["products"]
    ]


class OfficialCatalogReadbackTests(unittest.TestCase):
    def setUp(self):
        self.after = datetime(2026, 9, 7, 9, 59, tzinfo=timezone.utc)
        self.minimums = {"arcteryx": 2, "burton": 2, "patagonia": 2}

    def test_accepts_exact_fresh_authoritative_readback(self):
        result = verify_rows(rows(), state(), after=self.after, minimums=self.minimums)
        self.assertEqual(result["rows"], 6)

    def test_rejects_missing_brand_row(self):
        with self.assertRaisesRegex(CatalogReadbackError, "public IDs differ"):
            verify_rows(rows()[:-1], state(), after=self.after, minimums=self.minimums)

    def test_rejects_stale_last_seen(self):
        observed = rows()
        observed[0]["last_seen_at"] = "2026-09-07T09:58:00+00:00"
        with self.assertRaisesRegex(CatalogReadbackError, "older than the sync"):
            verify_rows(observed, state(), after=self.after, minimums=self.minimums)

    def test_rejects_nonactive_public_row(self):
        observed = rows()
        observed[0]["status"] = "missing"
        with self.assertRaisesRegex(CatalogReadbackError, "non-active"):
            verify_rows(observed, state(), after=self.after, minimums=self.minimums)

    def test_rejects_non_authoritative_expected_state(self):
        with self.assertRaisesRegex(CatalogReadbackError, "not authoritative"):
            verify_rows(rows(), state(authoritative=False), after=self.after, minimums=self.minimums)


if __name__ == "__main__":
    unittest.main()
