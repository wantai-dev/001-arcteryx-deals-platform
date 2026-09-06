"""把 dealers/results.json 同步到 Supabase products 表。
要求: 先执行 dealer 与 brand 两个迁移文件。

使用 service_role key（bypass RLS）。每个 dealer 单独 upsert，
stale-row 检测限定 dealer 范围（不会删掉 outlet 行，反之亦然）。
"""
from __future__ import annotations
import os, json, re, sys, hashlib
from pathlib import Path
from datetime import datetime, timezone

from dealers.brands import canonical_brand, source_contract_valid
from dealers.source_registry import RETIRED_DEALERS

ROOT = Path(__file__).resolve().parent.parent
RESULTS_FILE = ROOT / "dealers" / "results.json"
BATCH_SIZE = 50
SYM = {"USD":"$", "CAD":"C$", "EUR":"€", "GBP":"£", "SEK":"kr", "CHF":"CHF"}
DEFAULT_CURRENCY_BY_DEALER = {
    "mec": "CAD",
    "evo": "USD",
    "burton": "USD",
    "backcountry": "USD",
    "rei": "USD",
    "ssense": "USD",
}
DEAD_URL_STATUSES = {404, 410}
INACTIVE_AFTER_MISSING_RUNS = 2
PDP_REVALIDATION_GRACE_HOURS = 36
REGION_NAME = {
    "us":"美国","ca":"加拿大","gb":"英国","de":"德国","fr":"法国","nl":"荷兰",
    "at":"奥地利","ch":"瑞士","it":"意大利","es":"西班牙","be":"比利时",
    "dk":"丹麦","se":"瑞典","no":"挪威","fi":"芬兰","ie":"爱尔兰","pl":"波兰",
    "jp":"日本","au":"澳大利亚","nz":"新西兰","kr":"韩国","hk":"香港",
}

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bupqagkrcvrezjkdbald.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")  # service_role


def fresh_dealer_keys(payload: dict) -> set[str] | None:
    """Return dealers refreshed in this run; None keeps legacy-file behavior."""
    value = payload.get("fresh_dealers")
    if value is None:
        return None
    return {str(key) for key in value}


def _parse_iso_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def has_recent_pdp_confirmation(existing: dict | None, observed_at: str) -> bool:
    """Keep a list-absent row active when a recent official PDP read confirmed it."""
    existing = existing or {}
    if existing.get("status") != "active" or existing.get("url_http_status") != 200:
        return False
    checked = _parse_iso_timestamp(existing.get("url_checked_at"))
    observed = _parse_iso_timestamp(observed_at)
    if not checked or not observed:
        return False
    age_seconds = (observed - checked).total_seconds()
    return 0 <= age_seconds <= PDP_REVALIDATION_GRACE_HOURS * 3600


def next_dealer_lifecycle(
    existing: dict | None,
    *,
    present: bool,
    observed_at: str,
    source_contract_valid: bool = True,
) -> dict:
    """Return the lifecycle transition for one trusted, complete dealer snapshot."""
    existing = existing or {}
    current_missing = int(existing.get("missing_runs") or 0)
    if not source_contract_valid:
        # A URL proven to belong to another brand is not a transient list miss.
        # Quarantine it immediately even when a recent PDP check returned 200.
        return {
            "status": "inactive",
            "missing_runs": max(INACTIVE_AFTER_MISSING_RUNS, current_missing + 1),
            "last_seen_at": existing.get("last_seen_at") or existing.get("last_updated"),
        }
    if present:
        return {"status": "active", "missing_runs": 0, "last_seen_at": observed_at}
    if has_recent_pdp_confirmation(existing, observed_at):
        return {
            "status": "active",
            "missing_runs": 0,
            "last_seen_at": (
                existing.get("last_seen_at")
                or existing.get("url_checked_at")
                or existing.get("last_updated")
            ),
        }
    missing_runs = current_missing + 1
    return {
        "status": "inactive" if missing_runs >= INACTIVE_AFTER_MISSING_RUNS else "missing",
        "missing_runs": missing_runs,
        "last_seen_at": existing.get("last_seen_at") or existing.get("last_updated"),
    }


def recovered_url_health(existing: dict | None) -> dict:
    """A newly observed product invalidates a stored terminal URL result."""
    existing = existing or {}
    if existing.get("url_http_status") in DEAD_URL_STATUSES:
        return {"url_http_status": None, "url_checked_at": None}
    return {
        "url_http_status": existing.get("url_http_status"),
        "url_checked_at": existing.get("url_checked_at"),
    }

# ── derive sku_id from dealer + URL (stable across runs) ──
def make_sku_id(dealer: str, url: str, source_id: object = None) -> str:
    if dealer in {"burton", "backcountry"} and source_id is not None:
        normalized_source_id = re.sub(r"[^a-zA-Z0-9_-]+", "", str(source_id))
        if normalized_source_id:
            return f"{dealer}:{normalized_source_id.lower()}"
    if dealer == "ssense":
        m = re.search(r'/(\d{6,})$', url or "")
        if m: return f"ssense:{m.group(1)}"
    elif dealer == "mec":
        m = re.search(r'/product/([0-9-]+)/', url or "")
        if m: return f"mec:{m.group(1)}"
    elif dealer == "evo":
        # EVO 把同一商品挂多个分类，URL 末段会重复（shell-jackets/sabre vs
        # insulated-jackets/sabre），用整段 path 才能保证唯一
        m = re.search(r'evo\.com(/[a-z0-9/-]+)$', url or "")
        if m: return f"evo:{m.group(1).strip('/')}"
    elif dealer == "rei":
        m = re.search(r'/product/(\d+)/', url or "")
        if m: return f"rei:{m.group(1)}"
    # fallback hash
    return f"{dealer}:" + hashlib.sha1((url or "").encode()).hexdigest()[:12]

def _infer_cat(name: str, url: str) -> str:
    """Dealer 行也归类, 避免 100% 都是 '其他'。复用 outlet 的逻辑。"""
    try:
        from supabase_sync import infer_category   # parent module
        return infer_category(name, url)
    except Exception:
        return ""

def _currency_for_item(it: dict, dealer: str) -> str:
    region = (it.get("region") or "").lower()
    currency = (it.get("currency") or "").upper()
    if dealer == "mec" and region == "ca":
        return "CAD"
    return currency or DEFAULT_CURRENCY_BY_DEALER.get(dealer, "USD")

def _discount_pct(orig, sale) -> int:
    try:
        o = float(orig or 0)
        s = float(sale or 0)
    except (TypeError, ValueError):
        return 0
    if o <= 0 or s <= 0 or s > o:
        return 0
    return round((1 - s / o) * 100)


def should_preserve_previous_discount(
    dealer: str,
    price_source_quality: str | None,
    new_sale,
    new_original,
    old_sale,
    old_original,
) -> bool:
    """Don't let low-trust list fallback overwrite a trusted PDP price.

    MEC list prices can differ from the current PDP price even when both are
    full-price values.  Preserve the last PDP-confirmed value whenever a MEC
    PDP enrichment fails and its list fallback disagrees with production.
    Other dealers retain the narrower historical discount guard.
    """
    if price_source_quality != "list_fallback":
        return False
    if not (new_sale and new_original and old_sale and old_original):
        return False
    if dealer == "mec" and (
        abs(float(new_sale) - float(old_sale)) > 0.01
        or abs(float(new_original) - float(old_original)) > 0.01
    ):
        return True
    if old_sale >= old_original - 0.01:
        return False
    if new_sale > old_sale + 0.01:
        return True
    if abs(new_sale - new_original) < 0.01:
        return True
    return abs(new_sale - old_sale) < 0.01 and new_original > old_original + 0.01


def preserve_previous_images(row: dict, previous: dict | None) -> None:
    """Keep a known image when a transient dealer snapshot omits image metadata."""
    if row.get("image_url") or not previous:
        return
    previous_images = previous.get("images") or []
    previous_url = previous.get("image_url")
    if not previous_url and isinstance(previous_images, list) and previous_images:
        previous_url = previous_images[0]
    if previous_url:
        row["image_url"] = previous_url
        row["images"] = previous_images or [previous_url]


def is_expected_dealer_item(item: dict, dealer: str) -> bool:
    """Validate supported brands and dealer-specific URL scopes before upsert."""
    return source_contract_valid(item, dealer)


def item_to_row(it: dict, dealer: str, generated_at: str) -> dict:
    name = it.get("name") or ""
    url = it.get("url","")
    sku_id = make_sku_id(dealer, url, it.get("source_id"))
    currency = _currency_for_item(it, dealer)
    original_price = it.get("original_price")
    sale_price = it.get("sale_price")
    return {
        "sku_id":         sku_id,
        "dealer":         dealer,
        "brand":          canonical_brand(it),
        "model":          name,
        "full_name":      name,
        "color":          it.get("color") or "",
        "sizes":          it.get("sizes") or [],
        "size_stock":     it.get("size_stock") or {},
        "original_price": original_price,
        "sale_price":     sale_price,
        "discount_pct":   _discount_pct(original_price, sale_price),
        "currency":       currency,
        "symbol":         SYM.get(currency, "$"),
        "gender":         it.get("gender") or "unknown",
        "region":         (it.get("region") or "us").lower(),
        "region_name":    REGION_NAME.get((it.get("region") or "us").lower(), ""),
        "category":       _infer_cat(name, url),
        "url":            url,
        "image_url":      it.get("image"),
        "images":         [it["image"]] if it.get("image") else [],
        "description":    "",
        "last_updated":   _to_iso(generated_at),
        "_price_source_quality": it.get("price_source_quality"),
    }

def _to_iso(s: str) -> str | None:
    if not s: return None
    try:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None

def main():
    if not SUPABASE_KEY:
        sys.exit("SUPABASE_KEY env var required (service_role)")
    if not RESULTS_FILE.exists():
        sys.exit(f"{RESULTS_FILE} not found — run scrapers + merge_partial first")
    js = json.loads(RESULTS_FILE.read_text())
    dealers = js.get("dealers", {})
    fresh_dealers = fresh_dealer_keys(js)
    generated_at = js.get("generated_at", "")

    from supabase import create_client
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    grand_total = 0
    for dkey, info in dealers.items():
        if dkey in RETIRED_DEALERS:
            print(f"\n[sync:{dkey}] retired source — refusing snapshot sync")
            continue
        if fresh_dealers is not None and dkey not in fresh_dealers:
            print(f"\n[sync:{dkey}] kept snapshot — not refreshed in this run; skipping")
            continue
        items = info.get("items", []) or []
        invalid_items = [it for it in items if not is_expected_dealer_item(it, dkey)]
        if invalid_items:
            sys.exit(f"[sync:{dkey}] refusing {len(invalid_items)} item(s) outside the supported-brand source contract")
        rows = [item_to_row(it, dkey, generated_at) for it in items]
        rows = [r for r in rows if r["sku_id"] and r["url"]]
        print(f"\n[sync:{dkey}] {len(rows)} rows to upsert")
        if not rows:
            print(f"[sync:{dkey}] 0 trusted rows — preserving all existing lifecycle state")
            continue

        # ── 加载已有 first_seen + sizes + size_stock + color，
        # 后续注入: first_seen 始终注入(防 stale-reset);
        # sizes/size_stock/color 仅当本轮抓到空时保留DB老值(防 detail enrichment 临时失败导致数据丢失)
        existing_map = {}
        try:
            page = 0
            while True:
                res = client.table("products").select(
                    "sku_id,first_seen,sizes,size_stock,color,original_price,sale_price,discount_pct,"
                    "status,last_seen_at,missing_runs,url_http_status,url_checked_at,last_updated,url,image_url,images,brand"
                ).eq("dealer", dkey).range(page*1000, page*1000+999).execute()
                data = res.data or []
                for r in data:
                    existing_map[r["sku_id"]] = r
                if len(data) < 1000: break
                page += 1
        except Exception:
            pass
        from datetime import datetime as _dt, timezone as _tz
        now_iso = _dt.now(_tz.utc).isoformat()
        for r in rows:
            old = existing_map.get(r["sku_id"])
            if old:
                # 存在: 保留 first_seen (若 DB 老值为空则补今天)
                r["first_seen"] = old.get("first_seen") or now_iso
                # 保留非空 detail enrichment 数据
                if not r.get("sizes") and old.get("sizes"):
                    r["sizes"] = old["sizes"]
                    r["size_stock"] = old.get("size_stock") or {}
                if not (r.get("color") or "").strip() and (old.get("color") or "").strip():
                    r["color"] = old["color"]
                preserve_previous_images(r, old)
                # 保留 DB 老的真折扣价: 若本轮 disc=0 (list-only fallback 模式)
                # 但 DB 老值有 sale < orig (PDP enrich 抓到的真折扣), 保留 DB 老价格.
                # 避免 mec scrapling fallback 覆盖掉之前的折扣信息 → 前端假满价.
                new_sp, new_op = r.get("sale_price"), r.get("original_price")
                old_sp, old_op = old.get("sale_price"), old.get("original_price")
                if should_preserve_previous_discount(
                    dkey,
                    r.get("_price_source_quality"),
                    new_sp,
                    new_op,
                    old_sp,
                    old_op,
                ):
                    r["sale_price"] = old_sp
                    r["original_price"] = old_op
                    r["discount_pct"] = _discount_pct(old_op, old_sp)
            else:
                # 真新 SKU: 显式设今天 (避免 PostgREST batch upsert 字段不齐 → NULL)
                r["first_seen"] = now_iso
            observed_at = r.get("last_updated") or now_iso
            r.update(next_dealer_lifecycle(old, present=True, observed_at=observed_at))
            r.update(recovered_url_health(old))

        # ── upsert in batches
        ok, err = 0, 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i+BATCH_SIZE]
            for row in batch:
                row.pop("_price_source_quality", None)
            try:
                client.table("products").upsert(batch, on_conflict="sku_id").execute()
                ok += len(batch)
            except Exception as e:
                err += 1
                print(f"  ERR batch {i//BATCH_SIZE+1}: {str(e)[:200]}", file=sys.stderr)
        print(f"[sync:{dkey}] upserted {ok}/{len(rows)} ({err} batch errors)")
        grand_total += ok

        # ── price_history (append-only): 价格变化的 SKU 记录历史 ────────
        # 之前 dealer sync 完全不写 price_history, 导致前端详情页折线图
        # 只对 outlet 有数据. revalidate.py (06:30 UTC) 顺手写一点 MEC,
        # 但 evo/ssense/rei 完全没历史. 现在 dealer sync 也补上.
        hist_rows = []
        for r in rows:
            sid = r["sku_id"]
            new_sp, new_op = r.get("sale_price"), r.get("original_price")
            if new_sp is None: continue
            old = existing_map.get(sid)
            if old is None: continue  # 新 SKU, 首次入库不算价格"变化"
            old_sp, old_op = old.get("sale_price"), old.get("original_price")
            if old_sp is None: continue
            if abs((new_sp or 0) - (old_sp or 0)) < 0.01 and abs((new_op or 0) - (old_op or 0)) < 0.01:
                continue  # 价格未变
            hist_rows.append({
                "sku_id":         sid,
                "sale_price":     new_sp,
                "original_price": new_op,
                "discount_pct":   r.get("discount_pct"),
                "currency":       r.get("currency"),
                "recorded_at":    r.get("last_updated") or now_iso,
            })
        if hist_rows:
            hi_ok = 0
            for i in range(0, len(hist_rows), BATCH_SIZE):
                batch = hist_rows[i:i+BATCH_SIZE]
                try:
                    client.table("price_history").insert(batch).execute()
                    hi_ok += len(batch)
                except Exception as e:
                    print(f"  HIST ERR batch {i//BATCH_SIZE+1}: {str(e)[:200]}", file=sys.stderr)
            print(f"[sync:{dkey}] price_history: +{hi_ok} 价变事件")
        else:
            print(f"[sync:{dkey}] price_history: 0 价变 (无新事件)")

        # ── reconcile absent rows only for this trusted, complete dealer snapshot.
        # First miss hides the row as `missing`; the second moves it to `inactive`.
        # Rows stay recoverable and are reactivated if a later scrape sees them.
        try:
            synced_ids = {r["sku_id"] for r in rows}
            lifecycle_updates: dict[tuple[str, int], list[str]] = {}
            source_contract_quarantined = 0
            for sid, old in existing_map.items():
                if sid in synced_ids:
                    continue
                source_contract_valid = is_expected_dealer_item(old, dkey)
                if not source_contract_valid:
                    source_contract_quarantined += 1
                lifecycle = next_dealer_lifecycle(
                    old,
                    present=False,
                    observed_at=now_iso,
                    source_contract_valid=source_contract_valid,
                )
                key = (lifecycle["status"], lifecycle["missing_runs"])
                lifecycle_updates.setdefault(key, []).append(sid)
            for (status, missing_runs), ids in lifecycle_updates.items():
                for i in range(0, len(ids), 100):
                    client.table("products").update({
                        "status": status,
                        "missing_runs": missing_runs,
                    }).in_("sku_id", ids[i:i+100]).execute()
            transitioned = sum(len(ids) for ids in lifecycle_updates.values())
            print(
                f"[sync:{dkey}] existing={len(existing_map)} "
                f"absent_transitioned={transitioned} "
                f"source_contract_quarantined={source_contract_quarantined}"
            )
        except Exception as e:
            print(f"[sync:{dkey}] lifecycle reconciliation err: {str(e)[:200]}", file=sys.stderr)

    print(f"\n=== DEALERS SYNC DONE — {grand_total} rows total ===")

if __name__ == "__main__":
    main()
