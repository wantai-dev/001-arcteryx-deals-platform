#!/usr/bin/env python3
"""Fail closed unless the public Yearbook matches a complete fresh catalog run."""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import requests

BRAND_KEYS = ("arcteryx", "burton", "patagonia")
DEFAULT_MINIMUMS = {"arcteryx": 200, "burton": 350, "patagonia": 350}


class CatalogReadbackError(RuntimeError):
    """Raised when the public catalog does not match the completed run."""


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise CatalogReadbackError(f"timestamp requires timezone: {value!r}")
    return parsed.astimezone(timezone.utc)


def public_config(template: Path) -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    if anon and url:
        return url, anon
    source = template.read_text(encoding="utf-8")
    url_match = re.search(r"^const SUPABASE_URL\s*=\s*'([^']+)';", source, re.MULTILINE)
    anon_match = re.search(r"^const SUPABASE_ANON\s*=\s*'([^']+)';", source, re.MULTILINE)
    if not url_match or not anon_match:
        raise CatalogReadbackError(f"public Supabase config missing from {template}")
    return url_match.group(1).rstrip("/"), anon_match.group(1)


def fetch_public_rows(
    url: str, anon: str, *, session: Any = requests, page_size: int = 1000
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    headers = {"apikey": anon, "Authorization": f"Bearer {anon}"}
    for offset in range(0, 50_001, page_size):
        response = session.get(
            f"{url}/rest/v1/catalog_products",
            headers={**headers, "Range": f"{offset}-{offset + page_size - 1}"},
            params={
                "select": "catalog_product_id,brand_key,status,last_seen_at",
                "order": "catalog_product_id.asc",
            },
            timeout=30,
        )
        response.raise_for_status()
        page = response.json()
        if not isinstance(page, list):
            raise CatalogReadbackError("public catalog response is not a list")
        rows.extend(page)
        if len(page) < page_size:
            return rows
    raise CatalogReadbackError("public catalog exceeded the 50,000-row safety bound")


def verify_rows(
    rows: Sequence[Mapping[str, Any]],
    expected_state: Mapping[str, Any],
    *,
    after: datetime,
    minimums: Mapping[str, int] = DEFAULT_MINIMUMS,
) -> dict[str, Any]:
    last_run = expected_state.get("last_run") or {}
    if last_run.get("authoritative") is not True:
        raise CatalogReadbackError("expected state is not authoritative")
    if set(last_run.get("complete_brands") or ()) != set(BRAND_KEYS):
        raise CatalogReadbackError("expected state does not contain all complete brands")
    expected_ids = {
        row.get("catalog_product_id")
        for row in expected_state.get("products", ())
        if isinstance(row, Mapping) and row.get("status") == "active"
    }
    actual_ids = {row.get("catalog_product_id") for row in rows}
    if None in actual_ids or len(actual_ids) != len(rows):
        raise CatalogReadbackError("public catalog contains missing or duplicate IDs")
    nonactive = [
        str(row.get("catalog_product_id"))
        for row in rows
        if row.get("status") != "active"
    ]
    if nonactive:
        raise CatalogReadbackError(
            f"public catalog contains {len(nonactive)} non-active rows: {nonactive[:5]}"
        )
    if actual_ids != expected_ids:
        missing = sorted(expected_ids - actual_ids)[:5]
        unexpected = sorted(actual_ids - expected_ids)[:5]
        raise CatalogReadbackError(
            f"public IDs differ from completed run: missing={missing} unexpected={unexpected}"
        )
    counts = Counter(str(row.get("brand_key")) for row in rows)
    if set(counts) != set(BRAND_KEYS):
        raise CatalogReadbackError(f"public catalog brand set is incomplete: {dict(counts)}")
    for brand, minimum in minimums.items():
        if counts[brand] < minimum:
            raise CatalogReadbackError(
                f"public {brand} count {counts[brand]} is below minimum {minimum}"
            )
    stale = [
        str(row.get("catalog_product_id"))
        for row in rows
        if not row.get("last_seen_at") or parse_timestamp(str(row["last_seen_at"])) < after
    ]
    if stale:
        raise CatalogReadbackError(
            f"public catalog has {len(stale)} rows older than the sync: {stale[:5]}"
        )
    return {"rows": len(rows), "by_brand": dict(sorted(counts.items()))}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-state", type=Path, required=True)
    parser.add_argument("--after", required=True, help="UTC lower bound captured before collection")
    parser.add_argument(
        "--config-template", type=Path,
        default=Path(__file__).resolve().parent.parent / "product-detail.html",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        expected = json.loads(args.expected_state.read_text(encoding="utf-8"))
        url, anon = public_config(args.config_template)
        result = verify_rows(fetch_public_rows(url, anon), expected, after=parse_timestamp(args.after))
    except (OSError, ValueError, requests.RequestException, CatalogReadbackError) as exc:
        print(f"[catalog-readback] ERROR: {exc}")
        return 1
    print(f"[catalog-readback] OK rows={result['rows']} by_brand={result['by_brand']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
