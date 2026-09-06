import unittest
from unittest.mock import Mock

from tools.repair_product_categories import patch_category, plan_repairs


class CategoryRepairTests(unittest.TestCase):
    def test_plan_corrects_dealer_types_but_preserves_authoritative_outlet_categories(self):
        source = {"sku_id": "rei:1", "dealer": "rei", "category": "裤装", "full_name": "Capilene Cool Daily Short-Sleeve Shirt", "url": "https://www.rei.com/product/1/item"}
        rows = [source, {**source, "dealer": "arcteryx_outlet"}, {**source, "full_name": "Unknown model", "url": "https://www.rei.com/product/1/item"}]
        self.assertEqual(plan_repairs(rows), [{"before": source, "category": "上衣/T恤"}])
        self.assertEqual(source["category"], "裤装")

    def test_patch_only_writes_category_and_requires_unchanged_source_values(self):
        before = {"sku_id": "rei:1", "category": "裤装", "full_name": "Short Sleeve Shirt", "url": "https://example.com/1", "last_updated": "2026-09-06T00:00:00Z"}
        session = Mock()
        session.patch.return_value.json.return_value = [{**before, "category": "上衣/T恤"}]
        self.assertTrue(patch_category("https://example.com", "test", {"before": before, "category": "上衣/T恤"}, session=session))
        kwargs = session.patch.call_args.kwargs
        self.assertEqual(kwargs["json"], {"category": "上衣/T恤"})
        for field in ("category", "full_name", "url", "last_updated"):
            self.assertEqual(kwargs["params"][field], f"eq.{before[field]}")

    def test_concurrent_update_is_skipped_and_freshness_mutation_fails(self):
        repair = {"before": {"sku_id": "rei:1", "last_updated": "old"}, "category": "配件"}
        session = Mock()
        session.patch.return_value.json.return_value = []
        self.assertFalse(patch_category("https://example.com", "test", repair, session=session))
        session.patch.return_value.json.return_value = [{"sku_id": "rei:1", "category": "配件", "last_updated": "new"}]
        with self.assertRaisesRegex(ValueError, "freshness"):
            patch_category("https://example.com", "test", repair, session=session)


if __name__ == "__main__":
    unittest.main()
