import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from dealers import merge_partial, supabase_sync
from dealers.rei import Scraper


def list_html(start, count):
    return "".join(
        f'<a href="/product/{pid}/arcteryx-test-{pid}">'
        f'<img alt="Arc\'teryx Test Jacket {pid}"></a>'
        '<span data-ui="regular-price">$100.00</span>'
        for pid in range(start, start + count)
    )


class ReiCompletenessTests(unittest.TestCase):
    def scrape_pages(self, bodies, *, first_nav_error=False):
        scraper = Scraper()
        urls = [scraper.BASE_LIST_URL] + [
            f"{scraper.BASE_LIST_URL}&page={i}"
            for i in range(2, len(bodies) + 1)
        ]
        page = MagicMock()
        current_body = ""

        def goto(url, **_kwargs):
            nonlocal current_body
            if url not in urls:
                return
            index = urls.index(url)
            if index == 0 and first_nav_error:
                raise RuntimeError("offline navigation failure")
            current_body = bodies[index]

        def content():
            if isinstance(current_body, Exception):
                raise current_body
            return current_body

        page.goto.side_effect = goto
        page.content.side_effect = content
        with patch.dict("os.environ", {
            "REI_LIST_WAIT_SECONDS": "1", "REI_ENRICH_DETAILS": "0",
        }, clear=True), patch("dealers.rei.Camoufox") as camoufox, patch(
            "dealers.rei.time.sleep"
        ), patch.object(scraper, "list_urls", return_value=urls):
            camoufox.return_value.__enter__.return_value.new_page.return_value = page
            items = scraper.scrape()
        return scraper, items, page

    def merge_and_sync(self, scraper, items):
        previous = {
            "name": "REI", "region": "US", "count": 155,
            "items": [{"url": f"old-rei-{i}"} for i in range(155)],
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            partial_dir = root / "partial"
            partial_dir.mkdir()
            results = root / "results.json"
            results.write_text(json.dumps({"dealers": {"rei": previous}}))
            (partial_dir / "rei.json").write_text(json.dumps({
                "name": "REI", "region": "US", "count": len(items),
                "items": items, "crawl_complete": scraper.crawl_complete,
                "saved_at": "2026-11-07 00:00:00",
            }))
            with patch.object(merge_partial, "PARTIAL_DIR", str(partial_dir)), patch.object(
                merge_partial, "OUT", str(results)
            ):
                merge_partial.main()
            merged = json.loads(results.read_text())
            with patch.object(supabase_sync, "RESULTS_FILE", results), patch.object(
                supabase_sync, "SUPABASE_KEY", "offline-test-placeholder"
            ), patch("supabase.create_client") as create_client:
                client = create_client.return_value
                client.table.return_value.select.return_value.eq.return_value.range.return_value.execute.return_value.data = []
                supabase_sync.main()
        return previous, merged, client

    def test_empty_first_page_then_pages_2_to_13_stays_incomplete(self):
        bodies = [""] + [list_html(1000 + i * 12, 12) for i in range(11)]
        bodies += [list_html(2000, 5), ""]
        scraper, items, _ = self.scrape_pages(bodies)
        self.assertEqual(len(items), 137)
        self.assertFalse(scraper.crawl_complete)

    def test_first_page_failures_cannot_be_overridden_by_later_success(self):
        for name, first, nav_error in (
            ("empty", "", False),
            ("too few", list_html(1000, Scraper.MIN_LIST_ITEMS - 1), False),
            ("duplicate IDs", list_html(1000, 1) * Scraper.MIN_LIST_ITEMS, False),
            ("content error", RuntimeError("offline content failure"), False),
            ("navigation error", "", True),
        ):
            with self.subTest(name=name):
                scraper, items, _ = self.scrape_pages(
                    [first, list_html(2000, 10), ""], first_nav_error=nav_error
                )
                self.assertGreaterEqual(len(items), 10)
                self.assertFalse(scraper.crawl_complete)

    def test_incomplete_snapshot_retains_history_and_never_calls_database(self):
        scraper, items, _ = self.scrape_pages(["", list_html(2000, 137), ""])
        previous, merged, client = self.merge_and_sync(scraper, items)
        self.assertEqual(merged["dealers"]["rei"], previous)
        self.assertEqual(merged["fresh_dealers"], [])
        self.assertEqual(merged["rejected_dealers"], {"rei": "incomplete"})
        client.table.assert_not_called()

    def test_complete_snapshot_with_small_last_page_can_sync(self):
        scraper, items, _ = self.scrape_pages(
            [list_html(1000, 100), list_html(2000, 34), list_html(3000, 3), ""]
        )
        self.assertTrue(scraper.crawl_complete)
        _, merged, client = self.merge_and_sync(scraper, items)
        self.assertEqual(merged["fresh_dealers"], ["rei"])
        self.assertEqual(merged["rejected_dealers"], {})
        self.assertEqual(merged["dealers"]["rei"]["items"], items)
        upserts = client.table.return_value.upsert.call_args_list
        self.assertEqual(sum(len(call.args[0]) for call in upserts), len(items))
        client.table.return_value.upsert.return_value.execute.assert_called()

    def test_normal_terminal_pages_do_not_invalidate_first_page(self):
        first = list_html(1000, Scraper.MIN_LIST_ITEMS)
        extra = list_html(3000, 10)
        for name, tail, expected_count, goto_count in (
            ("configured limit", [], 10, 2),
            ("empty terminal page", ["", extra], 10, 3),
            ("duplicate terminal page", [first, extra], 10, 3),
            ("small last page", [list_html(2000, 3), "", extra], 13, 4),
        ):
            with self.subTest(name=name):
                scraper, items, page = self.scrape_pages([first] + tail)
                self.assertTrue(scraper.crawl_complete)
                self.assertEqual(len(items), expected_count)
                self.assertEqual(page.goto.call_count, goto_count)

    def test_empty_crawl_is_incomplete(self):
        scraper, items, _ = self.scrape_pages(["", ""])
        self.assertEqual(items, [])
        self.assertFalse(scraper.crawl_complete)


if __name__ == "__main__":
    unittest.main()
