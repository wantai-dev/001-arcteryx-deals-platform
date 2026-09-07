"""降价提醒检查 + 邮件发送
扫 price_alerts 表里所有 notified_at IS NULL 的订阅，
对每条比对 products 表当前价，命中条件就发邮件 + 标记 notified_at.

触发条件:
- target_price 不为 NULL: sale_price <= target_price
- target_price 为 NULL: sale_price < last_price_seen (任意下跌)

邮件: Resend API. 需 RESEND_API_KEY env (~/.arcteryx_secrets 里).
没配 RESEND_API_KEY 时只打 log，不发、不写 notified_at，并以失败状态退出。
"""
from __future__ import annotations
import html as html_lib
import os, sys, json, urllib.request, urllib.parse, ssl
from datetime import datetime, timezone
from typing import Callable

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bupqagkrcvrezjkdbald.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")          # service_role
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")       # 可选
RESEND_FROM = os.environ.get("RESEND_FROM", "GearDrop <onboarding@resend.dev>")
SITE_URL = os.environ.get("SITE_URL", "https://geardrop.100app.dev")

_CTX = ssl.create_default_context()
_H = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}

def http_get(path: str) -> list | dict:
    req = urllib.request.Request(f"{SUPABASE_URL}{path}", headers=_H)
    with urllib.request.urlopen(req, context=_CTX, timeout=30) as r:
        return json.loads(r.read())

def http_patch(path: str, body: dict) -> None:
    req = urllib.request.Request(f"{SUPABASE_URL}{path}",
        data=json.dumps(body).encode(), method="PATCH",
        headers={**_H, "Content-Type":"application/json", "Prefer":"return=minimal"})
    with urllib.request.urlopen(req, context=_CTX, timeout=20):
        pass

def send_email_resend(to: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY:
        print(f"  (dry-run, no RESEND_API_KEY) → {to}: {subject}")
        return False
    body = json.dumps({
        "from": RESEND_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
    }).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=body,
        headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, context=_CTX, timeout=15) as r:
            return r.status in (200, 201, 202)
    except Exception as e:
        print(f"  email send err: {str(e)[:160]}", file=sys.stderr)
        return False

def _https_url(value: object, fallback: str = "") -> str:
    candidate = str(value or "").strip()
    try:
        parsed = urllib.parse.urlsplit(candidate)
    except ValueError:
        return fallback
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return fallback
    return candidate

def render_email(alert: dict, current_price: float) -> tuple[str, str]:
    sym = {"USD":"$","CAD":"C$","EUR":"€","GBP":"£","JPY":"¥","CHF":"CHF","SEK":"kr","DKK":"kr","AUD":"A$"}.get(alert.get("currency",""), "$")
    name = str(alert.get("product_name") or "Arc'teryx 商品")
    subject_name = name.replace("\r", " ").replace("\n", " ")
    site_url = _https_url(SITE_URL, "https://geardrop.100app.dev").rstrip("/")
    url = _https_url(alert.get("product_url"), site_url)
    img = _https_url(alert.get("image_url"))
    safe_name = html_lib.escape(name)
    safe_url = html_lib.escape(url, quote=True)
    safe_img = html_lib.escape(img, quote=True)
    target = alert.get("target_price")
    was = alert.get("last_price_seen") or 0
    drop_pct = round((1 - current_price/was)*100) if was > current_price > 0 else 0
    token = urllib.parse.quote(str(alert.get("unsubscribe_token") or ""), safe="")
    unsub_url = html_lib.escape(f"{site_url}/unsubscribe.html?t={token}", quote=True)
    logo_url = html_lib.escape(f"{site_url}/assets/brand/geardrop-logo.png", quote=True)
    subject = f"🔥 {subject_name} 已降至 {sym}{current_price:.2f}"
    html = f"""<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
<img src="{logo_url}" alt="GearDrop" width="180" style="display:block;width:180px;height:auto;margin:0 0 24px">
<h2 style="margin:0 0 16px;font-size:20px">🔥 你订阅的商品降价了</h2>
{f'<img src="{safe_img}" alt="" style="width:200px;height:auto;border-radius:8px;display:block;margin:0 0 18px">' if safe_img else ''}
<div style="font-size:16px;font-weight:600;margin-bottom:10px">{safe_name}</div>
<table style="font-size:14px;line-height:1.7;margin-bottom:18px">
  <tr><td style="color:#888;padding-right:14px">订阅时:</td><td>{sym}{was:.2f}</td></tr>
  {f'<tr><td style="color:#888;padding-right:14px">目标价:</td><td>{sym}{target:.2f}</td></tr>' if target else ''}
  <tr><td style="color:#888;padding-right:14px">现价:</td><td style="color:#c8362a;font-weight:700;font-size:18px">{sym}{current_price:.2f} {f'（再降 {drop_pct}%）' if drop_pct else ''}</td></tr>
</table>
<a href="{safe_url}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:500;font-size:14px">立即查看商品 →</a>
<p style="color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:14px">
这是本条提醒的一次发送。想继续追踪可重新设置提醒。<br>
<a href="{unsub_url}" style="color:#999">删除本条提醒记录</a>
</p>
</body></html>"""
    return subject, html

def process_alerts(
    alerts: list[dict],
    products: list[dict],
    sender: Callable[[str, str, str], bool] = send_email_resend,
    patcher: Callable[[str, dict], None] = http_patch,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> dict[str, int]:
    price_by_sku = {p["sku_id"]: p for p in products}
    sent, failed, skipped, missing = 0, 0, 0, 0
    for alert in alerts:
        product = price_by_sku.get(alert["sku_id"])
        if not product or not product.get("sale_price"):
            missing += 1
            continue
        current_price = float(product["sale_price"])
        target = alert.get("target_price")
        previous_price = alert.get("last_price_seen") or 0
        triggered = current_price <= float(target) if target is not None else (
            previous_price > 0 and current_price < float(previous_price)
        )
        if not triggered:
            skipped += 1
            continue
        # Use the latest product URL/image, which may change after subscription.
        alert = {
            **alert,
            "product_url": product.get("url") or alert.get("product_url"),
            "image_url": product.get("image_url") or alert.get("image_url"),
        }
        subject, html = render_email(alert, current_price)
        if not sender(alert["email"], subject, html):
            failed += 1
            continue
        try:
            alert_id = urllib.parse.quote(str(alert["id"]), safe="")
            patcher(
                f"/rest/v1/price_alerts?id=eq.{alert_id}",
                {"notified_at": now().isoformat()},
            )
        except Exception as error:
            failed += 1
            print(
                f"  PATCH err id={alert['id']}: {error}; delivery remains pending and may retry",
                file=sys.stderr,
            )
            continue
        sent += 1
    return {"sent": sent, "failed": failed, "skipped": skipped, "missing_sku": missing}

def main(
    *,
    getter: Callable[[str], list | dict] | None = None,
    patcher: Callable[[str, dict], None] | None = None,
    sender: Callable[[str, str, str], bool] | None = None,
) -> int:
    if not SUPABASE_KEY:
        print("SUPABASE_KEY env required", file=sys.stderr)
        return 2
    getter = getter or http_get
    patcher = patcher or http_patch
    sender = sender or send_email_resend
    # 1. 拉所有待发提醒
    alerts = getter("/rest/v1/price_alerts?notified_at=is.null&select=*&limit=500")
    if not alerts:
        print("[alerts] 0 pending")
        return 0
    print(f"[alerts] {len(alerts)} pending subscribers")

    # 2. 拉相关 sku_id 的当前价格 (批量按 in 查询)
    sku_ids = list({a["sku_id"] for a in alerts})
    # PostgREST 'in' filter
    in_filter = "(" + ",".join(urllib.parse.quote(s) for s in sku_ids) + ")"
    prods = getter(f"/rest/v1/products?sku_id=in.{in_filter}&select=sku_id,sale_price,original_price,url,image_url")
    print(f"[alerts] loaded {len(prods)}/{len(sku_ids)} matching products")
    summary = process_alerts(alerts, prods, sender=sender, patcher=patcher)
    print("[alerts] " + " ".join(f"{key}={value}" for key, value in summary.items()))
    return 1 if summary["failed"] else 0

if __name__ == "__main__":
    raise SystemExit(main())
