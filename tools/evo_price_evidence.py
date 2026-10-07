"""Independent, read-only evidence from EVO's raw official Shopify payload.

This module deliberately imports no production dealer fetcher or price selector.
It enumerates complete purchasable variant rows with Decimal arithmetic.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from urllib.parse import urlsplit


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def evo_js_url(url: str) -> str:
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in {"evo.com", "www.evo.com"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in {None, 443}
    ):
        raise ValueError("not an official EVO product URL")
    match = re.fullmatch(r"/products/([a-zA-Z0-9_-]+)(?:\.js)?/?", parsed.path)
    if not match:
        raise ValueError("not an official EVO product URL")
    return f"https://www.evo.com/products/{match.group(1)}.js"


def _positive_integer(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal, str)):
        return None
    if isinstance(value, str) and not re.fullmatch(r"\+?[0-9]+", value.strip()):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number <= 0 or number != number.to_integral_value():
        return None
    if number.adjusted() > 310 or not math.isfinite(float(number / 100)):
        return None
    return int(number)


def _dollars_to_cents(value) -> int | None:
    if value is None or isinstance(value, (bool, dict, list)):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite() or number.adjusted() > 308:
        return None
    with localcontext() as context:
        context.prec = max(28, len(number.as_tuple().digits) + 2)
        return _positive_integer(number * 100)


def _json_value(value):
    if isinstance(value, Decimal) or (isinstance(value, float) and not math.isfinite(value)):
        return str(value)
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    return value


def parse_evo_official_read(
    raw: bytes,
    source_url: str,
    *,
    read_at_utc: str | None = None,
) -> dict:
    """Enumerate independently; absence of variant evidence stays unverifiable."""
    evidence = {
        "source_kind": "official_shopify_js",
        "source_url": evo_js_url(source_url),
        "read_at_utc": read_at_utc or _utc_now(),
        "raw_sha256": hashlib.sha256(raw).hexdigest(),
        "pair_exists": False,
        "sale_is_available_minimum": False,
    }

    def error(reason: str) -> dict:
        return {"_err": reason, "evo_evidence": evidence}

    try:
        product = json.loads(raw.decode("utf-8"), parse_float=Decimal, parse_constant=Decimal)
    except (UnicodeDecodeError, ValueError):
        return error("evo_invalid_official_json")
    if not isinstance(product, dict):
        return error("evo_invalid_product")
    evidence.update({"product_id": _json_value(product.get("id")), "handle": product.get("handle")})
    expected_handle = urlsplit(evidence["source_url"]).path.removeprefix("/products/").removesuffix(".js")
    if product.get("handle") and product["handle"] != expected_handle:
        return error("evo_product_handle_mismatch")
    if product.get("available") is False:
        return error("official_unavailable")
    variants = product.get("variants")
    if variants is None or variants == []:
        return error("evo_no_variant_evidence")
    if not isinstance(variants, list):
        return error("evo_malformed_variants")

    eligible = []
    available_count = 0
    invalid_sale_count = 0
    unknown_availability_count = 0
    for index, variant in enumerate(variants):
        if not isinstance(variant, dict) or (
            variant.get("available") is not True and variant.get("available") is not False
        ):
            unknown_availability_count += 1
            continue
        if variant.get("available") is not True:
            continue
        available_count += 1
        sale = _positive_integer(variant.get("price"))
        if sale is None:
            invalid_sale_count += 1
            continue
        original = _positive_integer(variant.get("compare_at_price"))
        if variant.get("compare_at_price") is None:
            reason = "missing_compare_fallback"
        elif original is None:
            reason = "invalid_compare_fallback"
        elif original < sale:
            reason = "compare_below_sale_fallback"
        else:
            reason = "compare_at_price"
        if reason != "compare_at_price":
            original = sale
        eligible.append({
            "variant_id": _json_value(variant.get("id")),
            "variant_index": index,
            "available": True,
            "raw_price_cents": _json_value(variant.get("price")),
            "raw_compare_at_price_cents": _json_value(variant.get("compare_at_price")),
            "sale_cents": sale,
            "original_cents": original,
            "normalization_reason": reason,
            "compare_fallback": reason != "compare_at_price",
        })
    evidence.update({
        "variant_count": len(variants),
        "available_variant_count": available_count,
        "valid_available_variant_count": len(eligible),
        "excluded_invalid_sale_count": invalid_sale_count,
        "unknown_availability_count": unknown_availability_count,
        "available_variants": eligible,
    })
    if not eligible:
        if not available_count and not unknown_availability_count:
            return error("official_unavailable")
        return error("evo_no_valid_available_sale")

    ordered = sorted(eligible, key=lambda item: (item["sale_cents"], item["original_cents"]))
    selected = ordered[0]
    sale = selected["sale_cents"]
    original = selected["original_cents"]
    evidence.update({
        **selected,
        "minimum_available_sale_cents": sale,
        "minimum_sale_pairs": [
            list(pair) for pair in sorted({
                (item["sale_cents"], item["original_cents"])
                for item in eligible if item["sale_cents"] == sale
            })
        ],
        "pair_exists": any(
            (item["sale_cents"], item["original_cents"]) == (sale, original)
            for item in eligible
        ),
        "sale_is_available_minimum": all(sale <= item["sale_cents"] for item in eligible),
    })
    discount = ((Decimal(original) - sale) * 100 / original).quantize(
        Decimal(1), rounding=ROUND_HALF_EVEN
    )
    return {
        "sale_price": float(Decimal(sale) / 100),
        "original_price": float(Decimal(original) / 100),
        "discount_pct": int(discount),
        "evo_evidence": evidence,
    }


def fetch_evo_official_read(url: str, session=None) -> dict:
    """Read raw .js without a production parser, browser, or write credential."""
    try:
        source_url = evo_js_url(url)
    except (TypeError, ValueError):
        return {"_err": "evo_invalid_product_url"}
    if session is None:
        import requests

        session = requests.Session()
    try:
        response = session.get(
            source_url,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=20,
            allow_redirects=False,
        )
    except Exception as exc:  # noqa: BLE001 - Source failures must not expose transport details.
        return {"_err": f"evo_http {type(exc).__name__}"}
    if response.status_code != 200:
        return {"_err": f"evo_http {response.status_code}"}
    return parse_evo_official_read(response.content, source_url)


def check_evo_output_pair(official: dict, output: dict) -> dict:
    """Prove a candidate pair's membership, minimum sale, and canonical choice."""
    evidence = official.get("evo_evidence") or {}
    if not isinstance(evidence, dict):
        evidence = {}
    variants = evidence.get("available_variants") or []
    if not isinstance(variants, list):
        variants = []
    sale = _dollars_to_cents(output.get("sale_price"))
    original = _dollars_to_cents(output.get("original_price"))
    matching = [
        item for item in variants
        if isinstance(item, dict) and item.get("available") is True
        and sale is not None and original is not None
        and (item.get("sale_cents"), item.get("original_cents")) == (sale, original)
    ]
    return {
        "pair_exists": bool(matching),
        "sale_is_available_minimum": sale is not None
        and sale == evidence.get("minimum_available_sale_cents"),
        "matches_canonical_pair": sale is not None and original is not None
        and (sale, original) == (evidence.get("sale_cents"), evidence.get("original_cents")),
        "matching_variant_ids": [item["variant_id"] for item in matching],
        "normalization_reasons": sorted({item["normalization_reason"] for item in matching}),
    }


def has_evo_variant_evidence(official: dict) -> bool:
    evidence = official.get("evo_evidence") or {}
    if not isinstance(evidence, dict):
        return False
    proof = check_evo_output_pair(official, official)
    return (
        evidence.get("source_kind") == "official_shopify_js"
        and bool(evidence.get("source_url"))
        and bool(evidence.get("read_at_utc"))
        and bool(re.fullmatch(r"[a-f0-9]{64}", str(evidence.get("raw_sha256", ""))))
        and evidence.get("pair_exists") is True
        and evidence.get("sale_is_available_minimum") is True
        and proof["pair_exists"]
        and proof["sale_is_available_minimum"]
        and proof["matches_canonical_pair"]
    )
