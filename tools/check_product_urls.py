#!/usr/bin/env python3
"""Revalidate missing product URLs and persist durable HTTP health state."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests


def product_identity(url: str) -> tuple[str, str]:
    parts = [part for part in urlparse(url).path.lower().split("/") if part]
    region = parts[0] if len(parts) >= 4 and len(parts[0]) == 2 else ""
    slug = parts[-1] if parts else ""
    return region, slug


def classify_url(url: str, timeout: float = 15.0) -> tuple[int | None, str, str]:
    try:
        response = requests.get(
            url,
            allow_redirects=True,
            timeout=timeout,
            headers={"User-Agent": "Mozilla/5.0 (compatible; GearDropLinkHealth/1.0)"},
        )
    except requests.RequestException as exc:
        return None, "transient", str(exc)

    status = response.status_code
    if status in {404, 410}:
        return status, "unavailable", response.url
    if status in {403, 429} or status >= 500:
        return status, "transient", response.url
    if status != 200:
        return status, "transient", response.url

    expected_region, expected_slug = product_identity(url)
    final_region, final_slug = product_identity(response.url)
    if expected_slug and final_slug != expected_slug:
        return status, "unavailable", response.url
    if expected_region and final_region and final_region != expected_region:
        return status, "transient", response.url
    return status, "active", response.url


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="append", choices=["active", "missing", "inactive", "unavailable"])
    parser.add_argument(
        "--stored-http-status",
        action="append",
        type=int,
        choices=[404, 410],
        help="Only recheck rows whose persisted URL result matches this status",
    )
    parser.add_argument("--max-rows", type=int, default=500)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")
    if not base_url or not key:
        print("[url-check] SUPABASE_URL and SUPABASE_KEY are required", file=sys.stderr)
        return 2

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    statuses = ",".join(args.status or ["missing"])
    query = {
        "select": "sku_id,url,status,url_http_status,url_checked_at",
        "dealer": "eq.arcteryx_outlet",
        "status": f"in.({statuses})",
        "url": "not.is.null",
        "order": "url_checked_at.asc.nullsfirst",
        "limit": str(args.max_rows),
    }
    if args.stored_http_status:
        stored = ",".join(str(value) for value in sorted(set(args.stored_http_status)))
        query["url_http_status"] = f"in.({stored})"
    response = requests.get(
        f"{base_url}/rest/v1/products",
        params=query,
        headers=headers,
        timeout=45,
    )
    response.raise_for_status()
    rows = response.json()
    now = datetime.now(timezone.utc).isoformat()
    counts = {"active": 0, "unavailable": 0, "transient": 0}

    for row in rows:
        http_status, verdict, final_url = classify_url(row["url"], args.timeout)
        counts[verdict] += 1
        print(f"[url-check] {row['sku_id']} http={http_status} verdict={verdict} final={final_url}")
        if args.dry_run:
            continue
        payload = {"url_http_status": http_status, "url_checked_at": now}
        if verdict == "unavailable":
            payload["status"] = "unavailable"
        elif row.get("status") == "active":
            payload["status"] = "active"
        patch = requests.patch(
            f"{base_url}/rest/v1/products",
            params={"sku_id": f"eq.{row['sku_id']}"},
            headers={**headers, "Prefer": "return=minimal"},
            json=payload,
            timeout=45,
        )
        patch.raise_for_status()

    print(f"[url-check] checked={len(rows)} counts={counts} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
