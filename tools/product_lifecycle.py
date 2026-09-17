"""Pure lifecycle rules shared by the Outlet crawler and Supabase sync."""

from __future__ import annotations

import json
from pathlib import Path

VALID_STATUSES = {"active", "missing", "inactive", "unavailable"}
INACTIVE_AFTER_MISSING_RUNS = 2
MIN_SCOPE_PRODUCTS = 10
MIN_SCOPE_RATIO = 0.70


def normalize_gender(value: str | None) -> str:
    value = (value or "").lower()
    if value in {"mens", "men"}:
        return "men"
    if value in {"womens", "women"}:
        return "women"
    return value or "*"


def scope_key(region: str | None, gender: str | None) -> tuple[str, str]:
    return (region or "").lower(), normalize_gender(gender)


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return {"generated_at": None, "scopes": {}}
    raw = json.loads(path.read_text(encoding="utf-8"))
    scopes = {}
    for scope in raw.get("scopes") or []:
        key = scope_key(scope.get("region"), scope.get("gender"))
        scopes[key] = {
            **scope,
            "urls": set(scope.get("urls") or []),
        }
    return {"generated_at": raw.get("generated_at"), "scopes": scopes}


def successful_scope(row: dict, manifest: dict) -> dict | None:
    scopes = manifest.get("scopes") or {}
    exact = scopes.get(scope_key(row.get("region"), row.get("gender")))
    wildcard = scopes.get(scope_key(row.get("region"), "*"))
    scope = exact or wildcard
    return scope if scope and scope.get("status") == "success" else None


def seen_in_successful_scope(row: dict, manifest: dict) -> bool | None:
    scope = successful_scope(row, manifest)
    if not scope:
        return None
    return row.get("url") in scope.get("urls", set())


def next_lifecycle(
    existing: dict | None,
    row: dict,
    manifest: dict,
    *,
    present_in_snapshot: bool | None = None,
) -> dict:
    existing = existing or {}
    scope = successful_scope(row, manifest)
    if present_in_snapshot is None:
        seen = row.get("url") in scope.get("urls", set()) if scope else None
    else:
        # An old SKU/color missing from the new snapshot must not stay active
        # merely because its parent product URL is still present in the list.
        seen = present_in_snapshot if scope else None
    current_status = existing.get("status") if existing.get("status") in VALID_STATUSES else "active"
    current_missing = int(existing.get("missing_runs") or 0)
    current_last_seen = existing.get("last_seen_at") or existing.get("last_updated") or row.get("last_updated")

    if seen is True:
        return {
            "status": "active",
            "missing_runs": 0,
            "last_seen_at": row.get("last_updated") or manifest.get("generated_at") or current_last_seen,
        }
    if seen is False:
        missing_runs = current_missing + 1
        return {
            "status": "inactive" if missing_runs >= INACTIVE_AFTER_MISSING_RUNS else "missing",
            "missing_runs": missing_runs,
            "last_seen_at": current_last_seen,
        }
    if not existing:
        return {
            "status": "missing",
            "missing_runs": 0,
            "last_seen_at": current_last_seen,
        }
    return {
        "status": current_status,
        "missing_runs": current_missing,
        "last_seen_at": current_last_seen,
    }


def validate_scope_counts(manifest: dict, existing_rows: list[dict]) -> list[str]:
    existing_urls: dict[tuple[str, str], set[str]] = {}
    for row in existing_rows:
        if (row.get("status") or "active") != "active" or not row.get("url"):
            continue
        key = scope_key(row.get("region"), row.get("gender"))
        existing_urls.setdefault(key, set()).add(row["url"])

    errors = []
    for key, scope in (manifest.get("scopes") or {}).items():
        if scope.get("status") != "success":
            continue
        current_count = len(scope.get("urls") or set())
        # Unisex scopes are derived from completed gender pages and may legitimately be small.
        if current_count < MIN_SCOPE_PRODUCTS and key[1] != "unisex":
            errors.append(f"{key[0]}/{key[1]} only returned {current_count} products")
            continue
        previous = existing_urls.get(key, set())
        if not previous and key[1] == "*":
            previous = {
                url
                for previous_key, urls in existing_urls.items()
                if previous_key[0] == key[0]
                for url in urls
            }
        if len(previous) >= MIN_SCOPE_PRODUCTS and current_count < len(previous) * MIN_SCOPE_RATIO:
            errors.append(
                f"{key[0]}/{key[1]} dropped from {len(previous)} to {current_count} products "
                f"({current_count / len(previous):.0%})"
            )
    return errors
