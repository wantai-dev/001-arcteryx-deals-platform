"""Select a complete EVO price pair from already available variants."""
from __future__ import annotations

import math
import re


def _positive_cents(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        cents = value
    elif isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return None
        cents = int(value)
    elif isinstance(value, str):
        value = value.strip()
        if not re.fullmatch(r"[+]?[0-9]+", value):
            return None
        try:
            cents = int(value)
        except ValueError:
            return None
    else:
        return None
    if cents <= 0:
        return None
    try:
        if not math.isfinite(cents / 100):
            return None
    except OverflowError:
        return None
    return cents


def select_variant_price(
    variants,
    *,
    price_key: str = "price",
    compare_key: str = "compare_at_price",
) -> dict | None:
    """Choose the lowest (sale, normalized original) pair in integer cents.

    The caller must first confirm availability. Invalid sale prices are
    ignored; invalid or lower compare-at prices fall back to that same sale.
    Equal pairs retain input order, and the selected variant is not copied.
    """
    try:
        candidates = iter(variants)
    except TypeError:
        return None
    best_variant = None
    best_pair = None
    for variant in candidates:
        if not isinstance(variant, dict):
            continue
        sale = _positive_cents(variant.get(price_key))
        if sale is None:
            continue
        original = _positive_cents(variant.get(compare_key))
        if original is None or original < sale:
            original = sale
        pair = (sale, original)
        if best_pair is None or pair < best_pair:
            best_variant = variant
            best_pair = pair
    if best_pair is None:
        return None
    return {
        "variant": best_variant,
        "sale_price": best_pair[0] / 100,
        "original_price": best_pair[1] / 100,
    }
