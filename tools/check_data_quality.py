#!/usr/bin/env python3
"""Validate GearDrop multi-brand deal data before treating a sync as healthy.

Examples:
    python3 tools/check_data_quality.py --online --dealer arcteryx_outlet --max-age-hours 36
    python3 tools/check_data_quality.py --online --dealer mec --dealer rei --max-age-hours 36
    python3 tools/check_data_quality.py --file arcteryx_skus.json --dealer arcteryx_outlet
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_CONFIG_FILES = (
    ROOT / "index.html",
    ROOT / "product-detail.html",
)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dealers.brands import canonical_brand, source_contract_valid
from dealers.source_registry import RETIRED_DEALERS

SELECT = (
    "sku_id,dealer,brand,full_name,model,original_price,sale_price,discount_pct,"
    "currency,symbol,gender,region,url,status,last_seen_at,missing_runs,"
    "url_http_status,url_checked_at,last_updated,image_url,images"
)

EXPECTED_CURRENCY = {
    "us": ("USD", "$"),
    "ca": ("CAD", "C$"),
    "gb": ("GBP", "£"),
    "de": ("EUR", "€"),
    "fr": ("EUR", "€"),
    "nl": ("EUR", "€"),
    "fi": ("EUR", "€"),
    "ie": ("EUR", "€"),
    "at": ("EUR", "€"),
    "be": ("EUR", "€"),
    "it": ("EUR", "€"),
    "es": ("EUR", "€"),
    "dk": ("DKK", "kr"),
    "se": ("SEK", "kr"),
    "ch": ("CHF", "CHF"),
    "jp": ("JPY", "¥"),
    "au": ("AUD", "A$"),
}

# Full runs enforce both the caller-provided aggregate floor and the
# platform/region floors below. The two checks catch different regressions:
# a broad catalog contraction and a single collapsed source, respectively.
PLATFORM_REGION_MIN_ROWS = {
    ("arcteryx_outlet", "us"): 250,
    ("arcteryx_outlet", "ca"): 100,
    ("arcteryx_outlet", "au"): 10,
    # The European Outlet regions share one catalog (247 rows each on 2026-11-14).
    # 200 keeps roughly the same ~80% headroom as the US floor.
    **{("arcteryx_outlet", region): 200 for region in ("at", "be", "ch", "de", "dk", "es", "fi", "fr", "gb", "ie", "it", "nl", "se")},
    ("evo", "us"): 140,
    ("burton", "us"): 100,
    ("backcountry", "us"): 40,
    ("mec", "ca"): 75,
    ("rei", "us"): 40,
}

# A dealer total can stay healthy while one brand silently disappears. These
# floors keep every independently crawled brand scope fail-closed.
PLATFORM_BRAND_MIN_ROWS = {
    ("evo", "arcteryx"): 100,
    ("evo", "burton"): 20,
    ("evo", "patagonia"): 20,
    ("burton", "burton"): 100,
    ("backcountry", "burton"): 40,
}


def parse_frontend_config() -> tuple[str, str]:
    for path in FRONTEND_CONFIG_FILES:
        try:
            html = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            continue
        url = re.search(r"const SUPABASE_URL\s*=\s*'([^']+)'", html)
        anon = re.search(r"const SUPABASE_ANON\s*=\s*'([^']+)'", html)
        if url and anon:
            return url.group(1), anon.group(1)
    raise SystemExit("Could not parse Supabase config from public catalog templates")


def load_online_rows() -> list[dict]:
    try:
        import requests
    except ImportError:
        raise SystemExit("Missing dependency: requests")

    url, anon = parse_frontend_config()
    headers = {"apikey": anon, "Authorization": f"Bearer {anon}", "Accept": "application/json"}
    rows: list[dict] = []
    page = 1000
    for offset in range(0, 60000, page):
        r = requests.get(
            f"{url}/rest/v1/products",
            params={"select": SELECT, "order": "sku_id.asc"},
            headers={**headers, "Range": f"{offset}-{offset + page - 1}"},
            timeout=45,
        )
        r.raise_for_status()
        data = r.json()
        rows.extend(data)
        if len(data) < page:
            break
    return rows


def load_file_rows(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return [dict(r, dealer=r.get("dealer") or "arcteryx_outlet") for r in raw]
    if path.name == "results.json" and isinstance(raw, dict):
        out = []
        for dealer, info in (raw.get("dealers") or {}).items():
            for item in info.get("items") or []:
                out.append(dict(
                    item,
                    dealer=dealer,
                    last_updated=info.get("refreshed_at") or raw.get("generated_at"),
                ))
        return out
    raise SystemExit(f"Unsupported file shape: {path}")


def parse_ts(value) -> datetime | None:
    if not value:
        return None
    s = str(value)
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        if "T" not in s and len(s) >= 19:
            s = s[:19].replace(" ", "T") + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def num(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def calc_discount(original, sale) -> int | None:
    o = num(original)
    s = num(sale)
    if o is None or s is None or o <= 0 or s <= 0:
        return None
    if s > o:
        return 0
    return round((1 - s / o) * 100)


def url_gender(url: str) -> str | None:
    u = (url or "").lower()
    if re.search(r"/womens?/", u):
        return "women"
    if re.search(r"/mens?/", u):
        return "men"
    return None


def is_blocked_outlet_url(url: str) -> bool:
    u = (url or "").split("?", 1)[0].rstrip("/").lower()
    return bool(
        re.search(r"outlet\.arcteryx\.com/(?:[a-z]{2}/[a-z]{2}/)?shop/womens/rush-bib-pant$", u)
        or re.search(r"outlet\.arcteryx\.com/us/en/shop/womens/alpha-pant$", u)
    )


def is_expected_supported_product(row: dict) -> bool:
    """Fail closed for unknown brands and dealer-specific URL mismatches."""
    return source_contract_valid(row, row.get("dealer") or "arcteryx_outlet")


def name_gender(name: str) -> str | None:
    if re.search(r"Women'?s|\bDamen\b|\bFemme\b", name or "", re.IGNORECASE):
        return "women"
    if re.search(r"(?<!Wo)Men'?s|\bHerren\b|\bHomme\b", name or "", re.IGNORECASE):
        return "men"
    return None


def expected_currency(row: dict) -> tuple[str, str] | None:
    dealer = row.get("dealer") or "arcteryx_outlet"
    region = (row.get("region") or "").lower()
    if dealer == "mec" and region == "ca":
        return "CAD", "C$"
    if dealer in {"evo", "burton", "backcountry", "rei", "ssense"}:
        return "USD", "$"
    return EXPECTED_CURRENCY.get(region)


def product_image_urls(row: dict) -> list[str]:
    urls = [row.get("image_url"), row.get("image")]
    images = row.get("images")
    if isinstance(images, str):
        try:
            images = json.loads(images)
        except (TypeError, ValueError):
            images = []
    if isinstance(images, list):
        urls.extend(images)
    cleaned = []
    for url in urls:
        value = str(url).strip() if url is not None else ""
        if value:
            cleaned.append(value)
    return cleaned


def product_freshness_timestamp(row: dict) -> datetime | None:
    dealer = row.get("dealer") or "arcteryx_outlet"
    if dealer == "arcteryx_outlet":
        return parse_ts(row.get("last_seen_at") or row.get("last_updated"))
    return parse_ts(row.get("last_updated"))


def validate(
    rows: list[dict],
    max_age_hours: float | None,
    max_product_age_hours: float | None,
    min_rows: int,
    required_dealers: set[str] | None = None,
    forbidden_regions: set[str] | None = None,
) -> int:
    errors: dict[str, list[dict]] = defaultdict(list)
    seen = set()
    timestamps = []
    timestamps_by_dealer: dict[str, list[datetime]] = defaultdict(list)
    timestamps_by_platform_region: dict[tuple[str, str], list[datetime]] = defaultdict(list)

    active_rows = [row for row in rows if (row.get("status") or "active") == "active"]
    if required_dealers:
        retired_requested = sorted(required_dealers & RETIRED_DEALERS)
        if retired_requested:
            errors["retired_dealer_requested"].extend(
                {"dealer": dealer} for dealer in retired_requested
            )
        effective_total_min_rows = min_rows * len(required_dealers)
        if len(active_rows) < effective_total_min_rows:
            errors["too_few_rows"].append({
                "row_count": len(active_rows),
                "min_rows": min_rows,
                "effective_min_rows": effective_total_min_rows,
            })
    elif len(active_rows) < min_rows:
        errors["too_few_rows"].append({
            "row_count": len(active_rows),
            "min_rows": min_rows,
            "effective_min_rows": min_rows,
        })

    for row in rows:
        sku = row.get("sku_id")
        if not sku:
            errors["missing_sku_id"].append(row)
        elif sku in seen:
            errors["duplicate_sku_id"].append(row)
        seen.add(sku)

        sale = num(row.get("sale_price"))
        orig = num(row.get("original_price"))
        dealer = row.get("dealer") or "arcteryx_outlet"
        region = (row.get("region") or "").lower()
        if sale is None:
            errors["missing_sale_price"].append(row)
        if orig is None:
            errors["missing_original_price"].append(row)
        if sale is not None and orig is not None and sale > orig + 0.01:
            errors["sale_gt_original"].append(row)

        expected_disc = calc_discount(orig, sale)
        actual_disc = row.get("discount_pct")
        if expected_disc is not None and actual_disc is not None:
            try:
                if abs(int(actual_disc) - expected_disc) > 1:
                    errors["discount_mismatch"].append({**row, "expected_discount": expected_disc})
            except (TypeError, ValueError):
                errors["discount_parse_error"].append(row)

        expected_ccy = expected_currency(row)
        if expected_ccy:
            ccy, sym = expected_ccy
            if row.get("currency") != ccy or row.get("symbol") != sym:
                errors["currency_mismatch"].append({**row, "expected_currency": ccy, "expected_symbol": sym})

        status = row.get("status") or "active"
        if status == "active" and dealer in RETIRED_DEALERS:
            errors["retired_dealer_active"].append(row)
        image_urls = product_image_urls(row)
        has_image_contract = any(field in row for field in ("image_url", "image", "images"))
        if status == "active" and has_image_contract and not image_urls:
            errors["missing_product_image"].append(row)
        if status == "active" and any("__IMAGE_PARAMS__" in url for url in image_urls):
            errors["unresolved_image_template"].append(row)
        if status == "active" and not is_expected_supported_product(row):
            errors["unsupported_brand_product"].append(row)

        if forbidden_regions and dealer == "arcteryx_outlet" and region in forbidden_regions:
            errors["forbidden_region"].append(row)

        missing_runs = int(row.get("missing_runs") or 0)
        if dealer == "arcteryx_outlet" and status == "active" and is_blocked_outlet_url(row.get("url") or ""):
            errors["blocked_outlet_url"].append(row)
        if status not in {"active", "missing", "inactive", "unavailable"}:
            errors["invalid_product_status"].append(row)
        if status == "active" and missing_runs:
            errors["active_with_missing_runs"].append(row)
        if status == "active" and row.get("url_http_status") in {404, 410}:
            errors["active_with_dead_url"].append(row)
        if status == "active" and max_product_age_hours is not None:
            freshness_ts = product_freshness_timestamp(row)
            age_hours = ((datetime.now(timezone.utc) - freshness_ts).total_seconds() / 3600) if freshness_ts else None
            if age_hours is None or age_hours > max_product_age_hours:
                errors["stale_active_product"].append({
                    **row,
                    "age_hours": round(age_hours, 2) if age_hours is not None else None,
                    "max_age_hours": max_product_age_hours,
                })

        if dealer == "arcteryx_outlet" and region == "jp":
            if (sale is not None and sale < 1000) or (orig is not None and orig < 1000):
                errors["jpy_price_scale_suspect"].append(row)

        ug = url_gender(row.get("url") or "")
        ng = name_gender(row.get("full_name") or row.get("model") or "")
        gender = row.get("gender")
        if ug and gender and gender != "unknown" and gender != ug:
            errors["gender_url_mismatch"].append({**row, "expected_gender": ug})
        if ug and ng and ug != ng:
            errors["name_url_gender_mismatch"].append({**row, "expected_gender": ug, "name_gender": ng})

        ts = parse_ts(row.get("last_updated"))
        if status == "active":
            if ts:
                timestamps.append(ts)
                timestamps_by_dealer[row.get("dealer") or "arcteryx_outlet"].append(ts)
                timestamps_by_platform_region[(dealer, region)].append(ts)
            else:
                errors["missing_last_updated"].append(row)

    by_dealer = Counter(row.get("dealer") or "arcteryx_outlet" for row in active_rows)
    by_platform_region = Counter(
        ((row.get("dealer") or "arcteryx_outlet"), (row.get("region") or "").lower())
        for row in active_rows
    )
    by_platform_brand = Counter(
        ((row.get("dealer") or "arcteryx_outlet"), canonical_brand(row))
        for row in active_rows
        if canonical_brand(row)
    )
    if required_dealers:
        for dealer in sorted(required_dealers):
            effective_min_rows = min_rows
            if by_dealer.get(dealer, 0) == 0:
                errors["missing_dealer_rows"].append({"dealer": dealer})
            elif by_dealer.get(dealer, 0) < effective_min_rows:
                errors["dealer_below_min_rows"].append({
                    "dealer": dealer,
                    "row_count": by_dealer.get(dealer, 0),
                    "min_rows": min_rows,
                    "effective_min_rows": effective_min_rows,
                })
    else:
        for (dealer, region), minimum in sorted(PLATFORM_REGION_MIN_ROWS.items()):
            count = by_platform_region.get((dealer, region), 0)
            if count < minimum:
                errors["platform_region_below_min_rows"].append({
                    "dealer": dealer,
                    "region": region,
                    "row_count": count,
                    "min_rows": minimum,
                })

    for (dealer, brand), minimum in sorted(PLATFORM_BRAND_MIN_ROWS.items()):
        if required_dealers is not None and dealer not in required_dealers:
            continue
        count = by_platform_brand.get((dealer, brand), 0)
        if count < minimum:
            errors["platform_brand_below_min_rows"].append({
                "dealer": dealer,
                "brand": brand,
                "row_count": count,
                "min_rows": minimum,
            })

    if max_age_hours is not None and timestamps:
        latest = max(timestamps)
        age_hours = (datetime.now(timezone.utc) - latest).total_seconds() / 3600
        if age_hours > max_age_hours:
            errors["stale_latest_update"].append({
                "latest_last_updated": latest.isoformat(),
                "age_hours": round(age_hours, 2),
                "max_age_hours": max_age_hours,
            })
        for dealer, dealer_timestamps in sorted(timestamps_by_dealer.items()):
            dealer_latest = max(dealer_timestamps)
            dealer_age_hours = (datetime.now(timezone.utc) - dealer_latest).total_seconds() / 3600
            if dealer_age_hours > max_age_hours:
                errors["stale_dealer_latest_update"].append({
                    "dealer": dealer,
                    "latest_last_updated": dealer_latest.isoformat(),
                    "age_hours": round(dealer_age_hours, 2),
                    "max_age_hours": max_age_hours,
                })
        if not required_dealers:
            for dealer_region in sorted(PLATFORM_REGION_MIN_ROWS):
                slice_timestamps = timestamps_by_platform_region.get(dealer_region, [])
                dealer, region = dealer_region
                if not slice_timestamps:
                    errors["stale_platform_region_latest_update"].append({
                        "dealer": dealer,
                        "region": region,
                        "latest_last_updated": None,
                        "max_age_hours": max_age_hours,
                    })
                    continue
                latest = max(slice_timestamps)
                age_hours = (datetime.now(timezone.utc) - latest).total_seconds() / 3600
                if age_hours > max_age_hours:
                    errors["stale_platform_region_latest_update"].append({
                        "dealer": dealer,
                        "region": region,
                        "latest_last_updated": latest.isoformat(),
                        "age_hours": round(age_hours, 2),
                        "max_age_hours": max_age_hours,
                    })

    print(f"[quality] rows={len(rows)} active={len(active_rows)}")
    if timestamps:
        print(f"[quality] last_updated={min(timestamps).isoformat()} .. {max(timestamps).isoformat()}")
    print("[quality] dealers=" + ", ".join(f"{k}:{v}" for k, v in sorted(by_dealer.items())))
    print("[quality] brands=" + ", ".join(
        f"{dealer}/{brand}:{count}"
        for (dealer, brand), count in sorted(by_platform_brand.items())
    ))
    if not required_dealers:
        print("[quality] platform_regions=" + ", ".join(
            f"{dealer}/{region}:{count}"
            for (dealer, region), count in sorted(by_platform_region.items())
        ))

    if not errors:
        print("[quality] OK")
        return 0

    print("[quality] FAIL")
    for key in sorted(errors):
        sample = errors[key][:5]
        print(f"  {key}: {len(errors[key])}")
        for row in sample:
            fields = {
                k: row.get(k)
                for k in (
                    "sku_id", "dealer", "brand", "region", "currency", "symbol", "gender",
                    "expected_gender", "expected_currency", "expected_symbol",
                    "full_name", "original_price", "sale_price", "discount_pct",
                    "expected_discount", "latest_last_updated", "age_hours",
                    "max_age_hours", "status", "last_seen_at", "missing_runs",
                    "url_http_status", "url_checked_at", "last_updated", "url",
                    "image_url", "image", "images",
                )
                if k in row
            }
            if not fields:
                fields = row
            print("    " + json.dumps(fields, ensure_ascii=False))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--online", action="store_true", help="Validate production Supabase data via anon read API")
    source.add_argument("--file", type=Path, help="Validate a local JSON file")
    parser.add_argument("--dealer", action="append", default=[], help="Dealer key to include; can be repeated")
    parser.add_argument("--max-age-hours", type=float, default=None, help="Fail if newest last_updated is older")
    parser.add_argument("--max-product-age-hours", type=float, default=None, help="Fail if any active Outlet row was not seen recently")
    parser.add_argument("--min-rows", type=int, default=1)
    parser.add_argument("--forbid-region", action="append", default=[], help="Outlet region code that must not appear")
    args = parser.parse_args()

    rows = load_online_rows() if args.online else load_file_rows(args.file)
    if args.dealer:
        wanted = set(args.dealer)
        rows = [row for row in rows if (row.get("dealer") or "arcteryx_outlet") in wanted]
    return validate(
        rows,
        args.max_age_hours,
        args.max_product_age_hours,
        args.min_rows,
        set(args.dealer) if args.dealer else None,
        {r.lower() for r in args.forbid_region},
    )


if __name__ == "__main__":
    raise SystemExit(main())
