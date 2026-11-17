"""Arc'teryx official full-price list prices per Outlet country.

The US official product feed already defines the Yearbook's canonical
Arc'teryx catalog. The same feed answers every Outlet country except Japan and
Australia with local-currency prices under the same style IDs, and its
``discountPrice`` always equals ``price`` (full price only). This module
collects one price row per (style, country) for styles present in the US
catalog and syncs them to ``catalog_product_prices``.

Australia is not in that feed. arcteryx.com.au is a Shopify store, so its
prices come from the store's UCP catalog instead (see ``collect_au_prices``).
It sells some previous-generation styles under older style IDs; only styles
whose ID matches the US catalog exactly are priced, never by name.

Each country is judged on its own: a failed or implausible country is reported
and skipped, never aged out, so one flaky market cannot retire another
market's prices.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
from typing import Any, Iterable, Mapping, Sequence

from tools.shopify_ucp import UcpCatalogClient, UcpError, money

from catalog.official_catalog import (
    ARCTERYX_GENDERS,
    ARCTERYX_ORIGIN,
    ARCTERYX_PRODUCT_ID_RE,
    MISSING_RUNS_BEFORE_INACTIVE,
    CatalogClient,
    CatalogSourceError,
    _catalog_product_id,
    _clean_text,
    _pages,
    _price,
)

REGIONAL_SOURCE_NAME = "arcteryx_official_product_feed"
REGIONAL_TABLE = "catalog_product_prices"
REGIONAL_CURRENCIES = {
    "us": "USD",
    "ca": "CAD",
    "gb": "GBP",
    "de": "EUR",
    "fr": "EUR",
    "nl": "EUR",
    "fi": "EUR",
    "ie": "EUR",
    "se": "SEK",
    "at": "EUR",
    "ch": "CHF",
    "it": "EUR",
    "es": "EUR",
    "dk": "DKK",
    "be": "EUR",
}
REGIONAL_COUNTRIES = tuple(REGIONAL_CURRENCIES)

# Australia (Shopify UCP). Endpoint/storefront match global_scraper's AU sale
# crawl; they are repeated here so the catalog job never imports Playwright.
AU_COUNTRY = "au"
AU_CURRENCY = "AUD"
AU_SOURCE_NAME = "arcteryx_au_shopify_ucp"
AU_STOREFRONT = "https://arcteryx.com.au"
AU_UCP_ENDPOINT = "https://arcteryx-au.myshopify.com/api/ucp/mcp"
AU_UCP_MAX_PAGES = 60
# The AU catalog listed 869 products on 2026-11-18; a short walk is a failure.
AU_MIN_CATALOG_PRODUCTS = 300
# 175 AU styles shared an ID with the US catalog on 2026-11-18.
AU_MIN_PRICED_STYLES = 120
AU_SALE_COLLECTION_HANDLES = frozenset({"sale", "outlet", "mens-outlet", "womens-outlet"})
# AU variant SKUs are the style ID plus a two-digit colour code.
AU_STYLE_SKU_RE = re.compile(r"^(X[0-9]{9})[0-9]{2}$")
AU_HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
# Countries whose failure is reported but does not fail the whole readback:
# UCP is rate limited, while the official feed countries are not.
OPTIONAL_REGIONAL_COUNTRIES = frozenset({AU_COUNTRY})
# European feeds list ~200 styles per gender, North America ~230 (2026-11-17).
MIN_REGIONAL_PRODUCTS_PER_GENDER = 120
MAX_REGIONAL_PRODUCTS_PER_GENDER = 2_000
# A complete country must price at least this share of the US catalog.
MIN_REGIONAL_US_COVERAGE = 0.60
FACTUAL_PRICE_KEYS = (
    "catalog_product_id",
    "country",
    "currency",
    "list_price",
    "list_price_max",
    "source_url",
)


def regional_product_url(value: Any, country: str) -> str:
    raw = _clean_text(value)
    if not raw:
        raise CatalogSourceError(f"Arc'teryx {country} product URL is missing")
    url = urllib.parse.urljoin(f"{ARCTERYX_ORIGIN}/", raw.lstrip("/"))
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "arcteryx.com":
        raise CatalogSourceError(f"non-official Arc'teryx URL: {url}")
    if not re.match(rf"^/{country}/[a-z]{{2}}/shop/", parsed.path):
        raise CatalogSourceError(f"Arc'teryx {country} URL is outside its shop: {url}")
    return urllib.parse.urlunparse(
        ("https", "arcteryx.com", parsed.path.rstrip("/"), "", "", "")
    )


def _price_hash(row: Mapping[str, Any]) -> str:
    payload = {key: row.get(key) for key in FACTUAL_PRICE_KEYS}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def normalize_regional_price(raw: Mapping[str, Any], country: str) -> dict[str, Any]:
    expected_currency = REGIONAL_CURRENCIES.get(country)
    if expected_currency is None:
        raise ValueError(f"unsupported regional country: {country!r}")
    official_id = _clean_text(raw.get("sku") or raw.get("id")).upper()
    if not ARCTERYX_PRODUCT_ID_RE.fullmatch(official_id):
        raise CatalogSourceError(f"invalid Arc'teryx {country} product ID: {official_id!r}")
    currency = _clean_text(raw.get("currencyCode")).upper()
    if currency != expected_currency:
        raise CatalogSourceError(
            f"Arc'teryx {country} product {official_id} has currency {currency!r}; "
            f"expected {expected_currency}"
        )
    price = _price(raw.get("price"))
    discount = raw.get("discountPrice")
    if discount not in (None, "") and abs(_price(discount) - price) > 0.005:
        raise CatalogSourceError(
            f"Arc'teryx {country} product {official_id} carries a discount; "
            "the feed is expected to list full prices only"
        )
    row = {
        "catalog_product_id": _catalog_product_id("arcteryx", official_id),
        "country": country,
        "brand_key": "arcteryx",
        "currency": currency,
        "list_price": price,
        "list_price_max": price,
        "source_name": REGIONAL_SOURCE_NAME,
        "source_url": regional_product_url(raw.get("url"), country),
    }
    row["source_hash"] = _price_hash(row)
    return row


def collect_regional_prices(
    client: CatalogClient,
    known_catalog_ids: Iterable[str],
    *,
    countries: Sequence[str] = REGIONAL_COUNTRIES,
) -> tuple[list[dict[str, Any]], set[str], dict[str, dict[str, Any]]]:
    """Return (price rows, complete countries, per-country report)."""
    known = set(known_catalog_ids)
    if not known:
        raise ValueError("regional prices need the US catalog IDs")
    rows: list[dict[str, Any]] = []
    complete: set[str] = set()
    report: dict[str, dict[str, Any]] = {}
    for country in countries:
        if country not in REGIONAL_CURRENCIES:
            raise ValueError(f"unsupported regional country: {country!r}")
        try:
            by_id: dict[str, dict[str, Any]] = {}
            for gender in ARCTERYX_GENDERS:
                feed = client.fetch_feed(gender, country=country)
                if not (
                    MIN_REGIONAL_PRODUCTS_PER_GENDER
                    <= len(feed)
                    <= MAX_REGIONAL_PRODUCTS_PER_GENDER
                ):
                    raise CatalogSourceError(
                        f"implausible Arc'teryx {country} {gender} count: {len(feed)}"
                    )
                for raw in feed:
                    row = normalize_regional_price(raw, country)
                    previous = by_id.get(row["catalog_product_id"])
                    if previous and previous["list_price"] != row["list_price"]:
                        raise CatalogSourceError(
                            f"Arc'teryx {country} lists {row['catalog_product_id']} at two prices"
                        )
                    by_id.setdefault(row["catalog_product_id"], row)
            priced = {catalog_id: row for catalog_id, row in by_id.items() if catalog_id in known}
            coverage = len(priced) / len(known)
            if coverage < MIN_REGIONAL_US_COVERAGE:
                raise CatalogSourceError(
                    f"Arc'teryx {country} prices only {coverage:.0%} of the US catalog"
                )
        except CatalogSourceError as exc:
            report[country] = {"complete": False, "error": str(exc)[:240]}
            continue
        rows.extend(sorted(priced.values(), key=lambda row: row["catalog_product_id"]))
        complete.add(country)
        report[country] = {
            "complete": True,
            "priced": len(priced),
            "not_in_us_catalog": len(by_id) - len(priced),
        }
    return rows, complete, report


def _au_list_price(product: Mapping[str, Any], variant: Mapping[str, Any]) -> float | None:
    """Full list price of one AU variant, or None when it cannot be proven.

    Outside a sale UCP exposes only ``price``. A discounted variant carries its
    compare-at/list price; if a product looks discounted (sale collection or a
    non-zero list range) but the variant lacks one, the current price may be a
    sale price, so it is not used as the official list price.
    """
    price = money(variant.get("price"), AU_CURRENCY)
    if price is None:
        return None
    listed = money(variant.get("compare_at_price"), AU_CURRENCY) or money(
        variant.get("list_price"), AU_CURRENCY
    )
    if listed is not None and listed > price:
        return listed
    range_max = money(((product.get("list_price_range") or {}).get("max")), AU_CURRENCY)
    on_sale = any(
        str((collection or {}).get("handle") or "") in AU_SALE_COLLECTION_HANDLES
        for collection in product.get("collections") or []
    )
    if (range_max is not None and range_max > price) or on_sale:
        return None
    return price


def collect_au_prices(
    known_catalog_ids: Iterable[str],
    *,
    client: Any | None = None,
) -> tuple[list[dict[str, Any]], bool, dict[str, Any]]:
    """Return (AU price rows, complete, report entry) from arcteryx.com.au UCP."""
    known = set(known_catalog_ids)
    if not known:
        raise ValueError("regional prices need the US catalog IDs")
    client = client or UcpCatalogClient(
        AU_UCP_ENDPOINT,
        AU_STOREFRONT,
        context={"address_country": "AU", "language": "en-AU", "currency": AU_CURRENCY},
    )
    try:
        products, walked = client.search_all("", max_pages=AU_UCP_MAX_PAGES)
        if not walked:
            raise CatalogSourceError(f"AU UCP walk ended early after {len(products)} products")
        if len(products) < AU_MIN_CATALOG_PRODUCTS:
            raise CatalogSourceError(f"AU UCP catalog has only {len(products)} products")
        styles: dict[str, dict[str, Any]] = {}
        unproven: set[str] = set()
        for product in products:
            handle = _clean_text(product.get("handle"))
            if not AU_HANDLE_RE.fullmatch(handle):
                continue
            for variant in product.get("variants") or ():
                match = AU_STYLE_SKU_RE.fullmatch(_clean_text(variant.get("sku")).upper())
                if not match:
                    continue
                catalog_id = _catalog_product_id("arcteryx", match.group(1))
                if catalog_id not in known:
                    continue
                listed = _au_list_price(product, variant)
                if listed is None:
                    unproven.add(catalog_id)
                    continue
                style = styles.setdefault(catalog_id, {"prices": set(), "handles": set()})
                style["prices"].add(listed)
                style["handles"].add(handle)
        # A style with any unprovable variant is left out rather than priced
        # from a partial (possibly discounted) set of colours.
        for catalog_id in unproven:
            styles.pop(catalog_id, None)
        if len(styles) < AU_MIN_PRICED_STYLES:
            raise CatalogSourceError(
                f"AU prices only {len(styles)} US catalog styles (< {AU_MIN_PRICED_STYLES})"
            )
    except (CatalogSourceError, UcpError) as exc:
        return [], False, {"complete": False, "optional": True, "error": str(exc)[:240]}

    rows = []
    for catalog_id in sorted(styles):
        style = styles[catalog_id]
        row = {
            "catalog_product_id": catalog_id,
            "country": AU_COUNTRY,
            "brand_key": "arcteryx",
            "currency": AU_CURRENCY,
            "list_price": min(style["prices"]),
            "list_price_max": max(style["prices"]),
            "source_name": AU_SOURCE_NAME,
            "source_url": f"{AU_STOREFRONT}/products/{min(style['handles'])}",
        }
        row["source_hash"] = _price_hash(row)
        rows.append(row)
    return rows, True, {
        "complete": True,
        "optional": True,
        "priced": len(rows),
        "catalog_products": len(products),
        "unproven_styles": len(unproven),
    }


def sync_regional_prices(
    client: Any,
    regional: Mapping[str, Any],
    *,
    observed_at: str,
    batch_size: int = 100,
) -> dict[str, int]:
    """Upsert observed prices and age unobserved rows only in complete countries."""
    complete = set(regional.get("complete_countries") or ())
    rows = [dict(row) for row in regional.get("rows") or ()]
    if any(row.get("country") not in complete for row in rows):
        raise CatalogSourceError("regional rows include a country that did not complete")
    table = client.table(REGIONAL_TABLE)
    existing_rows = _pages(
        table,
        "catalog_product_id,country,first_seen_at,last_changed_at,source_hash,status,missing_runs",
    )
    existing = {(row["catalog_product_id"], row["country"]): row for row in existing_rows}
    current: list[dict[str, Any]] = []
    for row in rows:
        old = existing.get((row["catalog_product_id"], row["country"]), {})
        row.update(
            {
                "status": "active",
                "missing_runs": 0,
                "first_seen_at": old.get("first_seen_at") or observed_at,
                "last_seen_at": observed_at,
                "last_changed_at": (
                    old.get("last_changed_at")
                    if old.get("source_hash") == row["source_hash"] and old.get("last_changed_at")
                    else observed_at
                ),
                "updated_at": observed_at,
            }
        )
        current.append(row)
    for start in range(0, len(current), batch_size):
        client.table(REGIONAL_TABLE).upsert(
            current[start : start + batch_size], on_conflict="catalog_product_id,country"
        ).execute()

    seen = {(row["catalog_product_id"], row["country"]) for row in current}
    lifecycle: dict[tuple[str, str, int], list[str]] = {}
    for (catalog_id, country), old in existing.items():
        if country not in complete or (catalog_id, country) in seen:
            continue
        missing_runs = int(old.get("missing_runs") or 0) + 1
        status = "inactive" if missing_runs >= MISSING_RUNS_BEFORE_INACTIVE else "missing"
        lifecycle.setdefault((country, status, missing_runs), []).append(catalog_id)
    aged = 0
    for (country, status, missing_runs), identifiers in lifecycle.items():
        for start in range(0, len(identifiers), batch_size):
            client.table(REGIONAL_TABLE).update(
                {"status": status, "missing_runs": missing_runs, "updated_at": observed_at}
            ).eq("country", country).in_(
                "catalog_product_id", identifiers[start : start + batch_size]
            ).execute()
        aged += len(identifiers)
    return {
        "regional_upserted": len(current),
        "regional_aged": aged,
        "regional_complete_countries": len(complete),
    }
