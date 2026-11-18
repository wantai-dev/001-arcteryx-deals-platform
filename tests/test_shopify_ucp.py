import http.client
import json
import unittest
import urllib.error
from unittest.mock import MagicMock

from tools.shopify_ucp import (
    LOOKUP_BATCH_SIZE,
    UcpCatalogClient,
    UcpError,
    money,
    numeric_product_id,
    product_gid,
    variant_option,
)


def rpc_response(content=None, *, is_error=False, text=""):
    result = {"content": [{"type": "text", "text": text}], "isError": is_error}
    if content is not None:
        result["structuredContent"] = content
    response = MagicMock()
    response.__enter__.return_value = response
    response.read.return_value = json.dumps({"jsonrpc": "2.0", "id": "x", "result": result}).encode()
    return response


def http_error(status, retry_after=None):
    headers = {"Retry-After": retry_after} if retry_after is not None else {}
    return urllib.error.HTTPError("https://shop.example/api/ucp/mcp", status, "error", headers, None)


def product(product_id):
    return {"id": f"gid://shopify/Product/{product_id}", "title": f"Product {product_id}"}


class ShopifyUcpTests(unittest.TestCase):
    def client(self, responses, **kwargs):
        opener = MagicMock(side_effect=responses)
        sleep = MagicMock()
        client = UcpCatalogClient(
            "https://shop.example/api/ucp/mcp",
            "https://shop.example",
            context={"address_country": "US", "language": "en-US", "currency": "USD"},
            opener=opener,
            sleep=sleep,
            **kwargs,
        )
        return client, opener, sleep

    def sent_catalog(self, opener, call_index):
        request = opener.call_args_list[call_index].args[0]
        body = json.loads(request.data)
        self.assertEqual(body["method"], "tools/call")
        return body["params"]["name"], body["params"]["arguments"]["catalog"]

    def test_money_uses_integer_minor_units_and_checks_currency(self):
        self.assertEqual(money({"amount": 82000, "currency": "AUD"}, "AUD"), 820.0)
        self.assertEqual(money({"amount": 31197, "currency": "USD"}, "USD"), 311.97)
        self.assertIsNone(money({"amount": 0, "currency": "AUD"}, "AUD"))
        self.assertIsNone(money(None, "AUD"))
        with self.assertRaises(UcpError):
            money({"amount": 100, "currency": "USD"}, "AUD")

    def test_product_id_round_trip(self):
        self.assertEqual(product_gid("123"), "gid://shopify/Product/123")
        self.assertEqual(product_gid("gid://shopify/Product/123"), "gid://shopify/Product/123")
        self.assertEqual(numeric_product_id("gid://shopify/Product/123"), "123")

    def test_variant_option_reads_labels_by_name(self):
        variant = {"options": [{"name": "Colour", "label": "Black"}, {"name": "Size", "label": "M"}]}
        self.assertEqual(variant_option(variant, "colour", "color"), "Black")
        self.assertEqual(variant_option(variant, "size"), "M")
        self.assertEqual(variant_option(variant, "length"), "")

    def test_search_all_follows_cursors_until_terminal_page(self):
        client, opener, sleep = self.client([
            rpc_response({"products": [product(1), product(2)], "pagination": {"has_next_page": True, "cursor": "c1"}}),
            rpc_response({"products": [product(3)], "pagination": {"has_next_page": False}}),
        ])

        products, complete = client.search_all("", max_pages=5)

        self.assertTrue(complete)
        self.assertEqual([p["id"] for p in products], [product(i)["id"] for i in (1, 2, 3)])
        tool, catalog = self.sent_catalog(opener, 1)
        self.assertEqual(tool, "search_catalog")
        self.assertEqual(catalog["pagination"], {"limit": 50, "cursor": "c1"})
        sleep.assert_called_once_with(1.0)

    def test_search_all_is_incomplete_without_terminal_page(self):
        for pages in (
            [{"has_next_page": True}],
            [{"has_next_page": True, "cursor": "c1"}, {"has_next_page": True, "cursor": "c1"}],
            [{}],
        ):
            with self.subTest(pages=pages):
                client, _, _ = self.client([rpc_response({"products": [product(1)], "pagination": page}) for page in pages])
                _, complete = client.search_all("", max_pages=5)
                self.assertFalse(complete)

    def test_search_all_stops_at_page_limit(self):
        client, opener, _ = self.client([
            rpc_response({"products": [product(i)], "pagination": {"has_next_page": True, "cursor": f"c{i}"}})
            for i in range(3)
        ])
        products, complete = client.search_all("", max_pages=3)
        self.assertFalse(complete)
        self.assertEqual(len(products), 3)
        self.assertEqual(opener.call_count, 3)

    def test_lookup_batches_ids_and_keys_by_numeric_id(self):
        ids = [str(i) for i in range(LOOKUP_BATCH_SIZE + 2)]
        client, opener, _ = self.client([
            rpc_response({"products": [product(i) for i in ids[:LOOKUP_BATCH_SIZE]]}),
            rpc_response({"products": [product(ids[-2])]}),
        ])

        found = client.lookup(ids)

        self.assertEqual(opener.call_count, 2)
        _, first = self.sent_catalog(opener, 0)
        _, second = self.sent_catalog(opener, 1)
        self.assertEqual(len(first["ids"]), LOOKUP_BATCH_SIZE)
        self.assertEqual(second["ids"], [product_gid(ids[-2]), product_gid(ids[-1])])
        self.assertEqual(set(found), set(ids[:-1]))

    def test_lookup_variant_products_maps_variant_to_product(self):
        client, opener, _ = self.client([
            rpc_response({"products": [{
                "id": "gid://shopify/Product/9100998246657",
                "variants": [{"id": "gid://shopify/ProductVariant/48278067937537"}],
            }]}),
        ])

        found = client.lookup_variant_products(["48278067937537", "999"])

        _, catalog = self.sent_catalog(opener, 0)
        self.assertEqual(sorted(catalog["ids"]), [
            "gid://shopify/ProductVariant/48278067937537",
            "gid://shopify/ProductVariant/999",
        ])
        self.assertEqual(found, {"48278067937537": "9100998246657"})

    def test_tool_error_raises(self):
        client, _, _ = self.client([rpc_response(is_error=True, text="Invalid arguments")])
        with self.assertRaisesRegex(UcpError, "Invalid arguments"):
            client.call("lookup_catalog", {"ids": ["gid://shopify/Product/1"]})

    def test_non_success_ucp_status_raises(self):
        client, _, _ = self.client([rpc_response({"ucp": {"status": "error"}, "products": []})])
        with self.assertRaises(UcpError):
            client.call("search_catalog", {"query": ""})

    def test_truncated_body_and_reset_connection_are_retried(self):
        client, opener, sleep = self.client([
            http.client.IncompleteRead(b"partial"),
            ConnectionResetError("reset by peer"),
            rpc_response({"products": [], "pagination": {"has_next_page": False}}),
        ])
        self.assertEqual(client.call("search_catalog", {"query": ""}), {"products": [], "pagination": {"has_next_page": False}})
        self.assertEqual(opener.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_repeated_truncated_body_raises_ucp_error(self):
        client, _, _ = self.client([http.client.IncompleteRead(b"x")] * 2, attempts=2)
        with self.assertRaises(UcpError):
            client.call("search_catalog", {"query": ""})

    def test_transient_http_error_retries_with_retry_after(self):
        client, opener, sleep = self.client([
            http_error(429, retry_after="7"),
            rpc_response({"products": [], "pagination": {"has_next_page": False}}),
        ])
        self.assertEqual(client.call("search_catalog", {"query": ""})["products"], [])
        self.assertEqual(opener.call_count, 2)
        sleep.assert_called_once_with(7.0)

    def test_unreliable_long_retry_after_uses_bounded_backoff(self):
        client, opener, sleep = self.client([
            http_error(429, retry_after="2197"),
            rpc_response({"products": [], "pagination": {"has_next_page": False}}),
        ])
        self.assertEqual(client.call("search_catalog", {"query": ""})["products"], [])
        self.assertEqual(opener.call_count, 2)
        sleep.assert_called_once_with(30.0)

    def test_retry_budget_is_shared_across_calls(self):
        client, _, sleep = self.client([http_error(429)] * 6, max_total_wait=100)
        with self.assertRaisesRegex(UcpError, "retry budget exhausted"):
            client.call("search_catalog", {"query": ""})
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [30.0, 60.0])

    def test_persistent_or_permanent_http_error_raises(self):
        client, opener, _ = self.client([http_error(429)] * 6)
        with self.assertRaisesRegex(UcpError, "HTTP 429"):
            client.call("search_catalog", {"query": ""})
        self.assertEqual(opener.call_count, 6)

        client, opener, _ = self.client([http_error(403)])
        with self.assertRaisesRegex(UcpError, "HTTP 403"):
            client.call("search_catalog", {"query": ""})
        self.assertEqual(opener.call_count, 1)


if __name__ == "__main__":
    unittest.main()
