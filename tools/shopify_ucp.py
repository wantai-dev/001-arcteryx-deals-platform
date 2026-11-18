"""Small client for Shopify's Universal Commerce Protocol (UCP) catalog tools.

Shopify storefronts publish an agent-facing MCP endpoint through
``/.well-known/ucp``. Some stores throttle the legacy ``products.json`` routes
for crawler IPs while the UCP catalog tools stay available, so the Outlet and
dealer crawlers use this client for catalog identity, availability and prices.

Only read-only catalog tools are used (``search_catalog`` and
``lookup_catalog``); this module never creates carts or checkouts.
"""
from __future__ import annotations

import http.client
import json
import time
import urllib.error
import urllib.request
from typing import Callable, Iterable

DEFAULT_AGENT_PROFILE = (
    "https://shopify.dev/ucp/agent-profiles/examples/"
    "2026-04-08/valid-with-capabilities.json"
)
# UCP rejects lookup_catalog requests with more than 10 identifiers.
LOOKUP_BATCH_SIZE = 10
SEARCH_PAGE_SIZE = 50
TRANSIENT_STATUSES = {408, 429, 500, 502, 503, 504}
PRODUCT_GID_PREFIX = "gid://shopify/Product/"
VARIANT_GID_PREFIX = "gid://shopify/ProductVariant/"
# Every currency the crawlers request uses two minor-unit digits.
MINOR_UNIT_CURRENCIES = {"AUD", "CAD", "USD"}


class UcpError(RuntimeError):
    """The UCP endpoint returned an error or an unusable response."""


def product_gid(product_id: object) -> str:
    value = str(product_id or "").strip()
    if not value:
        raise ValueError("missing Shopify product id")
    return value if value.startswith(PRODUCT_GID_PREFIX) else PRODUCT_GID_PREFIX + value


def variant_gid(variant_id: object) -> str:
    value = str(variant_id or "").strip()
    if not value:
        raise ValueError("missing Shopify variant id")
    return value if value.startswith(VARIANT_GID_PREFIX) else VARIANT_GID_PREFIX + value


def numeric_product_id(gid: object) -> str:
    value = str(gid or "").strip()
    return value[len(PRODUCT_GID_PREFIX):] if value.startswith(PRODUCT_GID_PREFIX) else value


def money(value: object, currency: str) -> float | None:
    """Convert a UCP money object (integer minor units) to a decimal amount."""
    if not isinstance(value, dict):
        return None
    amount = value.get("amount")
    if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
        return None
    if value.get("currency") != currency:
        raise UcpError(f"unexpected UCP currency {value.get('currency')!r}; expected {currency!r}")
    if currency not in MINOR_UNIT_CURRENCIES:
        raise UcpError(f"unsupported UCP currency {currency!r}")
    return round(amount / 100, 2)


def variant_option(variant: dict, *needles: str) -> str:
    for option in variant.get("options") or []:
        name = str((option or {}).get("name") or "").lower()
        if any(needle in name for needle in needles):
            return str(option.get("label") or "").strip()
    return ""


def variant_available(variant: dict) -> bool:
    return (variant.get("availability") or {}).get("available") is True


def media_urls(media: object) -> list[str]:
    urls = []
    for item in media or []:
        if not isinstance(item, dict) or item.get("type") not in (None, "image"):
            continue
        url = str(item.get("url") or "").strip()
        if url and url not in urls:
            urls.append(url)
    return urls


class UcpCatalogClient:
    def __init__(
        self,
        endpoint: str,
        origin: str,
        *,
        context: dict,
        agent_profile: str = DEFAULT_AGENT_PROFILE,
        timeout: float = 45.0,
        attempts: int = 6,
        base_retry_delay: float = 30.0,
        request_pause: float = 1.0,
        max_total_wait: float = 600.0,
        opener: Callable = urllib.request.urlopen,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if attempts < 1:
            raise ValueError("attempts must be at least 1")
        self.endpoint = endpoint
        self.origin = origin.rstrip("/")
        self.context = dict(context)
        self.agent_profile = agent_profile
        self.timeout = timeout
        self.attempts = attempts
        self.base_retry_delay = base_retry_delay
        self.request_pause = request_pause
        self.max_total_wait = max_total_wait
        self._waited = 0.0
        self._opener = opener
        self._sleep = sleep
        self._calls = 0

    def _request(self, tool: str, catalog: dict) -> dict:
        body = json.dumps({
            "jsonrpc": "2.0",
            "id": f"{tool}-{time.time_ns()}",
            "method": "tools/call",
            "params": {
                "name": tool,
                "arguments": {
                    "meta": {"ucp-agent": {"profile": self.agent_profile}},
                    "catalog": catalog,
                },
            },
        }).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=body,
            method="POST",
            headers={
                "accept": "application/json",
                "content-type": "application/json",
                "origin": self.origin,
                "referer": self.origin + "/",
                "user-agent": "Mozilla/5.0",
            },
        )
        with self._opener(request, timeout=self.timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def call(self, tool: str, catalog: dict) -> dict:
        """Call one read-only catalog tool and return its structured content."""
        if self._calls and self.request_pause > 0:
            self._sleep(self.request_pause)
        self._calls += 1
        for attempt in range(1, self.attempts + 1):
            try:
                payload = self._request(tool, catalog)
                break
            except urllib.error.HTTPError as exc:
                if exc.code not in TRANSIENT_STATUSES or attempt == self.attempts:
                    raise UcpError(f"UCP {tool} HTTP {exc.code}") from exc
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    hinted = float(retry_after) if retry_after is not None else 0.0
                except ValueError:
                    hinted = 0.0
                # UCP throttles bursts and refills roughly two requests per
                # minute. Its Retry-After often says ~30 minutes even though a
                # request succeeds again within a minute, so only honor short
                # hints and otherwise back off 30s, 60s, 60s, ...
                backoff = min(60.0, self.base_retry_delay * attempt)
                delay = hinted if 0 < hinted <= backoff else backoff
            except (
                urllib.error.URLError,
                TimeoutError,
                ConnectionError,
                http.client.HTTPException,
                json.JSONDecodeError,
            ) as exc:
                # IncompleteRead/RemoteDisconnected (HTTPException) and resets
                # are transient transport failures, same as a URLError.
                if attempt == self.attempts:
                    raise UcpError(f"UCP {tool} failed: {exc}") from exc
                delay = min(60.0, self.base_retry_delay * attempt)
            if self._waited + delay > self.max_total_wait:
                raise UcpError(
                    f"UCP {tool} retry budget exhausted after {self._waited:.0f}s of backoff"
                )
            self._waited += delay
            self._sleep(delay)

        if not isinstance(payload, dict):
            raise UcpError(f"UCP {tool} response is not a JSON object")
        if payload.get("error"):
            raise UcpError(f"UCP {tool} JSON-RPC error: {str(payload['error'])[:200]}")
        result = payload.get("result")
        if not isinstance(result, dict):
            raise UcpError(f"UCP {tool} response has no result")
        if result.get("isError"):
            text = " ".join(
                str(part.get("text") or "")
                for part in result.get("content") or []
                if isinstance(part, dict)
            )
            raise UcpError(f"UCP {tool} tool error: {text[:200]}")
        content = result.get("structuredContent")
        if not isinstance(content, dict):
            raise UcpError(f"UCP {tool} result has no structured content")
        status = (content.get("ucp") or {}).get("status")
        if status not in (None, "success"):
            raise UcpError(f"UCP {tool} status is {status!r}")
        return content

    def search_all(
        self,
        query: str,
        *,
        page_size: int = SEARCH_PAGE_SIZE,
        max_pages: int,
    ) -> tuple[list[dict], bool]:
        """Return every product a search yields and whether pagination ended cleanly."""
        products: dict[str, dict] = {}
        cursor = None
        seen_cursors: set[str] = set()
        for _ in range(max_pages):
            pagination = {"limit": page_size}
            if cursor:
                pagination["cursor"] = cursor
            content = self.call("search_catalog", {
                "query": query,
                "context": self.context,
                "pagination": pagination,
            })
            for product in content.get("products") or []:
                product_id = str((product or {}).get("id") or "").strip()
                if not product_id:
                    raise UcpError("UCP search returned a product without an id")
                products[product_id] = product
            page = content.get("pagination") or {}
            if page.get("has_next_page") is not True:
                return list(products.values()), page.get("has_next_page") is False
            cursor = page.get("cursor")
            if not isinstance(cursor, str) or not cursor or cursor in seen_cursors:
                return list(products.values()), False
            seen_cursors.add(cursor)
        return list(products.values()), False

    def lookup(self, product_ids: Iterable[object]) -> dict[str, dict]:
        """Look products up by id; the result is keyed by numeric product id."""
        gids = list(dict.fromkeys(product_gid(value) for value in product_ids))
        found: dict[str, dict] = {}
        for start in range(0, len(gids), LOOKUP_BATCH_SIZE):
            batch = gids[start:start + LOOKUP_BATCH_SIZE]
            content = self.call("lookup_catalog", {"ids": batch, "context": self.context})
            for product in content.get("products") or []:
                gid = str((product or {}).get("id") or "")
                if gid in batch:
                    found[numeric_product_id(gid)] = product
        return found

    def lookup_variant_products(self, variant_ids: Iterable[object]) -> dict[str, str]:
        """Map variant ids to their numeric product ids.

        A variant lookup returns the parent product carrying only the matched
        variant, so callers needing every variant should then use ``lookup``.
        """
        gids = list(dict.fromkeys(variant_gid(value) for value in variant_ids))
        found: dict[str, str] = {}
        for start in range(0, len(gids), LOOKUP_BATCH_SIZE):
            batch = set(gids[start:start + LOOKUP_BATCH_SIZE])
            content = self.call("lookup_catalog", {"ids": sorted(batch), "context": self.context})
            for product in content.get("products") or []:
                product_id = numeric_product_id((product or {}).get("id"))
                for variant in product.get("variants") or []:
                    gid = str((variant or {}).get("id") or "")
                    if gid in batch and product_id:
                        found[gid[len(VARIANT_GID_PREFIX):]] = product_id
        return found
