"""Burton official Outlet scraper using rendered, dynamically discounted prices.

The rendered Outlet collection is the listing of record: it carries the live,
discounted price pair and the collection total. Shopify UCP supplies each
card's product id, availability and sizes: an Outlet ``search_catalog`` matched
by exact handle first, then ``lookup_catalog`` by known product id or by the
card's swatch variant ids. UCP omits products with nothing purchasable, so a
card it cannot resolve is accepted only after its product page confirms every
variant is sold out.

Burton's legacy ``products.json`` route answers 429 to crawler IPs (observed
from Lightsail and OCI since 2026-11-12) while UCP stays available. UCP prices
are pre-discount, so they are never used as the sale price.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
import urllib.request
from pathlib import Path

from tools.shopify_ucp import (
    UcpCatalogClient,
    UcpError,
    numeric_product_id,
    variant_available,
    variant_option,
)

from .base import discount_pct, normalize_price


HOST = "https://www.burton.com"
COLLECTION_URL = f"{HOST}/en-us/collections/outlet"
RENDERED_PAGE_SIZE = 24
UCP_ENDPOINT = "https://burton-na-production.myshopify.com/api/ucp/mcp"
UCP_CONTEXT = {"address_country": "US", "language": "en-US", "currency": "USD"}
OUTLET_SEARCH_QUERY = "outlet"
OUTLET_SEARCH_MAX_PAGES = 12
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
# Hydrated before every crawl (server wrapper and GitHub fallback alike).
PREVIOUS_RESULTS = Path("dealers/results.json")
_VARIANT_DATA_RE = re.compile(
    r'<script[^>]*data-product-options-el="variant-data"[^>]*>(.*?)</script>',
    re.S,
)


class Scraper:
    KEY = "burton"
    NAME = "Burton"
    REGION = "US"
    BRAND = "burton"
    MIN_ITEMS = 100
    MAX_PAGES = 20

    def __init__(self, ucp_client: UcpCatalogClient | None = None, previous_results: Path = PREVIOUS_RESULTS):
        self.crawl_complete = False
        self._ucp_client = ucp_client
        self._previous_results = previous_results
        self._pdp_pause = max(0, int(os.environ.get("BURTON_PDP_DELAY_MS", "1000"))) / 1000

    @property
    def ucp_client(self) -> UcpCatalogClient:
        if self._ucp_client is None:
            self._ucp_client = UcpCatalogClient(UCP_ENDPOINT, HOST, context=UCP_CONTEXT)
        return self._ucp_client

    @staticmethod
    def _resolved_gender(name: str) -> str:
        lowered = name.lower().replace("’", "'")
        if "women's" in lowered or "womens" in lowered:
            return "women"
        if "men's" in lowered or "mens" in lowered:
            return "men"
        return "unisex"

    @staticmethod
    def _is_burton_product(product: dict) -> bool:
        # UCP exposes no vendor field. Every Burton-brand Outlet product title
        # carries "Burton" (245/245 on 2026-11-12), while other house brands
        # sold on burton.com (e.g. Anon) do not.
        return "burton" in str(product.get("title") or "").lower()

    @staticmethod
    def _image_url(value: object) -> str | None:
        image = str(value or "").strip()
        if not image:
            return None
        if image.startswith("//"):
            return "https:" + image
        if image.startswith("/"):
            return HOST + image
        return image

    def _known_product_ids(self) -> dict[str, str]:
        """Product URL -> numeric product id from the previous published snapshot."""
        try:
            data = json.loads(self._previous_results.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        dealer = (data.get("dealers") or {}).get(self.KEY) if isinstance(data, dict) else None
        items = dealer.get("items") if isinstance(dealer, dict) else dealer
        known = {}
        for item in items or []:
            if not isinstance(item, dict):
                continue
            source_id = str(item.get("source_id") or "").strip()
            source_id = source_id.split(":", 1)[1] if source_id.startswith(f"{self.KEY}:") else source_id
            url = str(item.get("url") or "").strip()
            if source_id.isdigit() and url.startswith(HOST + "/en-us/products/"):
                known[url] = source_id
        return known

    def _resolve_cards(self, cards: list[dict]) -> tuple[dict[int, str], dict[str, dict]]:
        """Map card index -> product id and return the full UCP products.

        Resolution order keeps the UCP request count low: one paginated
        Outlet search matched by exact handle, then known product ids from the
        previous snapshot, then swatch variant ids for whatever remains.
        """
        product_by_card: dict[int, str] = {}
        products_by_id: dict[str, dict] = {}

        def card_handle(card: dict) -> str:
            return str(card.get("url") or "").rsplit("/", 1)[-1]

        # One search returns 50 full products per request, so it resolves most
        # Outlet cards in a handful of calls. UCP enforces a small hourly quota
        # (Retry-After ~30 minutes once exceeded), which rules out resolving
        # ~300 cards ten ids at a time on every run.
        searched, _ = self.ucp_client.search_all(OUTLET_SEARCH_QUERY, max_pages=OUTLET_SEARCH_MAX_PAGES)
        by_handle = {str(product.get("handle") or ""): product for product in searched}
        for index, card in enumerate(cards):
            product = by_handle.get(card_handle(card))
            if product is not None:
                product_id = numeric_product_id(product.get("id"))
                products_by_id[product_id] = product
                product_by_card[index] = product_id

        known = self._known_product_ids()
        known_cards = {
            index: known[HOST + str(card.get("url") or "")]
            for index, card in enumerate(cards)
            if index not in product_by_card and HOST + str(card.get("url") or "") in known
        }
        if known_cards:
            products_by_id.update(self._lookup_catalog_products(list(dict.fromkeys(known_cards.values()))))
            for index, product_id in known_cards.items():
                product = products_by_id.get(product_id)
                # A recycled URL must still point at the same product.
                if product and str(product.get("handle") or "") == card_handle(cards[index]):
                    product_by_card[index] = product_id

        rest = [index for index in range(len(cards)) if index not in product_by_card]
        if rest:
            resolved = self._resolve_card_products([cards[index] for index in rest])
            for position, product_id in resolved.items():
                product_by_card[rest[position]] = product_id
            needed = list(dict.fromkeys(pid for pid in resolved.values() if pid not in products_by_id))
            if needed:
                products_by_id.update(self._lookup_catalog_products(needed))
        return product_by_card, products_by_id

    def _resolve_card_products(self, cards: list[dict]) -> dict[int, str]:
        """Map card index -> numeric product id through any of the card's swatch variants.

        UCP only returns purchasable variants, so a card whose first swatch is
        sold out is retried with its other swatches.
        """
        product_by_card: dict[int, str] = {}
        pending = list(range(len(cards)))
        depth = 0
        while pending:
            candidates = {}
            for index in pending:
                variant_ids = [str(value) for value in cards[index].get("variant_ids") or [] if value]
                if not variant_ids and cards[index].get("variant_id"):
                    variant_ids = [str(cards[index]["variant_id"])]
                if depth < len(variant_ids):
                    candidates[index] = variant_ids[depth]
            if not candidates:
                break
            found = self.ucp_client.lookup_variant_products(candidates.values())
            for index, variant_id in candidates.items():
                if variant_id in found:
                    product_by_card[index] = found[variant_id]
            pending = [index for index in candidates if index not in product_by_card]
            depth += 1
        return product_by_card

    def _product_page_sold_out(self, path: object) -> bool | None:
        """True when the product page lists variants and none is available."""
        path = str(path or "").strip()
        if not path.startswith("/en-us/products/"):
            return None
        request = urllib.request.Request(HOST + path, headers={"User-Agent": _UA, "Accept": "text/html"})
        for attempt in range(1, 4):
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    html = response.read().decode("utf-8", "replace")
                break
            except Exception as exc:
                if attempt == 3:
                    print(f"[burton] product page fetch failed for {path}: {str(exc)[:120]}", flush=True)
                    return None
                time.sleep(5 * attempt)
        if self._pdp_pause:
            time.sleep(self._pdp_pause)
        match = _VARIANT_DATA_RE.search(html)
        if not match:
            return None
        try:
            data = json.loads(match.group(1))
        except ValueError:
            return None
        variants = data if isinstance(data, list) else (data or {}).get("variants") or []
        if not variants:
            return None
        return not any(isinstance(variant, dict) and variant.get("available") is True for variant in variants)

    def _lookup_catalog_products(self, source_ids: list[str]) -> dict[str, dict]:
        """Resolve rendered product ids through UCP, keyed by numeric product id."""
        return self.ucp_client.lookup(source_ids)

    def parse_rendered_cards(self, cards: list[dict], products_by_id: dict[str, dict]) -> list[dict]:
        items = []
        for card in cards:
            source_id = str(card.get("source_id") or "").strip()
            product = products_by_id.get(source_id)
            if product is None:
                raise ValueError(f"rendered Burton product is absent from catalog: {source_id!r}")
            if not self._is_burton_product(product):
                continue

            available = [variant for variant in product.get("variants") or [] if variant_available(variant)]
            if not available:
                continue
            path = str(card.get("url") or "").strip()
            if not path.startswith("/en-us/products/"):
                raise ValueError(f"unexpected Burton product URL: {path!r}")
            sale = normalize_price(card.get("sale_text"))
            original = normalize_price(card.get("original_text"))
            if not card.get("sale_text") and not card.get("original_text"):
                if normalize_price(card.get("price_text")):
                    # A full-price card renders one plain price.
                    continue
                raise ValueError(f"rendered Burton card has no price for {source_id}")
            if not sale or not original:
                # Full-price cards render a single price without a sale pair.
                continue
            if original <= sale + 0.01:
                continue

            name = str(card.get("name") or product.get("title") or "").strip()
            colors = []
            for value in card.get("colors") or []:
                color = str(value or "").strip()
                if color and color not in colors:
                    colors.append(color)
            sizes = sorted({
                value
                for variant in available
                if (value := variant_option(variant, "size"))
            }, key=lambda value: (len(value), value))
            items.append({
                "source_id": source_id,
                "url": HOST + path,
                "name": name,
                "image": self._image_url(card.get("image")),
                "original_price": original,
                "sale_price": sale,
                "currency": "USD",
                "in_stock": True,
                "gender": self._resolved_gender(name),
                "sizes": sizes,
                "size_stock": {size: "in_stock" for size in sizes},
                "color": ", ".join(colors[:3]),
                "colors": colors,
                "discount_pct": discount_pct(original, sale),
                "dealer": self.KEY,
                "dealer_name": self.NAME,
                "brand": self.BRAND,
                "region": self.REGION,
                # UCP has no product_type; sync infers the category from name/URL.
                "category": "",
                "price_source_quality": "rendered",
            })
        return items

    def build_snapshot(
        self,
        cards: list[dict],
        *,
        expected_total: int | None,
        successful_pages: int,
        terminated: bool,
    ) -> list[dict]:
        """Validate a finished rendered crawl, resolve it through UCP, build items.

        Sets ``crawl_complete`` only when every rendered page arrived, the cards
        match the collection total exactly, every card resolves through UCP or
        is confirmed sold out on its product page, and the item floor is met.
        Anything less returns no items.
        """
        self.crawl_complete = False
        raw_ids = [str(card.get("variant_id") or "").strip() for card in cards]
        expected_pages = math.ceil(expected_total / RENDERED_PAGE_SIZE) if expected_total else 0
        rendered_complete = (
            bool(expected_total)
            and terminated
            and successful_pages == expected_pages
            and len(raw_ids) == expected_total
            and len(set(raw_ids)) == expected_total
            and all(raw_ids)
        )
        if not rendered_complete:
            print(
                f"[burton] incomplete rendered crawl: pages={successful_pages}/{expected_pages} "
                f"raw={len(raw_ids)}/{expected_total} unique={len(set(raw_ids))} "
                f"without_variant={sum(1 for value in raw_ids if not value)}",
                flush=True,
            )
            return []

        try:
            product_by_card, products_by_id = self._resolve_cards(cards)
            unresolved = [index for index in range(len(cards)) if index not in product_by_card]
            # UCP omits products with no purchasable variant. Only accept that
            # explanation after the product page itself confirms it.
            sold_out = 0
            for index in unresolved:
                if self._product_page_sold_out(cards[index].get("url")) is not True:
                    print(
                        f"[burton] UCP could not resolve {cards[index].get('url')!r} and its product page "
                        "does not confirm it is sold out",
                        flush=True,
                    )
                    return []
                sold_out += 1
            resolved_cards = [
                {**card, "source_id": product_by_card[index]}
                for index, card in enumerate(cards)
                if index in product_by_card
            ]
            product_ids = [card["source_id"] for card in resolved_cards]
            if len(set(product_ids)) != len(product_ids):
                print("[burton] rendered cards resolve to duplicate products", flush=True)
                return []
        except UcpError as exc:
            print(f"[burton] UCP catalog lookup failed: {str(exc)[:200]}", flush=True)
            return []
        missing = [source_id for source_id in product_ids if source_id not in products_by_id]
        if missing:
            print(
                f"[burton] UCP catalog is missing {len(missing)}/{len(product_ids)} resolved products "
                f"(e.g. {missing[:3]})",
                flush=True,
            )
            return []
        print(
            f"[burton] UCP resolved {len(products_by_id)}/{len(cards)} rendered products; "
            f"{sold_out} confirmed sold out",
            flush=True,
        )
        cards = resolved_cards

        try:
            parsed = self.parse_rendered_cards(cards, products_by_id)
        except ValueError as exc:
            print(f"[burton] rendered card validation failed: {str(exc)[:200]}", flush=True)
            return []
        items = []
        seen_items = set()
        for item in parsed:
            if item["source_id"] in seen_items:
                continue
            seen_items.add(item["source_id"])
            items.append(item)

        self.crawl_complete = len(items) >= self.MIN_ITEMS
        if not self.crawl_complete:
            print(f"[burton] incomplete snapshot: items={len(items)}/{self.MIN_ITEMS}", flush=True)
        return items

    @staticmethod
    def _close_page(page) -> None:
        try:
            page.close()
        except Exception:
            pass

    def _fetch_browser_page(self, browser, page_number: int) -> tuple[list[dict], dict]:
        attempts = max(1, int(os.environ.get("BURTON_PAGE_RETRIES", "3")))
        url = COLLECTION_URL if page_number == 1 else f"{COLLECTION_URL}?page={page_number}"
        last_error = RuntimeError("unknown Burton page failure")
        for attempt in range(1, attempts + 1):
            page = browser.new_page()
            page.set_default_navigation_timeout(90000)
            try:
                response = page.goto(url, wait_until="domcontentloaded", timeout=90000)
                if not response or response.status != 200:
                    raise RuntimeError(f"HTTP {response.status if response else 'unknown'}")
                page.wait_for_function(
                    """() => {
                      const cards = [...document.querySelectorAll('li.prd-List_Item')];
                      return cards.length > 0 && cards.every((node) =>
                        node.querySelector('article.prd-Card .prd-Price')
                        && node.querySelector('[data-product-card-el="url"]'));
                    }""",
                    timeout=45000,
                )
                cards = page.locator("li.prd-List_Item").evaluate_all(
                    """nodes => nodes.map((node) => {
                      const card = node.querySelector('article.prd-Card');
                      const url = card?.querySelector('[data-product-card-el="url"]');
                      const name = url?.querySelector('.util-ScreenReaderOnly')?.textContent?.trim()
                        || card?.querySelector('[data-product-card-el="quick"]')?.getAttribute('aria-label')?.replace(/^Quick view:\\s*/, '')
                        || '';
                      const variantIds = [...new Set(
                        [...(card?.querySelectorAll('[data-url*="variant="], a[href*="variant="]') || [])]
                          .map((el) => (el.getAttribute('data-url') || el.getAttribute('href') || '')
                            .match(/[?&]variant=(\\d+)/)?.[1])
                          .filter(Boolean)
                      )];
                      return {
                        variant_id: variantIds[0] || '',
                        variant_ids: variantIds,
                        page: node.dataset.page || '',
                        url: url?.getAttribute('href') || '',
                        name,
                        image: card?.querySelector('.prd-Card_Image img')?.getAttribute('src') || '',
                        sale_text: card?.querySelector('.prd-Price_SalePrice')?.textContent?.trim() || '',
                        original_text: card?.querySelector('.prd-Price_RegularPrice')?.textContent?.trim() || '',
                        price_text: card?.querySelector('.prd-Price')?.textContent?.trim() || '',
                        colors: [...card.querySelectorAll('[data-product-card-el="swatch"]')]
                          .map((swatch) => swatch.getAttribute('aria-label')?.trim())
                          .filter(Boolean),
                      };
                    })"""
                )
                if any(str(card.get("page")) != str(page_number) for card in cards):
                    raise RuntimeError(f"Burton page marker mismatch on page {page_number}")
                count_text = page.locator('[data-collection-filters-el="product-count"]').inner_text()
                numbers = [int(value) for value in re.findall(r"\d+", count_text)]
                if not numbers:
                    raise RuntimeError("missing Burton collection total")
                next_locator = page.locator('[data-collection-filters-el="load-more-trigger"]')
                next_href = next_locator.get_attribute("href") if next_locator.count() else None
                return cards, {"total_count": numbers[-1], "next_href": next_href}
            except Exception as exc:
                last_error = exc
                if attempt < attempts:
                    delay = max(0, int(os.environ.get("BURTON_RETRY_DELAY_MS", "5000"))) * attempt / 1000
                    print(
                        f"[burton] page {page_number} retry {attempt}/{attempts} "
                        f"after {delay:.0f}s: {str(exc)[:180]}",
                        flush=True,
                    )
                    time.sleep(delay)
            finally:
                self._close_page(page)
        raise last_error

    def scrape(self) -> list[dict]:
        from camoufox.sync_api import Camoufox

        cards: list[dict] = []
        expected_total = None
        terminated = False
        successful_pages = 0
        inter_page_delay = max(0, int(os.environ.get("BURTON_INTER_PAGE_DELAY_MS", "1000"))) / 1000

        with Camoufox(headless=True, humanize=True, geoip=True) as browser:
            for page_number in range(1, self.MAX_PAGES + 1):
                try:
                    page_cards, metadata = self._fetch_browser_page(browser, page_number)
                    if expected_total is None:
                        expected_total = metadata["total_count"]
                    elif metadata["total_count"] != expected_total:
                        raise RuntimeError("Burton collection total changed during crawl")
                    next_href = metadata["next_href"]
                    if next_href and not next_href.endswith(f"?page={page_number + 1}"):
                        raise RuntimeError(f"unexpected Burton next page: {next_href!r}")
                except Exception as exc:
                    print(f"[burton] page {page_number} failed: {str(exc)[:200]}", flush=True)
                    break

                successful_pages += 1
                cards.extend(page_cards)
                print(
                    f"[burton] outlet page {page_number}: {len(page_cards)} products "
                    f"(total {len(cards)}/{expected_total})",
                    flush=True,
                )
                if not next_href:
                    terminated = True
                    break
                if inter_page_delay:
                    time.sleep(inter_page_delay)

        return self.build_snapshot(
            cards,
            expected_total=expected_total,
            successful_pages=successful_pages,
            terminated=terminated,
        )


if __name__ == "__main__":
    scraper = Scraper()
    products = scraper.scrape()
    print(f"\n=== BURTON {len(products)} 件 ===")
    for product in products[:8]:
        print(
            f"  -{product.get('discount_pct', 0)}%  "
            f"${product.get('sale_price')}/{product.get('original_price')}  "
            f"{product.get('name', '')[:60]}"
        )
    if not products:
        raise SystemExit("[burton] no items scraped; not writing dealers/_partial/burton.json")
    os.makedirs("dealers/_partial", exist_ok=True)
    with open("dealers/_partial/burton.json", "w", encoding="utf-8") as handle:
        json.dump({
            "name": scraper.NAME,
            "region": scraper.REGION,
            "count": len(products),
            "items": products,
            "crawl_complete": scraper.crawl_complete,
            "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }, handle, indent=2, ensure_ascii=False)
    print("→ dealers/_partial/burton.json")
    if not scraper.crawl_complete:
        raise SystemExit("[burton] crawl incomplete; partial retained for diagnostics but will not be published")
