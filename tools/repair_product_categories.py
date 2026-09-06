#!/usr/bin/env python3
"""Recompute derived dealer categories without changing prices or freshness.

Defaults to a public read-only plan. --apply requires the existing server's
service credential and uses compare-and-set to avoid overwriting a newer row.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dealers.source_registry import ACTIVE_DEALERS
from supabase_sync import infer_category
from tools.check_official_catalog import public_config

SELECT = "sku_id,dealer,category,full_name,url,last_updated"


def load_rows(url: str, key: str, *, session=requests) -> list[dict]:
    rows = []
    for offset in range(0, 50000, 1000):
        response = session.get(
            f"{url}/rest/v1/products",
            params={"select": SELECT, "dealer": f"in.({','.join(ACTIVE_DEALERS)})", "status": "eq.active", "order": "sku_id.asc"},
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{offset}-{offset + 999}"},
            timeout=45,
        )
        response.raise_for_status()
        page = response.json()
        if not isinstance(page, list):
            raise ValueError("category source response is not a list")
        rows.extend(page)
        if len(page) < 1000:
            return rows
    raise ValueError("category source exceeded the safety bound")


def plan_repairs(rows: list[dict]) -> list[dict]:
    repairs = []
    for row in rows:
        if row.get("dealer") not in ACTIVE_DEALERS or not row.get("sku_id"):
            continue
        category = infer_category(row.get("full_name"), row.get("url"))
        if category != "其他" and category != row.get("category"):
            repairs.append({"before": row, "category": category})
    return repairs


def patch_category(url: str, key: str, repair: dict, *, session=requests) -> bool:
    before = repair["before"]
    params = {"sku_id": f"eq.{before['sku_id']}", "status": "eq.active", "select": SELECT}
    for field in ("category", "full_name", "url", "last_updated"):
        value = before.get(field)
        params[field] = "is.null" if value is None else f"eq.{value}"
    response = session.patch(
        f"{url}/rest/v1/products", params=params,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=representation"},
        json={"category": repair["category"]}, timeout=45,
    )
    response.raise_for_status()
    result = response.json()
    if not result:
        return False  # Another update won; next run can reassess it.
    if len(result) != 1 or result[0].get("sku_id") != before["sku_id"] or result[0].get("category") != repair["category"]:
        raise ValueError("category update returned unexpected rows")
    if result[0].get("last_updated") != before.get("last_updated"):
        raise ValueError("category update unexpectedly changed freshness")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", type=Path, required=True, help="Save exact before values and the proposed categories")
    args = parser.parse_args()
    url, anon = public_config(ROOT / "product-detail.html")
    key = os.environ.get("SUPABASE_KEY") if args.apply else anon
    if not key:
        parser.error("--apply requires SUPABASE_KEY")
    if args.apply and os.environ.get("SUPABASE_URL", url).rstrip("/") != url:
        parser.error("write target must match the public readback target")
    repairs = plan_repairs(load_rows(url, anon))
    args.report.write_text(json.dumps(repairs, ensure_ascii=False, indent=2) + "\n")
    print(f"[repair-categories] planned={len(repairs)} report={args.report} apply={args.apply}")
    if not args.apply:
        return 0
    applied = []
    skipped = 0
    for repair in repairs:
        if patch_category(url, key, repair):
            applied.append(repair)
        else:
            skipped += 1
    observed = {row["sku_id"]: row for row in load_rows(url, anon)}
    errors = []
    for repair in applied:
        row = observed.get(repair["before"]["sku_id"])
        # Concurrent fresh source writes are evaluated by their current names.
        if not row or row.get("category") != infer_category(row.get("full_name"), row.get("url")):
            errors.append(repair["before"]["sku_id"])
    print(f"[repair-categories] applied={len(applied)} concurrent_skipped={skipped} readback_errors={len(errors)}")
    if errors:
        raise ValueError(f"category readback mismatch: {errors[:10]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
