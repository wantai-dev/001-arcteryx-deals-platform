"""Archive official full-price catalogs for Arc'teryx, Burton, and Patagonia.

This data path is deliberately independent from Deals. It stores a compact,
factual style record plus immutable change snapshots. Descriptions, product
imagery, and inventory-by-size are intentionally excluded.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BRAND_KEYS = ("arcteryx", "burton", "patagonia")
BRAND_LABELS = {
    "arcteryx": "Arc'teryx",
    "burton": "Burton",
    "patagonia": "Patagonia",
}
STATE_SCHEMA_VERSION = 2
SOURCE_NAME = "geardrop_official_full_price_catalog"
CATALOG_SCOPE = "full_price"
SHOPIFY_PAGE_SIZE = 250
MAX_SHOPIFY_PAGES = 20
MISSING_RUNS_BEFORE_INACTIVE = 2

ARCTERYX_FEED_URL = (
    "https://jh5e3sxgk0.execute-api.us-west-2.amazonaws.com/product-feed/products"
)
ARCTERYX_ORIGIN = "https://arcteryx.com"
ARCTERYX_SOURCE_NAME = "arcteryx_us_official_product_feed"
ARCTERYX_GENDERS = ("mens", "womens")
MIN_ARCTERYX_PRODUCTS_PER_GENDER = 100
MAX_ARCTERYX_PRODUCTS_PER_GENDER = 2_000
MIN_ARCTERYX_CATEGORY_COVERAGE = 0.85
ARCTERYX_PRIMARY_CATEGORIES = (
    "accessories",
    "base-layer",
    "climbing-gear",
    "dresses-and-skirts",
    "fleece",
    "footwear",
    "insulated-jackets",
    "packs",
    "pants",
    "shell-jackets",
    "shirts-and-tops",
    "shorts",
)
ARCTERYX_CATEGORY_FEED_KEYS = {
    "accessories": "accessories",
    "base-layer": "baselayer",
    "climbing-gear": "climbinggear",
    "dresses-and-skirts": "dressesandskirts",
    "fleece": "fleece",
    "footwear": "footwear",
    "insulated-jackets": "insulatedjackets",
    "packs": "packs",
    "pants": "pants",
    "shell-jackets": "shelljackets",
    "shirts-and-tops": "shirtsandtops",
    "shorts": "shorts",
}

ARCTERYX_PRODUCT_ID_RE = re.compile(r"^X[0-9A-Z]{6,}$")
SHOPIFY_STYLE_ID_RE = re.compile(r"^[0-9A-Z][0-9A-Z._-]{1,63}$")
BURTON_HANDLE_STYLE_RE = re.compile(r"-(\d{6})$")
# Rows whose style cannot be proven are skipped, but only up to this share of
# the full-price rows; beyond it the source is treated as structurally broken.
MAX_UNIDENTIFIED_STYLE_RATIO = 0.02
CATALOG_PRODUCT_ID_RE = re.compile(
    r"^(?:arcteryx|burton|patagonia):[a-z0-9][a-z0-9._-]{1,63}$"
)
SEASON_RE = re.compile(r"(?<![A-Z0-9])([FSW]\d{2})(?!\d)", re.IGNORECASE)

FACTUAL_KEYS = (
    "catalog_product_id",
    "brand_key",
    "official_product_id",
    "brand",
    "catalog_scope",
    "market",
    "country",
    "language",
    "name",
    "gender",
    "collection",
    "categories",
    "category_sources",
    "list_price",
    "list_price_max",
    "currency",
    "color_names",
    "primary_colors",
    "season_codes",
    "source_name",
    "source_url",
)


class CatalogSourceError(RuntimeError):
    """Raised when an official source returns an incomplete or invalid catalog."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _dedupe(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _slug(value: Any) -> str:
    return "-".join(re.findall(r"[a-z0-9]+", _clean_text(value).lower()))


def _price(value: Any) -> float:
    try:
        price = round(float(value), 2)
    except (TypeError, ValueError) as exc:
        raise CatalogSourceError(f"invalid list price: {value!r}") from exc
    if price < 0:
        raise CatalogSourceError(f"negative list price: {price}")
    return price


def _tags(raw: Mapping[str, Any]) -> list[str]:
    tags = raw.get("tags")
    if isinstance(tags, list):
        return [_clean_text(tag) for tag in tags if _clean_text(tag)]
    if isinstance(tags, str):
        return [_clean_text(tag) for tag in tags.split(",") if _clean_text(tag)]
    return []


def _tag_values(raw: Mapping[str, Any], prefix: str) -> list[str]:
    return [tag[len(prefix) :] for tag in _tags(raw) if tag.startswith(prefix)]


def _catalog_product_id(brand_key: str, official_product_id: str) -> str:
    value = f"{brand_key}:{official_product_id.lower()}"
    if not CATALOG_PRODUCT_ID_RE.fullmatch(value):
        raise CatalogSourceError(f"invalid catalog product ID: {value!r}")
    return value


def _hash_payload(product: Mapping[str, Any]) -> str:
    payload = {key: product.get(key) for key in FACTUAL_KEYS}
    canonical = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _finalize_product(product: dict[str, Any]) -> dict[str, Any]:
    brand_key = product.get("brand_key")
    if brand_key not in BRAND_KEYS:
        raise CatalogSourceError(f"unsupported brand key: {brand_key!r}")
    if product.get("brand") != BRAND_LABELS[brand_key]:
        raise CatalogSourceError(f"brand label mismatch for {brand_key}")
    if product.get("catalog_scope") != CATALOG_SCOPE:
        raise CatalogSourceError("catalog scope must be full_price")
    if product.get("gender") not in {"men", "women", "kids", "unisex"}:
        raise CatalogSourceError(
            f"unsupported gender for {product.get('catalog_product_id')}: "
            f"{product.get('gender')!r}"
        )
    if product.get("list_price_max", -1) < product.get("list_price", 0):
        raise CatalogSourceError("list_price_max cannot be below list_price")
    product["source_hash"] = _hash_payload(product)
    return product


class CatalogClient:
    """Rate-limited JSON client for the three official catalog surfaces."""

    def __init__(
        self,
        *,
        delay: float = 0.25,
        retries: int = 4,
        timeout: float = 60.0,
        opener: Callable[..., Any] | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if delay < 0 or retries < 1 or timeout <= 0:
            raise ValueError("delay and timeout must be non-negative; retries must be positive")
        self.delay = delay
        self.retries = retries
        self.timeout = timeout
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep
        self._last_request_at = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if self._last_request_at and elapsed < self.delay:
            self._sleep(self.delay - elapsed)

    def _fetch_json(
        self, url: str, *, scope: str, missing_is_empty: bool = False
    ) -> Any:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "GearDrop official full-price catalog/2.0",
            },
        )
        retryable = (
            urllib.error.URLError,
            http.client.IncompleteRead,
            http.client.RemoteDisconnected,
            ConnectionError,
            TimeoutError,
            socket.timeout,
            json.JSONDecodeError,
        )
        for attempt in range(self.retries):
            self._throttle()
            try:
                with self._open(request, timeout=self.timeout) as response:
                    self._last_request_at = time.monotonic()
                    status = getattr(response, "status", 200)
                    if status != 200:
                        raise CatalogSourceError(f"{scope} returned HTTP {status}")
                    return json.load(response)
            except urllib.error.HTTPError as exc:
                self._last_request_at = time.monotonic()
                if exc.code == 404 and missing_is_empty:
                    exc.close()
                    return []
                if (
                    exc.code not in {408, 429, 500, 502, 503, 504}
                    or attempt + 1 == self.retries
                ):
                    raise CatalogSourceError(
                        f"{scope} returned HTTP {exc.code}"
                    ) from exc
                retry_after = exc.headers.get("Retry-After", "") if exc.headers else ""
                wait = float(retry_after) if retry_after.isdigit() else min(2**attempt, 15)
                self._sleep(wait)
            except retryable as exc:
                self._last_request_at = time.monotonic()
                if attempt + 1 == self.retries:
                    raise CatalogSourceError(
                        f"{scope} failed after {self.retries} attempts: {exc}"
                    ) from exc
                self._sleep(min(2**attempt, 15))
        raise AssertionError("unreachable")

    def fetch_feed(self, gender: str, category: str = "") -> list[dict[str, Any]]:
        if gender not in ARCTERYX_GENDERS:
            raise ValueError(f"unsupported Arc'teryx gender query: {gender}")
        if category and category not in ARCTERYX_PRIMARY_CATEGORIES:
            raise ValueError(f"unsupported Arc'teryx category: {category}")
        params = urllib.parse.urlencode(
            {
                "market": "outdoor",
                "language": "en",
                "country": "us",
                "gender": gender,
                "category": ARCTERYX_CATEGORY_FEED_KEYS.get(category, category),
                "subCategory": "",
                "env": "prod",
            }
        )
        payload = self._fetch_json(
            f"{ARCTERYX_FEED_URL}?{params}",
            scope=f"Arc'teryx feed {gender}/{category or 'all'}",
            missing_is_empty=bool(category),
        )
        if not isinstance(payload, list):
            raise CatalogSourceError("Arc'teryx feed returned a non-list payload")
        return [row for row in payload if isinstance(row, dict)]

    def fetch_shopify_page(
        self, source: ShopifySourceConfig, page: int
    ) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"limit": SHOPIFY_PAGE_SIZE, "page": page})
        payload = self._fetch_json(
            f"{source.collection_url}?{query}",
            scope=f"{source.label} official collection page {page}",
        )
        if not isinstance(payload, Mapping) or not isinstance(
            payload.get("products"), list
        ):
            raise CatalogSourceError(
                f"{source.label} collection page {page} has no products array"
            )
        products = payload["products"]
        if any(not isinstance(row, Mapping) for row in products):
            raise CatalogSourceError(
                f"{source.label} collection page {page} contains a non-object row"
            )
        return [dict(row) for row in products]


def _arcteryx_product_url(value: Any) -> str:
    raw = _clean_text(value)
    if not raw:
        raise CatalogSourceError("Arc'teryx product URL is missing")
    url = urllib.parse.urljoin(f"{ARCTERYX_ORIGIN}/", raw.lstrip("/"))
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "arcteryx.com":
        raise CatalogSourceError(f"non-official Arc'teryx URL: {url}")
    if not parsed.path.startswith("/us/en/shop/"):
        raise CatalogSourceError(f"non-US Arc'teryx shop URL: {url}")
    return urllib.parse.urlunparse(
        ("https", "arcteryx.com", parsed.path.rstrip("/"), "", "", "")
    )


def _arcteryx_colour_facts(
    raw: Mapping[str, Any],
) -> tuple[list[str], list[str], list[str]]:
    colour_options = raw.get("colourOptions")
    if not isinstance(colour_options, Mapping):
        colour_options = {}
    options = colour_options.get("options")
    if not isinstance(options, list):
        options = []
    names: list[str] = []
    primary_colours: list[str] = []
    season_codes: list[str] = []
    image_candidates: list[Mapping[str, Any]] = []
    main_image = raw.get("mainImage")
    if isinstance(main_image, Mapping):
        image_candidates.append(main_image)
    for option in options:
        if not isinstance(option, Mapping):
            continue
        image = option.get("image")
        thumbnail = option.get("thumbnail")
        image_map = image if isinstance(image, Mapping) else {}
        thumbnail_map = thumbnail if isinstance(thumbnail, Mapping) else {}
        name = _clean_text(image_map.get("colourLabel"))
        if name:
            names.append(name)
        primary = _clean_text(option.get("primaryColour"))
        if primary:
            primary_colours.append(primary)
        image_candidates.extend(
            candidate for candidate in (image_map, thumbnail_map) if candidate
        )
    for image in image_candidates:
        for key in ("pathname", "url"):
            season_codes.extend(
                match.upper() for match in SEASON_RE.findall(_clean_text(image.get(key)))
            )
    return (
        sorted(_dedupe(names), key=str.casefold),
        sorted(_dedupe(primary_colours), key=str.casefold),
        sorted(_dedupe(season_codes), key=lambda value: (value[1:], value[0])),
    )


def normalize_arcteryx_product(
    raw: Mapping[str, Any],
    categories: Iterable[str] = (),
    category_sources: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    official_id = _clean_text(raw.get("sku") or raw.get("id")).upper()
    if not ARCTERYX_PRODUCT_ID_RE.fullmatch(official_id):
        raise CatalogSourceError(f"invalid Arc'teryx product ID: {official_id!r}")
    name = _clean_text(raw.get("name") or raw.get("marketingName"))
    if not name:
        raise CatalogSourceError(f"Arc'teryx product {official_id} has no name")
    gender = _clean_text(raw.get("gender")).lower()
    if gender not in {"men", "women", "unisex"}:
        raise CatalogSourceError(
            f"Arc'teryx product {official_id} has unsupported gender: {gender!r}"
        )
    currency = _clean_text(raw.get("currencyCode")).upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise CatalogSourceError(
            f"Arc'teryx product {official_id} has invalid currency: {currency!r}"
        )
    colors, primary_colors, seasons = _arcteryx_colour_facts(raw)
    normalized_categories = sorted(
        {_slug(value) for value in categories if _slug(value)}
    )
    normalized_sources = {
        category: _clean_text((category_sources or {}).get(category))
        or "official_category_feed"
        for category in normalized_categories
    }
    price = _price(raw.get("price"))
    return _finalize_product(
        {
            "catalog_product_id": _catalog_product_id("arcteryx", official_id),
            "brand_key": "arcteryx",
            "official_product_id": official_id,
            "brand": BRAND_LABELS["arcteryx"],
            "catalog_scope": CATALOG_SCOPE,
            "market": "outdoor",
            "country": "us",
            "language": "en",
            "name": name,
            "gender": gender,
            "collection": _clean_text(raw.get("collection")) or None,
            "categories": normalized_categories,
            "category_sources": normalized_sources,
            "list_price": price,
            "list_price_max": price,
            "currency": currency,
            "color_names": colors,
            "primary_colors": primary_colors,
            "season_codes": seasons,
            "source_name": ARCTERYX_SOURCE_NAME,
            "source_url": _arcteryx_product_url(raw.get("url")),
        }
    )


def collect_arcteryx_catalog(
    client: CatalogClient,
    *,
    genders: Sequence[str] = ARCTERYX_GENDERS,
    categories: Sequence[str] = ARCTERYX_PRIMARY_CATEGORIES,
    enrich_categories: bool = True,
    limit: int | None = None,
    product_ids: Sequence[str] = (),
) -> tuple[list[dict[str, Any]], bool]:
    requested_genders = tuple(dict.fromkeys(genders))
    if not requested_genders or any(
        gender not in ARCTERYX_GENDERS for gender in requested_genders
    ):
        raise ValueError("Arc'teryx genders must be a subset of mens,womens")
    raw_by_id: dict[str, dict[str, Any]] = {}
    for gender in requested_genders:
        base_rows = client.fetch_feed(gender)
        if not (
            MIN_ARCTERYX_PRODUCTS_PER_GENDER
            <= len(base_rows)
            <= MAX_ARCTERYX_PRODUCTS_PER_GENDER
        ):
            raise CatalogSourceError(
                f"implausible Arc'teryx {gender} base count: {len(base_rows)} "
                f"(expected {MIN_ARCTERYX_PRODUCTS_PER_GENDER}.."
                f"{MAX_ARCTERYX_PRODUCTS_PER_GENDER})"
            )
        for raw in base_rows:
            official_id = _clean_text(raw.get("sku") or raw.get("id")).upper()
            if official_id in raw_by_id:
                raise CatalogSourceError(
                    f"duplicate Arc'teryx product ID in base feeds: {official_id}"
                )
            raw_by_id[official_id] = raw

    selected_ids = sorted(raw_by_id)
    if product_ids:
        requested_ids = {_clean_text(value).upper() for value in product_ids}
        invalid = sorted(
            value for value in requested_ids if not ARCTERYX_PRODUCT_ID_RE.fullmatch(value)
        )
        if invalid:
            raise ValueError(f"invalid Arc'teryx product IDs: {','.join(invalid)}")
        missing = sorted(requested_ids - raw_by_id.keys())
        if missing:
            raise CatalogSourceError(
                f"requested Arc'teryx product IDs not found: {','.join(missing)}"
            )
        selected_ids = sorted(requested_ids)
    elif limit is not None:
        selected_ids = selected_ids[:limit]

    selected = set(selected_ids)
    memberships: dict[str, dict[str, str]] = {
        official_id: {} for official_id in selected_ids
    }
    if enrich_categories:
        for gender in requested_genders:
            for category in categories:
                if category == "dresses-and-skirts" and gender == "mens":
                    continue
                if category == "dresses-and-skirts":
                    for official_id in selected_ids:
                        raw = raw_by_id[official_id]
                        if _clean_text(raw.get("gender")).lower() == "women" and re.search(
                            r"\b(?:dress|skirt)\b",
                            _clean_text(raw.get("name")),
                            re.IGNORECASE,
                        ):
                            memberships[official_id][category] = "official_name_keyword"
                    continue
                for raw in client.fetch_feed(gender, category):
                    official_id = _clean_text(raw.get("sku") or raw.get("id")).upper()
                    if official_id in selected:
                        memberships[official_id][category] = "official_category_feed"
        if "footwear" in categories:
            for official_id in selected_ids:
                if raw_by_id[official_id].get("isFootwear") is True:
                    memberships[official_id].setdefault(
                        "footwear", "official_feed_flag"
                    )

    products = [
        normalize_arcteryx_product(
            raw_by_id[official_id], memberships[official_id], memberships[official_id]
        )
        for official_id in selected_ids
    ]
    complete = (
        limit is None
        and not product_ids
        and set(requested_genders) == set(ARCTERYX_GENDERS)
        and enrich_categories
        and set(categories) == set(ARCTERYX_PRIMARY_CATEGORIES)
    )
    if complete and products:
        coverage = sum(bool(product["categories"]) for product in products) / len(
            products
        )
        if coverage < MIN_ARCTERYX_CATEGORY_COVERAGE:
            raise CatalogSourceError(
                f"Arc'teryx category coverage {coverage:.1%} is below "
                f"{MIN_ARCTERYX_CATEGORY_COVERAGE:.0%}"
            )
    return products, complete


def _burton_full_price(raw: Mapping[str, Any]) -> bool:
    tags = set(_tags(raw))
    return raw.get("vendor") == "Burton" and "Current" in tags and not {
        "Outlet",
        "Future",
    }.intersection(tags)


def _patagonia_full_price(raw: Mapping[str, Any]) -> bool:
    tags = set(_tags(raw))
    return (
        _clean_text(raw.get("vendor")) in {"Patagonia", "PATAGONIA INC", "PA"}
        and "flag:Order" in tags
        and "flag:Sale" not in tags
        and "sale:Yes" not in tags
    )


@dataclass(frozen=True)
class ShopifySourceConfig:
    brand_key: str
    label: str
    origin: str
    collection_url: str
    source_name: str
    market: str
    country: str
    currency: str
    min_raw_rows: int
    max_raw_rows: int
    min_full_price_rows: int
    max_full_price_rows: int
    min_styles: int
    max_styles: int
    full_price_selector: Callable[[Mapping[str, Any]], bool]


SHOPIFY_SOURCES = {
    "burton": ShopifySourceConfig(
        brand_key="burton",
        label="Burton",
        origin="https://www.burton.com",
        collection_url="https://www.burton.com/en-us/collections/all/products.json",
        source_name="burton_us_official_collection_json",
        market="snow",
        country="us",
        currency="USD",
        min_raw_rows=500,
        max_raw_rows=3_000,
        min_full_price_rows=350,
        max_full_price_rows=2_000,
        min_styles=350,
        max_styles=2_000,
        full_price_selector=_burton_full_price,
    ),
    "patagonia": ShopifySourceConfig(
        brand_key="patagonia",
        label="Patagonia",
        origin="https://www.patagonia.com.au",
        collection_url=(
            "https://www.patagonia.com.au/collections/all/products.json"
        ),
        source_name="patagonia_au_official_collection_json",
        market="outdoor",
        country="au",
        currency="AUD",
        min_raw_rows=800,
        max_raw_rows=5_000,
        min_full_price_rows=500,
        max_full_price_rows=3_000,
        min_styles=350,
        max_styles=2_000,
        full_price_selector=_patagonia_full_price,
    ),
}


def _burton_style_id_from_handle_and_skus(raw: Mapping[str, Any]) -> str | None:
    """Recover a Burton style ID when the official ``YGroup_`` tag is missing.

    Burton handles end in the six-digit style number and every variant SKU
    starts with it. Both signals must agree before the ID is accepted.
    """
    match = BURTON_HANDLE_STYLE_RE.search(_clean_text(raw.get("handle")))
    if not match:
        return None
    style_id = match.group(1)
    variants = raw.get("variants")
    if not isinstance(variants, list) or not variants:
        return None
    for variant in variants:
        sku = _clean_text(variant.get("sku")) if isinstance(variant, Mapping) else ""
        if not sku.startswith(style_id):
            return None
    return style_id


def _shopify_style_id(
    source: ShopifySourceConfig, raw: Mapping[str, Any]
) -> str | None:
    """Return the official style ID, or ``None`` for an unidentifiable Burton row."""
    prefixes = ("YGroup_",) if source.brand_key == "burton" else ("group:", "YGroup_")
    values: list[str] = []
    for prefix in prefixes:
        values.extend(_tag_values(raw, prefix))
    normalized = sorted(
        {
            cleaned
            for value in values
            if (cleaned := _clean_text(value).upper())
            and SHOPIFY_STYLE_ID_RE.fullmatch(cleaned)
        }
    )
    if len(normalized) == 1:
        return normalized[0]
    if source.brand_key == "burton" and not normalized:
        return _burton_style_id_from_handle_and_skus(raw)
    raise CatalogSourceError(
        f"{source.label} product {raw.get('id')} has invalid style IDs: {normalized}"
    )


def _shopify_product_url(source: ShopifySourceConfig, handle: Any) -> str:
    clean_handle = _clean_text(handle).strip("/")
    if not clean_handle or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", clean_handle):
        raise CatalogSourceError(
            f"{source.label} product has an invalid handle: {clean_handle!r}"
        )
    prefix = "/en-us/products/" if source.brand_key == "burton" else "/products/"
    url = f"{source.origin}{prefix}{clean_handle}"
    parsed = urllib.parse.urlparse(url)
    expected = urllib.parse.urlparse(source.origin)
    if parsed.scheme != "https" or parsed.hostname != expected.hostname:
        raise CatalogSourceError(f"non-official {source.label} product URL: {url}")
    return url


def _shopify_gender(source: ShopifySourceConfig, raws: Sequence[Mapping[str, Any]]) -> str:
    titles = " ".join(_clean_text(raw.get("title")) for raw in raws)
    tags = {tag for raw in raws for tag in _tags(raw)}
    lowered = titles.lower().replace("’", "'")
    if re.search(r"\b(?:kids?|youth|toddlers?|baby|babies|boys?|girls?)['’]?\b", lowered):
        return "kids"
    if any(tag.lower().startswith("age:kid") for tag in tags):
        return "kids"
    if any(tag.lower().startswith("age:baby") for tag in tags):
        return "kids"
    tag_men = "gender:Men's" in tags
    tag_women = "gender:Women's" in tags
    tag_neutral = "gender:Gender-Neutral" in tags
    title_men = bool(re.search(r"\bmen's\b", lowered))
    title_women = bool(re.search(r"\bwomen's\b", lowered))
    men = tag_men or title_men
    women = tag_women or title_women
    if tag_neutral or (men and women) or (not men and not women):
        return "unisex"
    return "men" if men else "women"


def _shopify_colors(raws: Sequence[Mapping[str, Any]]) -> list[str]:
    colors: list[str] = []
    for raw in raws:
        options = raw.get("options")
        if not isinstance(options, list):
            continue
        for option in options:
            if not isinstance(option, Mapping):
                continue
            if _clean_text(option.get("name")).lower() not in {"color", "colour"}:
                continue
            values = option.get("values")
            if isinstance(values, list):
                colors.extend(_clean_text(value) for value in values)
    return sorted(_dedupe(colors), key=str.casefold)


def _shopify_price_range(raws: Sequence[Mapping[str, Any]]) -> tuple[float, float]:
    prices: list[float] = []
    for raw in raws:
        variants = raw.get("variants")
        if not isinstance(variants, list):
            continue
        for variant in variants:
            if not isinstance(variant, Mapping):
                continue
            current = _price(variant.get("price"))
            compare_value = variant.get("compare_at_price")
            regular = current if compare_value in {None, ""} else max(
                current, _price(compare_value)
            )
            prices.append(regular)
    if not prices:
        raise CatalogSourceError("Shopify style has no variant list prices")
    return min(prices), max(prices)


def _shopify_categories(
    raws: Sequence[Mapping[str, Any]],
) -> tuple[list[str], dict[str, str]]:
    sources: dict[str, str] = {}
    for raw in raws:
        product_type = _clean_text(raw.get("product_type"))
        for value in product_type.split(","):
            category = _slug(value)
            if category:
                sources.setdefault(category, "official_shopify_product_type")
        for prefix, source_name in (
            ("type:", "official_shopify_tag:type"),
            ("subtype:", "official_shopify_tag:subtype"),
        ):
            for value in _tag_values(raw, prefix):
                category = _slug(value)
                if category:
                    sources[category] = source_name
    return sorted(sources), {key: sources[key] for key in sorted(sources)}


def normalize_shopify_style(
    source: ShopifySourceConfig,
    official_id: str,
    raws: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    if not raws:
        raise CatalogSourceError(f"{source.label} style {official_id} has no rows")
    names = Counter(_clean_text(raw.get("title")) for raw in raws)
    names.pop("", None)
    if not names:
        raise CatalogSourceError(f"{source.label} style {official_id} has no name")
    most_common_count = max(names.values())
    name = min(
        (value for value, count in names.items() if count == most_common_count),
        key=str.casefold,
    )
    price_min, price_max = _shopify_price_range(raws)
    categories, category_sources = _shopify_categories(raws)
    if not categories:
        raise CatalogSourceError(f"{source.label} style {official_id} has no category")
    colors = _shopify_colors(raws)
    primary_colors = sorted(
        _dedupe(
            _clean_text(value)
            for raw in raws
            for value in _tag_values(raw, "colour:")
        ),
        key=str.casefold,
    )
    seasons = sorted(
        {
            match.upper()
            for raw in raws
            for value in _tag_values(raw, "season:")
            for match in SEASON_RE.findall(value)
        },
        key=lambda value: (value[1:], value[0]),
    )
    source_candidates = [
        row for row in raws if _clean_text(row.get("title")) == name
    ]
    source_row = min(
        source_candidates,
        key=lambda row: (
            not any(
                isinstance(variant, Mapping) and variant.get("available") is True
                for variant in (
                    row.get("variants") if isinstance(row.get("variants"), list) else []
                )
            ),
            -max(
                (
                    int(match[1:])
                    for value in _tag_values(row, "season:")
                    for match in SEASON_RE.findall(value.upper())
                ),
                default=-1,
            ),
            _clean_text(row.get("handle")),
        ),
    )
    return _finalize_product(
        {
            "catalog_product_id": _catalog_product_id(source.brand_key, official_id),
            "brand_key": source.brand_key,
            "official_product_id": official_id,
            "brand": source.label,
            "catalog_scope": CATALOG_SCOPE,
            "market": source.market,
            "country": source.country,
            "language": "en",
            "name": name,
            "gender": _shopify_gender(source, raws),
            "collection": None,
            "categories": categories,
            "category_sources": category_sources,
            "list_price": price_min,
            "list_price_max": price_max,
            "currency": source.currency,
            "color_names": colors,
            "primary_colors": primary_colors,
            "season_codes": seasons,
            "source_name": source.source_name,
            "source_url": _shopify_product_url(source, source_row.get("handle")),
        }
    )


def collect_shopify_catalog(
    client: CatalogClient,
    source: ShopifySourceConfig,
    *,
    limit: int | None = None,
    product_ids: Sequence[str] = (),
) -> tuple[list[dict[str, Any]], bool]:
    rows: list[dict[str, Any]] = []
    seen_shopify_ids: set[str] = set()
    terminated = False
    for page in range(1, MAX_SHOPIFY_PAGES + 1):
        page_rows = client.fetch_shopify_page(source, page)
        if len(page_rows) > SHOPIFY_PAGE_SIZE:
            raise CatalogSourceError(
                f"{source.label} page {page} exceeded {SHOPIFY_PAGE_SIZE} rows"
            )
        if page == 1 and not page_rows:
            raise CatalogSourceError(f"{source.label} official collection is empty")
        for raw in page_rows:
            shopify_id = _clean_text(raw.get("id"))
            if not shopify_id or shopify_id in seen_shopify_ids:
                raise CatalogSourceError(
                    f"{source.label} duplicate or missing Shopify product ID: {shopify_id!r}"
                )
            seen_shopify_ids.add(shopify_id)
            rows.append(raw)
        if len(page_rows) < SHOPIFY_PAGE_SIZE:
            terminated = True
            break
    if not terminated:
        raise CatalogSourceError(
            f"{source.label} pagination did not terminate within {MAX_SHOPIFY_PAGES} pages"
        )
    if not source.min_raw_rows <= len(rows) <= source.max_raw_rows:
        raise CatalogSourceError(
            f"implausible {source.label} raw count: {len(rows)} "
            f"(expected {source.min_raw_rows}..{source.max_raw_rows})"
        )
    full_price_rows = [row for row in rows if source.full_price_selector(row)]
    if not source.min_full_price_rows <= len(full_price_rows) <= source.max_full_price_rows:
        raise CatalogSourceError(
            f"implausible {source.label} full-price row count: {len(full_price_rows)} "
            f"(expected {source.min_full_price_rows}..{source.max_full_price_rows})"
        )
    grouped: dict[str, list[dict[str, Any]]] = {}
    unidentified: list[Mapping[str, Any]] = []
    for raw in full_price_rows:
        official_id = _shopify_style_id(source, raw)
        if official_id is None:
            unidentified.append(raw)
            continue
        grouped.setdefault(official_id, []).append(raw)
    if unidentified:
        allowed = max(1, int(len(full_price_rows) * MAX_UNIDENTIFIED_STYLE_RATIO))
        details = "; ".join(
            f"{_clean_text(raw.get('id'))} {_clean_text(raw.get('title'))!r}"
            for raw in unidentified
        )
        if len(unidentified) > allowed:
            raise CatalogSourceError(
                f"{source.label} has {len(unidentified)} full-price rows without a "
                f"provable style ID (allowed {allowed}): {details}"
            )
        print(
            f"[catalog] WARN: {source.label} skipped {len(unidentified)} full-price "
            f"rows without a provable style ID: {details}",
            file=sys.stderr,
        )
    if not source.min_styles <= len(grouped) <= source.max_styles:
        raise CatalogSourceError(
            f"implausible {source.label} full-price style count: {len(grouped)} "
            f"(expected {source.min_styles}..{source.max_styles})"
        )
    selected_ids = sorted(grouped)
    if product_ids:
        requested_ids = {_clean_text(value).upper() for value in product_ids}
        invalid = sorted(
            value for value in requested_ids if not SHOPIFY_STYLE_ID_RE.fullmatch(value)
        )
        if invalid:
            raise ValueError(f"invalid {source.label} product IDs: {','.join(invalid)}")
        missing = sorted(requested_ids - grouped.keys())
        if missing:
            raise CatalogSourceError(
                f"requested {source.label} product IDs not found: {','.join(missing)}"
            )
        selected_ids = sorted(requested_ids)
    elif limit is not None:
        selected_ids = selected_ids[:limit]
    products = [
        normalize_shopify_style(source, official_id, grouped[official_id])
        for official_id in selected_ids
    ]
    complete = limit is None and not product_ids
    return products, complete


def _validate_scope(
    brands: Sequence[str], limit: int | None, product_ids: Mapping[str, Sequence[str]]
) -> tuple[str, ...]:
    selected = tuple(dict.fromkeys(brands))
    if not selected or any(brand not in BRAND_KEYS for brand in selected):
        raise ValueError("brands must be a non-empty subset of arcteryx,burton,patagonia")
    if limit is not None and limit < 1:
        raise ValueError("limit must be at least 1")
    if limit is not None and any(product_ids.values()):
        raise ValueError("limit and product IDs are mutually exclusive")
    unknown_scopes = sorted(set(product_ids) - set(BRAND_KEYS))
    if unknown_scopes:
        raise ValueError(f"unsupported product ID brand scopes: {','.join(unknown_scopes)}")
    return selected


def collect_catalogs(
    client: CatalogClient,
    *,
    brands: Sequence[str] = BRAND_KEYS,
    limit: int | None = None,
    product_ids: Mapping[str, Sequence[str]] | None = None,
    arcteryx_genders: Sequence[str] = ARCTERYX_GENDERS,
    arcteryx_categories: Sequence[str] = ARCTERYX_PRIMARY_CATEGORIES,
    enrich_arcteryx_categories: bool = True,
) -> tuple[list[dict[str, Any]], set[str]]:
    requested_ids = product_ids or {}
    selected = _validate_scope(brands, limit, requested_ids)
    products: list[dict[str, Any]] = []
    complete_brands: set[str] = set()
    for brand in selected:
        if brand == "arcteryx":
            brand_products, complete = collect_arcteryx_catalog(
                client,
                genders=arcteryx_genders,
                categories=arcteryx_categories,
                enrich_categories=enrich_arcteryx_categories,
                limit=limit,
                product_ids=requested_ids.get(brand, ()),
            )
        else:
            brand_products, complete = collect_shopify_catalog(
                client,
                SHOPIFY_SOURCES[brand],
                limit=limit,
                product_ids=requested_ids.get(brand, ()),
            )
        products.extend(brand_products)
        if complete:
            complete_brands.add(brand)
    identifiers = [product["catalog_product_id"] for product in products]
    if len(identifiers) != len(set(identifiers)):
        raise CatalogSourceError("duplicate catalog_product_id across official sources")
    return sorted(products, key=lambda row: row["catalog_product_id"]), complete_brands


def empty_state() -> dict[str, Any]:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "source": SOURCE_NAME,
        "last_run": None,
        "products": [],
        "snapshots": [],
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return empty_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogSourceError(f"cannot read state file {path}: {exc}") from exc
    if (
        state.get("schema_version") != STATE_SCHEMA_VERSION
        or state.get("source") != SOURCE_NAME
    ):
        raise CatalogSourceError(f"unsupported catalog state in {path}")
    if not isinstance(state.get("products"), list) or not isinstance(
        state.get("snapshots"), list
    ):
        raise CatalogSourceError(f"malformed catalog state in {path}")
    return state


def merge_catalog_state(
    previous: Mapping[str, Any],
    observed_products: Sequence[Mapping[str, Any]],
    *,
    observed_at: str,
    requested_brands: Sequence[str],
    complete_brands: set[str],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    selected_brands = set(requested_brands)
    if not selected_brands or not selected_brands.issubset(BRAND_KEYS):
        raise ValueError("requested_brands must be a non-empty supported subset")
    if not complete_brands.issubset(selected_brands):
        raise ValueError("complete_brands must be a subset of requested_brands")
    previous_products = {
        row.get("catalog_product_id"): dict(row)
        for row in previous.get("products", [])
        if isinstance(row, Mapping) and row.get("catalog_product_id")
    }
    next_products: dict[str, dict[str, Any]] = {}
    new_snapshots: list[dict[str, Any]] = []
    known_snapshot_keys = {
        (row.get("catalog_product_id"), row.get("source_hash"))
        for row in previous.get("snapshots", [])
        if isinstance(row, Mapping)
    }
    observed_ids: set[str] = set()
    observed_counts = {brand: 0 for brand in requested_brands}
    for observed in observed_products:
        product = dict(observed)
        catalog_id = product.get("catalog_product_id")
        brand_key = product.get("brand_key")
        if catalog_id in observed_ids:
            raise CatalogSourceError(f"duplicate observed catalog product: {catalog_id}")
        if brand_key not in selected_brands:
            raise CatalogSourceError(
                f"observed product {catalog_id} is outside requested brands"
            )
        observed_ids.add(catalog_id)
        observed_counts[brand_key] += 1
        old = previous_products.get(catalog_id, {})
        product.update(
            {
                "first_seen_at": old.get("first_seen_at") or observed_at,
                "last_seen_at": observed_at,
                "last_changed_at": (
                    old.get("last_changed_at")
                    if old.get("source_hash") == product.get("source_hash")
                    and old.get("last_changed_at")
                    else observed_at
                ),
                "status": "active",
                "missing_runs": 0,
            }
        )
        next_products[catalog_id] = product
        snapshot_key = (catalog_id, product["source_hash"])
        if snapshot_key not in known_snapshot_keys:
            snapshot = {key: product[key] for key in FACTUAL_KEYS}
            snapshot["source_hash"] = product["source_hash"]
            snapshot["observed_at"] = observed_at
            new_snapshots.append(snapshot)
            known_snapshot_keys.add(snapshot_key)

    for catalog_id, old in previous_products.items():
        if catalog_id in next_products:
            continue
        preserved = dict(old)
        brand_key = preserved.get("brand_key")
        if brand_key in complete_brands:
            missing_runs = int(preserved.get("missing_runs") or 0) + 1
            preserved["missing_runs"] = missing_runs
            preserved["status"] = (
                "inactive"
                if missing_runs >= MISSING_RUNS_BEFORE_INACTIVE
                else "missing"
            )
        next_products[catalog_id] = preserved

    authoritative = set(BRAND_KEYS) == complete_brands == selected_brands
    state = {
        "schema_version": STATE_SCHEMA_VERSION,
        "source": SOURCE_NAME,
        "last_run": {
            "observed_at": observed_at,
            "requested_brands": list(requested_brands),
            "complete_brands": sorted(complete_brands),
            "authoritative": authoritative,
            "observed_counts": observed_counts,
            "observed_count": len(observed_products),
        },
        "products": sorted(
            next_products.values(), key=lambda row: row["catalog_product_id"]
        ),
        "snapshots": sorted(
            [
                *(
                    dict(row)
                    for row in previous.get("snapshots", [])
                    if isinstance(row, Mapping)
                ),
                *new_snapshots,
            ],
            key=lambda row: (
                row.get("observed_at", ""),
                row.get("catalog_product_id", ""),
                row.get("source_hash", ""),
            ),
        ),
    }
    return state, new_snapshots


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def _pages(table: Any, columns: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, 50_001, 1000):
        response = table.select(columns).range(offset, offset + 999).execute()
        page = response.data or []
        rows.extend(page)
        if len(page) < 1000:
            break
    return rows


def sync_to_supabase(
    state: Mapping[str, Any],
    new_snapshots: Sequence[Mapping[str, Any]],
    *,
    authoritative: bool,
    batch_size: int = 100,
) -> dict[str, int]:
    """Explicit service-role sync; never runs without --sync-supabase."""

    last_run = state.get("last_run") or {}
    if not authoritative or last_run.get("authoritative") is not True:
        raise CatalogSourceError(
            "Supabase sync requires a complete authoritative three-brand run"
        )
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url or not key:
        raise CatalogSourceError(
            "SUPABASE_URL and SUPABASE_KEY are required for --sync-supabase"
        )
    try:
        from supabase import create_client
    except ImportError as exc:
        raise CatalogSourceError(
            "install requirements.txt before syncing to Supabase"
        ) from exc
    client = create_client(url, key)
    existing_rows = _pages(
        client.table("catalog_products"),
        "catalog_product_id,first_seen_at,last_changed_at,last_seen_at,source_hash,status,missing_runs",
    )
    existing = {row["catalog_product_id"]: row for row in existing_rows}
    observed_at = last_run.get("observed_at") or utc_now()
    current_rows: list[dict[str, Any]] = []
    for raw in state.get("products", []):
        if not isinstance(raw, Mapping) or raw.get("status") != "active":
            continue
        row = dict(raw)
        old = existing.get(row["catalog_product_id"], {})
        row["first_seen_at"] = (
            old.get("first_seen_at") or row.get("first_seen_at") or observed_at
        )
        row["last_changed_at"] = (
            old.get("last_changed_at")
            if old.get("source_hash") == row.get("source_hash")
            and old.get("last_changed_at")
            else row.get("last_changed_at") or observed_at
        )
        row["updated_at"] = observed_at
        current_rows.append(row)
    for start in range(0, len(current_rows), batch_size):
        client.table("catalog_products").upsert(
            current_rows[start : start + batch_size], on_conflict="catalog_product_id"
        ).execute()
    seen = {row["catalog_product_id"] for row in current_rows}
    lifecycle_groups: dict[tuple[str, int], list[str]] = {}
    for catalog_id, old in existing.items():
        if catalog_id in seen:
            continue
        missing_runs = int(old.get("missing_runs") or 0) + 1
        status = (
            "inactive"
            if missing_runs >= MISSING_RUNS_BEFORE_INACTIVE
            else "missing"
        )
        lifecycle_groups.setdefault((status, missing_runs), []).append(catalog_id)
    for (status, missing_runs), identifiers in lifecycle_groups.items():
        for start in range(0, len(identifiers), batch_size):
            client.table("catalog_products").update(
                {"status": status, "missing_runs": missing_runs}
            ).in_(
                "catalog_product_id", identifiers[start : start + batch_size]
            ).execute()
    snapshot_rows = [dict(row) for row in new_snapshots]
    for start in range(0, len(snapshot_rows), batch_size):
        client.table("catalog_product_snapshots").upsert(
            snapshot_rows[start : start + batch_size],
            on_conflict="catalog_product_id,source_hash",
            ignore_duplicates=True,
        ).execute()
    return {
        "current_upserted": len(current_rows),
        "snapshots_inserted_or_skipped": len(snapshot_rows),
        "existing_loaded": len(existing_rows),
    }


def _parse_scoped_product_ids(values: Sequence[str]) -> dict[str, list[str]]:
    parsed: dict[str, list[str]] = {}
    for value in values:
        brand, separator, official_id = value.partition(":")
        brand = brand.lower().strip()
        official_id = official_id.strip()
        if not separator or brand not in BRAND_KEYS or not official_id:
            raise ValueError(
                f"product ID must use brand:official-id syntax: {value!r}"
            )
        parsed.setdefault(brand, []).append(official_id)
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--state",
        type=Path,
        default=Path(__file__).resolve().parent / "data" / "catalog_state.json",
        help="append-safe local state file",
    )
    parser.add_argument("--output", type=Path, help="optional current-products export")
    parser.add_argument(
        "--brand",
        choices=BRAND_KEYS,
        action="append",
        help="repeat to select brands; defaults to all three",
    )
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument(
        "--limit",
        type=int,
        help="partial-run limit per brand; disables authoritative reconciliation",
    )
    scope.add_argument(
        "--product-id",
        action="append",
        help="repeat brand:official-id; disables authoritative reconciliation",
    )
    parser.add_argument(
        "--gender",
        choices=ARCTERYX_GENDERS,
        action="append",
        help="repeat to limit Arc'teryx gender scope",
    )
    parser.add_argument(
        "--category",
        choices=ARCTERYX_PRIMARY_CATEGORIES,
        action="append",
        help="repeat to override Arc'teryx category enrichment",
    )
    parser.add_argument("--skip-category-enrichment", action="store_true")
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument(
        "--dry-run", action="store_true", help="validate without local or remote writes"
    )
    parser.add_argument(
        "--sync-supabase",
        action="store_true",
        help="service-role sync after a complete three-brand run",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.dry_run and args.sync_supabase:
        print(
            "[catalog] --dry-run and --sync-supabase cannot be combined",
            file=sys.stderr,
        )
        return 2
    brands = tuple(args.brand or BRAND_KEYS)
    try:
        scoped_ids = _parse_scoped_product_ids(tuple(args.product_id or ()))
        if not set(scoped_ids).issubset(brands):
            raise ValueError("every product ID brand must also be selected with --brand")
        client = CatalogClient(
            delay=args.delay, retries=args.retries, timeout=args.timeout
        )
        observed_at = utc_now()
        products, complete_brands = collect_catalogs(
            client,
            brands=brands,
            limit=args.limit,
            product_ids=scoped_ids,
            arcteryx_genders=tuple(args.gender or ARCTERYX_GENDERS),
            arcteryx_categories=tuple(
                args.category or ARCTERYX_PRIMARY_CATEGORIES
            ),
            enrich_arcteryx_categories=not args.skip_category_enrichment,
        )
        previous = load_state(args.state)
        state, new_snapshots = merge_catalog_state(
            previous,
            products,
            observed_at=observed_at,
            requested_brands=brands,
            complete_brands=complete_brands,
        )
    except (CatalogSourceError, ValueError) as exc:
        print(f"[catalog] ERROR: {exc}", file=sys.stderr)
        return 1
    counts = Counter(product["brand_key"] for product in products)
    categorized = sum(bool(product["categories"]) for product in products)
    authoritative = state["last_run"]["authoritative"]
    print(
        f"[catalog] observed={len(products)} by_brand={dict(sorted(counts.items()))} "
        f"categorized={categorized} new_snapshots={len(new_snapshots)} "
        f"complete_brands={','.join(sorted(complete_brands)) or 'none'} "
        f"authoritative={str(authoritative).lower()}"
    )
    if args.dry_run:
        print("[catalog] dry-run: no files or remote tables changed")
        return 0
    write_json(args.state, state)
    if args.output:
        write_json(
            args.output,
            {
                "schema_version": STATE_SCHEMA_VERSION,
                "source": SOURCE_NAME,
                "observed_at": observed_at,
                "products": products,
            },
        )
    print(f"[catalog] state={args.state}")
    if args.sync_supabase:
        try:
            result = sync_to_supabase(
                state, new_snapshots, authoritative=authoritative
            )
        except Exception as exc:  # noqa: BLE001 - normalize client failures at CLI boundary
            print(f"[catalog] SYNC ERROR: {exc}", file=sys.stderr)
            return 1
        print(f"[catalog] supabase={json.dumps(result, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
