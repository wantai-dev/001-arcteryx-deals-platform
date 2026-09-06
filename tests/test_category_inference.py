import unittest

from dealers.supabase_sync import item_to_row
from supabase_sync import infer_category


class CategoryInferenceTests(unittest.TestCase):
    def assert_category(self, expected, name, slug=None):
        url = f"https://www.example.com/{slug or name.lower().replace(' ', '-')}"
        self.assertEqual(infer_category(name, url), expected)

    def test_real_products_are_not_captured_by_broad_substrings(self):
        cases = (
            ("上衣/T恤", "Colfax Short-Sleeve T-Shirt", "burton-colfax-short-sleeve-t-shirt"),
            ("配件", "Recycled DND Beanie - 3-Pack - Kids'", "burton-recycled-dnd-beanie-kids-3-pack"),
            ("配件", "Weekend Midweight Sock - 2-Pack - Kids'", "burton-weekend-midweight-sock-2-pack-kids"),
            ("裤装", "Patagonia Insulated Storm Shift Pants - Women's", "patagonia-insulated-storm-shift-pants-women-s"),
        )
        for expected, name, slug in cases:
            with self.subTest(name=name):
                self.assert_category(expected, name, slug)

    def test_specific_product_types_win_over_material_or_sport_words(self):
        cases = (
            ("裤装", "Men's Insulated Snowboard Pants"),
            ("裤装", "Arc'teryx Rho Boot Cut Bottoms - Women's"),
            ("鞋类", "Women's Insulated Snowboard Boots"),
            ("配件", "Insulated Snowboard Gloves"),
            ("配件", "Logo Trucker Cap"),
            ("上衣/T恤", "Organic Cotton T-Shirt 3 Pack"),
            ("上衣/T恤", "Capilene Cool Daily T-Shirt"),
            ("排汗内衣", "Merino Boxer Brief 3-Pack"),
        )
        for expected, name in cases:
            with self.subTest(name=name):
                self.assert_category(expected, name)

    def test_core_categories_remain_recognized(self):
        cases = (
            ("裤装", "Gamma Lightweight Shorts"),
            ("背包", "Mantis 26 Backpack"),
            ("背包", "Black Hole Pack 32L"),
            ("背包", "Norvan 7 Vest Hydration Pack"),
            ("保暖夹克", "Cerium Down Jacket"),
            ("硬壳冲锋衣", "Beta Hardshell Jacket"),
            ("鞋类", "Aerios Hiking Shoe"),
            ("滑雪板", "Burton Custom Snowboard"),
            ("固定器", "Step On Re:Flex Snowboard Binding"),
        )
        for expected, name in cases:
            with self.subTest(name=name):
                self.assert_category(expected, name)

    def test_dealer_rows_use_shared_category_inference(self):
        row = item_to_row(
            {
                "name": "Patagonia Insulated Storm Shift Pants - Women's",
                "url": "https://www.evo.com/products/patagonia-insulated-storm-shift-pants-women-s",
                "brand": "patagonia",
                "sale_price": 199,
                "original_price": 299,
                "currency": "USD",
                "region": "us",
            },
            "evo",
            "2026-09-07 00:00:00",
        )
        self.assertEqual(row["category"], "裤装")


if __name__ == "__main__":
    unittest.main()
