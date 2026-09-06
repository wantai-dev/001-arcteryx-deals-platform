#!/usr/bin/env python3
"""
supabase_sync.py
────────────────
Reads arcteryx_skus.json → upserts all records into Supabase `products` table.
Uses service_role key (bypasses RLS) for write access.

Usage:
    python3 supabase_sync.py                    # sync all
    python3 supabase_sync.py --dry-run          # print first 3 records, no upload
    SUPABASE_URL=... SUPABASE_KEY=... python3 supabase_sync.py
"""

import json
import os
import sys
import argparse
import re
from datetime import datetime, timezone
from pathlib import Path

from tools.product_lifecycle import (
    load_manifest,
    next_lifecycle,
    seen_in_successful_scope,
    validate_scope_counts,
)

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bupqagkrcvrezjkdbald.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

BASE_DIR  = Path(__file__).parent
SKUS_FILE = BASE_DIR / "arcteryx_skus.json"
CRAWL_MANIFEST_FILE = BASE_DIR / ".crawl_manifest.json"

BATCH_SIZE = 50   # upsert N rows at a time
DEAD_URL_STATUSES = {404, 410}


def url_health_after_observation(previous: dict | None, observed_successfully: bool) -> dict:
    """Clear a terminal URL result only after a trusted crawl sees the product again."""
    previous = previous or {}
    if observed_successfully and previous.get("url_http_status") in DEAD_URL_STATUSES:
        return {"url_http_status": None, "url_checked_at": None}
    return {
        "url_http_status": previous.get("url_http_status"),
        "url_checked_at": previous.get("url_checked_at"),
    }

# ── Category inference (re-run on every sync so old "其他" rows get backfilled) ──
def infer_category(name: str, url: str) -> str:
    u = (url or "").lower()
    n = (name or "").lower()
    hay = u + " " + n
    if "veilance" in hay: return "Veilance商务系列"
    if "binding" in hay: return "固定器"
    # Match product types before materials and use word boundaries for short/pant.
    # This keeps e.g. "short-sleeve" out of pants while still recognizing shorts.
    if re.search(r"\b(?:pants?|bibs?|shorts|joggers?|leggings?|tights?)\b|\bshort\b(?![- ]sleeve)", hay): return "裤装"
    if any(x in hay for x in ["shoe", "boot", "footwear", "sandal", "sneaker"]): return "鞋类"
    if re.search(r"\b(?:hats?|headwear|gloves?|mittens?|mitts?|socks?|buff|toque|beanie|headband|scarf)\b", hay): return "配件"
    if any(x in hay for x in ["snowboard", "splitboard", "powder-board"]): return "滑雪板"
    if any(x in hay for x in ["shell-jacket", "hardshell", "softshell"]): return "硬壳冲锋衣"
    if any(x in hay for x in ["insulated", "down-jacket", "down-coat", "atom", "cerium", "proton", "nuclei", "thorium", "macai", "andessa", "decca", "therme", "sorin"]): return "保暖夹克"
    # 抓绒/卫衣 — 先于通用 hoodie/jacket 匹配, 因为 hoodie 多数是 fleece/midlayer
    if any(x in hay for x in ["fleece", "polar", "fortrez", "kyanite", "covert", "delta", "rho-", "-rho", "rho ",
                              "hoody", "hoodie", "pullover", "crew", " 1/2 zip", "1-2-zip", "midlayer", "mid-layer",
                              "cardigan", "sweater"]): return "抓绒/摇粒绒"
    if any(x in hay for x in ["base-layer", "baselayer", "phase-", "merino", "rho-lt", "boxer", "brief"]): return "排汗内衣"
    if any(x in hay for x in ["backpack", "daypack", "hydration-pack", "hydration pack", "waistpack",
                              "waist-pack", "hip-pack", "duffel", "/bag", "-bag"]): return "背包"
    if any(x in hay for x in ["vest", "gilet"]): return "背心"
    if any(x in hay for x in ["jacket", "anorak", "parka", "-coat", " coat"]): return "夹克/外套"
    if any(x in hay for x in ["blazer"]): return "西装/西服"
    if any(x in hay for x in ["shirt", "polo", "tee", "top-", "tank", "t-shirt", "/top ", "short sleeve", "short-sleeve"]): return "上衣/T恤"
    if any(x in hay for x in ["dress", "skirt"]): return "裙装"
    if re.search(r"\bcaps?\b", hay): return "配件"
    if any(x in hay for x in ["/pack", "tote", "sling"]): return "背包"
    if re.search(r"\bpack\b", hay): return "背包"
    return "其他"

# ── Junk color guard ──────────────────────────────────────────────────────────
def is_junk_color(color: str) -> bool:
    c = (color or "").strip()
    if not c or c.lower() in ("unknown", "default"):
        return True
    if re.match(r"^size\d+$", c, re.IGNORECASE):
        return True
    return False

def calc_discount(original_price, sale_price) -> int:
    """Return an internally consistent integer discount percentage."""
    try:
        orig = float(original_price or 0)
        sale = float(sale_price or 0)
    except (TypeError, ValueError):
        return 0
    if orig <= 0 or sale <= 0 or sale > orig:
        return 0
    return round((1 - sale / orig) * 100)

def gender_from_url(url: str) -> str | None:
    u = (url or "").lower()
    if re.search(r"/womens?/", u):
        return "women"
    if re.search(r"/mens?/", u):
        return "men"
    return None

def is_blocked_outlet_url(url: str) -> bool:
    """True for known bad Arc'teryx Outlet PDP links that should not be shown."""
    u = (url or "").split("?", 1)[0].rstrip("/").lower()
    return bool(
        re.search(r"outlet\.arcteryx\.com/(?:[a-z]{2}/[a-z]{2}/)?shop/womens/rush-bib-pant$", u)
        or re.search(r"outlet\.arcteryx\.com/us/en/shop/womens/alpha-pant$", u)
    )

def _jsonish(value, default):
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default

def all_sizes_out_of_stock(item: dict) -> bool:
    sizes = _jsonish(item.get("sizes"), [])
    stock = _jsonish(item.get("size_stock"), {})
    if not isinstance(stock, dict):
        return False
    keys = sizes if isinstance(sizes, list) and sizes else list(stock.keys())
    if not keys:
        return False
    return all(stock.get(str(size)) == "out_of_stock" for size in keys)

def _replace_gender_marker(text: str | None, gender: str | None) -> str | None:
    if not text or gender not in ("men", "women"):
        return text
    if gender == "women":
        return re.sub(r"(?<!Wo)Men'?s", "Women's", text, flags=re.IGNORECASE)
    return re.sub(r"Women'?s", "Men's", text, flags=re.IGNORECASE)

def normalize_outlet_sku(sku: dict) -> dict:
    """Normalize fields that should be determined by authoritative URL/price data."""
    out = dict(sku)
    url_gender = gender_from_url(out.get("url", ""))
    if url_gender:
        out["gender"] = url_gender
        out["full_name"] = _replace_gender_marker(out.get("full_name"), url_gender)
        out["model"] = _replace_gender_marker(out.get("model"), url_gender)
    out["discount_pct"] = calc_discount(out.get("original_price"), out.get("sale_price"))
    return out

# ── Row builder ───────────────────────────────────────────────────────────────
def sku_to_row(sku: dict) -> dict:
    """Convert a SKU dict (arcteryx_skus.json format) → Supabase row dict."""
    sku = normalize_outlet_sku(sku)
    # Parse last_updated string → ISO timestamp
    lu_str = sku.get("last_updated", "")
    try:
        lu_dt = datetime.strptime(lu_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        lu_iso = lu_dt.isoformat()
    except Exception:
        lu_iso = None

    return {
        "sku_id":         sku.get("sku_id", ""),
        "dealer":         "arcteryx_outlet",   # 区分 outlet vs 各经销商
        "brand":          "arcteryx",
        "model":          sku.get("model"),
        "full_name":      sku.get("full_name"),
        "color":          sku.get("color"),
        "sizes":          sku.get("sizes", []),
        "size_stock":     sku.get("size_stock", {}),
        "original_price": sku.get("original_price"),
        "sale_price":     sku.get("sale_price"),
        "discount_pct":   sku.get("discount_pct"),
        "currency":       sku.get("currency"),
        "symbol":         sku.get("symbol"),
        "gender":         sku.get("gender"),
        "region":         sku.get("region"),
        "region_name":    sku.get("region_name"),
        # Always re-infer category so old "其他" rows get reclassified when sync runs.
        # If the scraper already picked a non-"其他" category, keep it.
        "category":       (sku.get("category") if sku.get("category") and sku.get("category") != "其他"
                           else infer_category(sku.get("full_name"), sku.get("url"))),
        "url":            sku.get("url"),
        "image_url":      sku.get("image_url"),
        "images":         sku.get("images", []),
        "description":    sku.get("description", ""),
        "last_updated":   lu_iso,
    }

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print sample rows, no upload")
    args = parser.parse_args()

    if not SKUS_FILE.exists():
        print(f"[ERROR] {SKUS_FILE} not found", file=sys.stderr)
        sys.exit(1)

    skus = json.loads(SKUS_FILE.read_text())
    manifest = load_manifest(CRAWL_MANIFEST_FILE)
    if not manifest.get("scopes"):
        print("[ERROR] .crawl_manifest.json is missing or empty; refusing lifecycle reconciliation", file=sys.stderr)
        sys.exit(1)
    blocked_sku_ids = [
        s.get("sku_id")
        for s in skus
        if s.get("sku_id") and (is_blocked_outlet_url(s.get("url", "")) or all_sizes_out_of_stock(s))
    ]
    rows = [
        sku_to_row(s)
        for s in skus
        if (
            not is_junk_color(s.get("color", ""))
            and not is_blocked_outlet_url(s.get("url", ""))
            and not all_sizes_out_of_stock(s)
        )
    ]
    print(f"[sync] {len(skus)} SKUs loaded → {len(rows)} valid rows")
    if blocked_sku_ids:
        print(f"[sync] blocked known-bad outlet rows: {len(blocked_sku_ids)}")

    # ── 数据完整性 guard: 拒绝 sale > orig 的行（scraper bug, 不写入 DB）
    bad = []
    for r in rows:
        o = r.get("original_price") or 0
        s = r.get("sale_price") or 0
        if o > 0 and s > 0 and s > o:
            bad.append(r)
    if bad:
        print(f"[sync] 拒绝 {len(bad)} 行 sale>orig (scraper bug, 详情见 stderr)")
        for r in bad[:8]:
            print(f"   ✗ {r['sku_id']} orig=${r.get('original_price')} sale=${r.get('sale_price')}", file=sys.stderr)
        rows = [r for r in rows if r not in bad]

    if args.dry_run:
        import pprint
        pprint.pprint(rows[:3])
        print("[dry-run] done, nothing uploaded")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[ERROR] Set SUPABASE_URL and SUPABASE_KEY env vars", file=sys.stderr)
        sys.exit(1)

    from supabase import create_client
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    try:
        existing_blocked = []
        page = 0
        while True:
            res = client.table("products").select("sku_id,url,dealer,sizes,size_stock").or_(
                "dealer.is.null,dealer.eq.arcteryx_outlet"
            ).range(
                page * 1000, page * 1000 + 999
            ).execute()
            data = res.data or []
            existing_blocked.extend(
                r["sku_id"]
                for r in data
                if r.get("sku_id") and (is_blocked_outlet_url(r.get("url", "")) or all_sizes_out_of_stock(r))
            )
            if len(data) < 1000:
                break
            page += 1
        blocked_delete_ids = sorted(set(blocked_sku_ids) | set(existing_blocked))
    except Exception as e:
        print(f"[WARN] could not load existing blocked rows: {e}", file=sys.stderr)
        blocked_delete_ids = sorted(set(blocked_sku_ids))

    if blocked_delete_ids:
        deleted_blocked = 0
        for i in range(0, len(blocked_delete_ids), BATCH_SIZE):
            batch = blocked_delete_ids[i : i + BATCH_SIZE]
            try:
                client.table("products").delete().in_("sku_id", batch).execute()
                deleted_blocked += len(batch)
            except Exception as e:
                print(f"[ERROR] blocked delete batch {i//BATCH_SIZE + 1}: {e}", file=sys.stderr)
        print(f"[sync] deleted {deleted_blocked} blocked rows")

    # ── Snapshot existing prices + first_seen BEFORE upsert
    # 关键: 把已有行的 first_seen 也加载，upsert 时塞回 row 里，避免任何重建/补录
    # 把 first_seen 刷成今天，导致“今日上新”误报。
    old_prices = {}       # sku_id -> (original_price, sale_price)
    first_seen_map = {}   # sku_id -> first_seen (ISO str)
    existing_state = {}   # sku_id -> lifecycle/source fields
    existing_rows = []
    try:
        page = 0
        while True:
            res = client.table("products").select(
                "sku_id,original_price,sale_price,first_seen,url,region,gender,status,"
                "last_seen_at,missing_runs,url_http_status,url_checked_at,last_updated"
            ).or_("dealer.is.null,dealer.eq.arcteryx_outlet") \
             .range(page * 1000, page * 1000 + 999).execute()
            data = res.data or []
            if not data:
                break
            for r in data:
                old_prices[r["sku_id"]] = (r.get("original_price"), r.get("sale_price"))
                existing_state[r["sku_id"]] = r
                existing_rows.append(r)
                if r.get("first_seen"):
                    first_seen_map[r["sku_id"]] = r["first_seen"]
            if len(data) < 1000:
                break
            page += 1
        print(f"[sync] loaded {len(old_prices)} existing rows ({len(first_seen_map)} with first_seen)")
    except Exception as e:
        print(f"[ERROR] could not preload prices/lifecycle state: {e}", file=sys.stderr)
        print("[ERROR] apply dealers/supabase_migration_product_lifecycle.sql before running this sync", file=sys.stderr)
        sys.exit(1)

    scope_errors = validate_scope_counts(manifest, existing_rows)
    if scope_errors:
        print("[ERROR] crawl scope count guard failed; refusing reconciliation", file=sys.stderr)
        for error in scope_errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)

    # 给每行注入 first_seen + lifecycle。只有 manifest 标记为完整成功的范围
    # 才能增加 missing_runs；失败/缺失范围完全保留上一轮状态。
    # 关键: 必须显式写, 不能依赖 DB DEFAULT now()
    # 因为 PostgREST 批量 upsert 时, 若 batch 内其他行有 first_seen 字段,
    # 没字段的行 INSERT 时填 NULL 而非触发 DEFAULT (PostgREST 把 batch 各 row 字段并集当列集)
    now_iso = datetime.now(timezone.utc).isoformat()
    for r in rows:
        sid = r.get("sku_id")
        previous = existing_state.get(sid, {})
        if sid and sid in first_seen_map:
            r["first_seen"] = first_seen_map[sid]   # 已存在: 保留原值
        else:
            r["first_seen"] = now_iso                # 真新 SKU: 显式设今天
        r.update(next_lifecycle(previous, r, manifest))
        r.update(url_health_after_observation(previous, seen_in_successful_scope(r, manifest) is True))

    local_ids = {r.get("sku_id") for r in rows if r.get("sku_id")}
    lifecycle_updates = {}
    for sid, previous in existing_state.items():
        if sid in local_ids:
            continue
        lifecycle = next_lifecycle(
            previous,
            previous,
            manifest,
            present_in_snapshot=False,
        )
        if lifecycle["status"] == (previous.get("status") or "active") and lifecycle["missing_runs"] == int(previous.get("missing_runs") or 0):
            continue
        key = (lifecycle["status"], lifecycle["missing_runs"])
        lifecycle_updates.setdefault(key, []).append(sid)

    for (status, missing_runs), ids in lifecycle_updates.items():
        for i in range(0, len(ids), BATCH_SIZE):
            batch = ids[i : i + BATCH_SIZE]
            client.table("products").update({"status": status, "missing_runs": missing_runs}).in_("sku_id", batch).execute()
    if lifecycle_updates:
        print(f"[sync] lifecycle-only rows updated: {sum(len(ids) for ids in lifecycle_updates.values())}")

    total, errors = 0, 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            res = client.table("products").upsert(
                batch,
                on_conflict="sku_id"
            ).execute()
            total += len(batch)
            print(f"[sync] upserted rows {i+1}–{i+len(batch)} ({total}/{len(rows)})")
        except Exception as e:
            errors += 1
            print(f"[ERROR] batch {i//BATCH_SIZE + 1}: {e}", file=sys.stderr)

    print(f"\n[sync] DONE — {total} upserted, {errors} batch errors")
    if errors:
        print("[ERROR] one or more product upsert batches failed", file=sys.stderr)
        sys.exit(1)

    # ── Price history (append-only) ───────────────────────────────────────
    # Record a snapshot for every SKU whose price changed vs. last run, plus
    # brand-new SKUs. Preserved forever so we can chart price trends even
    # after the product is removed from the current products table.
    history_rows = []
    for r in rows:
        sid = r.get("sku_id")
        if not sid:
            continue
        new_op, new_sp = r.get("original_price"), r.get("sale_price")
        if new_sp is None:
            continue
        old = old_prices.get(sid)
        if old is None or old != (new_op, new_sp):
            history_rows.append({
                "sku_id":         sid,
                "original_price": new_op,
                "sale_price":     new_sp,
                "discount_pct":   r.get("discount_pct"),
                "currency":       r.get("currency"),
                "recorded_at":    r.get("last_updated"),
            })
    print(f"[sync] price_history: {len(history_rows)} changes to log")
    hist_inserted = 0
    for i in range(0, len(history_rows), BATCH_SIZE):
        batch = history_rows[i : i + BATCH_SIZE]
        try:
            client.table("price_history").insert(batch).execute()
            hist_inserted += len(batch)
        except Exception as e:
            print(f"[ERROR] price_history batch {i//BATCH_SIZE + 1}: {e}", file=sys.stderr)
    print(f"[sync] price_history: inserted {hist_inserted}")

    # Lifecycle rows remain available for audit; clients only read status=active.
    # Two complete missed runs move active -> missing -> inactive without
    # conflating crawler failure with removal.

    # Also write a minimal last-sync marker
    marker = BASE_DIR / ".last_sync"
    marker.write_text(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))


if __name__ == "__main__":
    main()
