"""Dealer URL Revalidator
============================
列表 scraper 只能拿到当前在列表/搜索页的商品。商品掉出列表后,
DB 里旧价就僵在那里. 本脚本针对已知 dealer URL 重新拉 PDP 验价格.

策略 (按 dealer 分组, 复用浏览器 session):
- EVO    : Shopify /products/{handle}.json (纯 HTTP, 最快)
- MEC    : curl_cffi (impersonate=chrome), __NEXT_DATA__.product 价格
- REI    : Camoufox (curl_cffi 在 AWS Lightsail 被 Akamai 拒), data-ui="sale-price"/"full-price"

更新逻辑:
- 成功拿到有效价格 → UPDATE sale/orig/disc，并恢复 active 生命周期与 PDP-200 证据
- 失败 (404 / CF stub / 网络错) → 不更新 last_updated, 让 14 天 stale 兜底清理
- PDP 重定向或无效价序绝不覆盖价格；已 active 的无效价序只做可逆 missing 隔离
- 价格变化 → 同步写一行 price_history

每日 06:30 UTC 跑一次, 错开 outlet 06:00 + dealer 03/09/15/21
"""
from __future__ import annotations
import os, sys, time, json, re, urllib.request, ssl
from contextlib import contextmanager
from datetime import datetime, timezone
from collections import defaultdict
from pathlib import Path

from dealers.source_registry import REVALIDATION_DEALERS

SB_URL = os.environ.get("SUPABASE_URL", "https://bupqagkrcvrezjkdbald.supabase.co")
SB_KEY = os.environ.get("SUPABASE_KEY", "")

# ── Shared helpers ────────────────────────────────────────────────────────
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"


def _env_float(name: str, default: float, minimum: float = 0.0) -> float:
    try:
        return max(minimum, float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return max(minimum, default)

def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return max(minimum, default)

def _format_error(prefix: str, exc: Exception) -> str:
    detail = " ".join(str(exc).split())
    suffix = f": {detail[:160]}" if detail else ""
    return f"{prefix} {type(exc).__name__}{suffix}"

def _camoufox_geoip_candidates(value: bool | None = None) -> list[bool]:
    if value is not None:
        return [value]
    configured = os.environ.get("CAMOUFOX_GEOIP", "auto").strip().lower()
    if configured in {"1", "true", "yes", "on"}:
        return [True]
    if configured in {"0", "false", "no", "off"}:
        return [False]
    return [True, False]

@contextmanager
def open_camoufox_browser(*, geoip: bool | None = None, factory=None):
    """Open a humanized Camoufox browser with a fail-safe geoip fallback.

    Camoufox geoip lookup is useful on ephemeral GitHub runners but can raise
    InvalidIP on local networks. In the default ``auto`` mode, retry without
    geoip only when browser startup itself fails.
    """
    if factory is None:
        from camoufox.sync_api import Camoufox

        factory = Camoufox

    candidates = _camoufox_geoip_candidates(geoip)
    last_error = None
    for index, candidate in enumerate(candidates):
        context = None
        try:
            context = factory(headless=True, humanize=True, geoip=candidate)
            browser = context.__enter__()
        except Exception as exc:
            last_error = exc
            if context is not None:
                try:
                    context.__exit__(type(exc), exc, exc.__traceback__)
                except Exception:
                    pass
            if index + 1 < len(candidates):
                print(
                    f"[camoufox] geoip={candidate} startup failed "
                    f"({_format_error('browser', exc)}); retrying without geoip",
                    file=sys.stderr,
                    flush=True,
                )
            continue

        try:
            yield browser
        finally:
            context.__exit__(None, None, None)
        return

    if last_error is None:
        raise RuntimeError("Camoufox startup failed without an exception")
    raise RuntimeError(_format_error("Camoufox startup failed", last_error)) from last_error

def _num(s):
    if s is None: return None
    s = str(s).replace(",","").strip().lstrip("$€£")
    try: return float(s)
    except: return None

def _disc(orig, sale):
    if not orig or not sale or orig <= 0 or sale > orig: return 0
    return round((1 - sale/orig) * 100)

def _price_integrity_error(result: dict | None) -> str | None:
    if not result or result.get("_err") or result.get("_unavailable"):
        return None
    sale = _num(result.get("sale_price"))
    original = _num(result.get("original_price")) or sale
    if not sale or sale <= 0:
        return "non_positive_sale"
    if not original or original <= 0:
        return "non_positive_original"
    if original < sale:
        return "original_below_sale"
    return None

def _price_is_discounted(result: dict | None) -> bool:
    if not result or result.get("_err") or result.get("_unavailable"):
        return False
    sale = _num(result.get("sale_price"))
    original = _num(result.get("original_price"))
    return bool(sale and original and original > sale + 0.01)

def requested_dealers(value: str | None = None) -> set[str] | None:
    """Return an optional validated dealer subset for bounded repair runs."""
    raw = os.environ.get("REVALIDATE_DEALERS", "") if value is None else value
    if not raw.strip():
        return None
    requested = {
        dealer.strip().lower()
        for dealer in raw.split(",")
        if dealer.strip()
    }
    supported = REVALIDATION_DEALERS
    unknown = sorted(requested - supported)
    if unknown:
        raise ValueError(
            "unsupported REVALIDATE_DEALERS: " + ", ".join(unknown)
        )
    return requested

def requested_sku_ids(value: str | None = None) -> set[str] | None:
    """Return an optional exact SKU allowlist for targeted repair runs."""
    raw = os.environ.get("REVALIDATE_SKU_IDS", "") if value is None else value
    if not raw.strip():
        return None
    requested = {
        sku_id.strip()
        for sku_id in raw.replace("\n", ",").split(",")
        if sku_id.strip()
    }
    if len(requested) > 100:
        raise ValueError("REVALIDATE_SKU_IDS is limited to 100 exact values")
    return requested

def requested_max_rows_per_dealer(value: str | None = None) -> int | None:
    """Return the optional per-dealer cohort limit for scheduled rotation."""
    raw = (
        os.environ.get("REVALIDATE_MAX_ROWS_PER_DEALER", "")
        if value is None
        else value
    )
    if not raw.strip():
        return None
    try:
        limit = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "REVALIDATE_MAX_ROWS_PER_DEALER must be a positive integer"
        ) from exc
    if limit < 1:
        raise ValueError(
            "REVALIDATE_MAX_ROWS_PER_DEALER must be a positive integer"
        )
    return limit

def select_oldest_rows_per_dealer(
    rows,
    limit: int | None,
    *,
    exact_sku_ids: set[str] | None = None,
):
    """Select a stable cohort while preserving every exact repair target."""
    if limit is None or exact_sku_ids is not None:
        return list(rows)
    grouped = defaultdict(list)
    for row in rows:
        grouped[row.get("dealer")].append(row)
    selected = []
    for dealer in sorted(grouped, key=lambda value: str(value or "")):
        dealer_rows = sorted(
            grouped[dealer],
            key=lambda row: (
                row.get("last_updated") or "",
                row.get("sku_id") or "",
            ),
        )
        selected.extend(dealer_rows[:limit])
    return selected

# ── Per-dealer PDP fetchers ──────────────────────────────────────────────
def fetch_evo_pdp(url: str) -> dict | None:
    """EVO Shopify, 用 /products/<handle>.js (注意 .js 不是 .json)
    它返回 variant.available 字段 + 顶层 available 标识. price 是 cents 单位."""
    m = re.search(r'/products/([^/?#]+)', url or "")
    if not m: return None
    handle = m.group(1)
    api = f"https://www.evo.com/products/{handle}.js"
    try:
        req = urllib.request.Request(api, headers={
            "User-Agent": _UA,
            "Accept": "application/javascript, application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.evo.com/",
        })
        with urllib.request.urlopen(req, context=_CTX, timeout=15) as r:
            p = json.loads(r.read().decode("utf-8","ignore"))
    except Exception as e:
        return {"_err": _format_error("http", e)}
    # 顶层 available=False 表示整品下架
    if p.get("available") is False:
        return {"_unavailable": True}
    variants = p.get("variants") or []
    avail = [v for v in variants if v.get("available")]
    if not avail:
        return {"_unavailable": True}
    # price 单位是 cents (e.g. 19120 = \$191.20). 除 100 转 dollars
    prices   = [(_num(v.get("price")) or 0) / 100 for v in avail if v.get("price")]
    compares = [(_num(v.get("compare_at_price")) or 0) / 100 for v in avail if v.get("compare_at_price")]
    prices   = [x for x in prices if x > 0]
    compares = [x for x in compares if x > 0]
    if not prices: return None
    sale = min(prices)
    orig = max(compares) if compares else sale
    if orig < sale: orig = sale
    return {"sale_price": round(sale, 2), "original_price": round(orig, 2), "discount_pct": _disc(orig, sale)}


def parse_evo_browser_snapshot(snapshot: dict, url: str) -> dict | None:
    product = (snapshot.get("ShopifyAnalytics") or {}).get("meta", {}).get("product") or {}
    regios = snapshot.get("RegiosDOPP_ProductPage") or {}
    inventory_blob = snapshot.get("igProductData") or {}
    inventory = inventory_blob.get(str(product.get("id"))) or inventory_blob.get(product.get("id")) or {}
    variants = regios.get("variants") or []
    available = [variant for variant in variants if not variant.get("isOutOfStock")]
    fallback_sale = (_num(inventory.get("lowestVariantPrice")) or 0) / 100
    fallback_orig = (_num(regios.get("compareAtPriceInCents")) or 0) / 100
    if available:
        # lowestVariantPrice is product-wide and can belong to a sold-out
        # clearance colour. Once availability is known, price only those rows.
        prices = [(_num(variant.get("priceInCents")) or 0) / 100 for variant in available]
        compares = [(_num(variant.get("compareAtPriceInCents")) or 0) / 100 for variant in available]
        prices = [price for price in prices if price > 0]
        compares = [compare for compare in compares if compare > 0]
        if prices:
            sale = min(prices)
            orig = max(compares) if compares else sale
            if orig < sale:
                orig = sale
            return {
                "sale_price": round(sale, 2),
                "original_price": round(orig, 2),
                "discount_pct": _disc(orig, sale),
            }
        return None
    if variants:
        return {"_unavailable": True}
    if fallback_sale > 0:
        orig = fallback_orig if fallback_orig >= fallback_sale else fallback_sale
        return {
            "sale_price": round(fallback_sale, 2),
            "original_price": round(orig, 2),
            "discount_pct": _disc(orig, fallback_sale),
        }
    rendered = snapshot.get("RenderedProductPrice") or {}
    if rendered.get("available") is False:
        return {"_unavailable": True}
    if rendered.get("available") is not True:
        return None
    sale = _num(rendered.get("sale"))
    original = _num(rendered.get("original")) if rendered.get("discounted") else sale
    if not sale or sale <= 0:
        return None
    # A red rendered price is a sale. Fail closed unless the corresponding
    # compare-at value is present in the same product-price container.
    if rendered.get("discounted") and not original:
        return None
    original = original or sale
    if original < sale:
        return None
    return {
        "sale_price": round(sale, 2),
        "original_price": round(original, 2),
        "discount_pct": _disc(original, sale),
    }


def fetch_evo_pdp_browser(page, url: str) -> dict | None:
    separator = "&" if "?" in url else "?"
    request_url = f"{url}{separator}price_revalidate={time.time_ns()}"
    try:
        response = page.goto(request_url, wait_until="commit", timeout=90000)
        wait_ms = int(_env_float("EVO_BROWSER_SETTLE_SECONDS", 8.0, 3.0) * 1000)
        page.wait_for_timeout(wait_ms)
    except Exception as e:
        return {"_err": _format_error("goto", e)}
    if not response or response.status != 200:
        return {"_err": f"http {response.status if response else 'unknown'}"}
    snapshot = page.evaluate(
        """() => {
          const money = /(?:US)?\\$\\s*[0-9][0-9,.]*/;
          const visible = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          };
          const candidates = Array.from(document.querySelectorAll('[data-price]'))
            .filter((element) => visible(element) && money.test(element.textContent || ''));
          const priceNode = candidates.find((element) => element.closest('main,[role="main"]'))
            || candidates[0]
            || null;
          let compareNode = null;
          let scope = priceNode ? priceNode.parentElement : null;
          for (let depth = 0; scope && depth < 4 && !compareNode; depth += 1) {
            compareNode = Array.from(scope.querySelectorAll('s,del,[class*="line-through" i]'))
              .find((element) => visible(element) && money.test(element.textContent || ''))
              || null;
            scope = scope.parentElement;
          }

          let structuredAvailability = null;
          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const parsed = JSON.parse(script.textContent || 'null');
              const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
              while (queue.length) {
                const value = queue.shift();
                if (!value || typeof value !== 'object') continue;
                if (Array.isArray(value)) {
                  queue.push(...value);
                  continue;
                }
                if (value['@graph']) queue.push(value['@graph']);
                if (value.offers) queue.push(value.offers);
                const availability = String(value.availability || '');
                if (/InStock$/i.test(availability)) structuredAvailability = true;
                if (/OutOfStock$/i.test(availability) && structuredAvailability === null) {
                  structuredAvailability = false;
                }
              }
            } catch (_) {
              // Malformed optional structured data must not break price parsing.
            }
          }
          const buttons = Array.from(document.querySelectorAll('button'));
          const buyButton = buttons.find((button) =>
            /add to (cart|bag)/i.test(button.textContent || '') && !button.disabled
          );
          const soldOutButton = buttons.find((button) =>
            /(sold out|out of stock|unavailable)/i.test(button.textContent || '')
          );
          const available = structuredAvailability !== null
            ? structuredAvailability
            : (buyButton ? true : (soldOutButton ? false : null));

          return {
            ShopifyAnalytics: window.ShopifyAnalytics || null,
            igProductData: window.igProductData || null,
            RegiosDOPP_ProductPage: window.RegiosDOPP_ProductPage || null,
            RenderedProductPrice: {
              sale: priceNode ? priceNode.textContent : null,
              original: compareNode ? compareNode.textContent : null,
              discounted: Boolean(priceNode && /text-red/i.test(String(priceNode.className || ''))),
              available,
            },
          };
        }"""
    )
    parsed = parse_evo_browser_snapshot(snapshot, url)
    return parsed or {"_err": "no_browser_price"}


def fetch_evo_pdp_browser_with_retry(
    browser,
    url: str,
    *,
    retry_flat: bool = False,
) -> dict | None:
    attempts = _env_int("EVO_BROWSER_CONFIRM_ATTEMPTS", 2, 1)
    retry_delay = _env_float("EVO_BROWSER_RETRY_DELAY_SECONDS", 5.0, 0.0)
    result = None
    best_result = None
    for attempt in range(attempts):
        page = browser.new_page()
        page.set_default_navigation_timeout(90000)
        try:
            try:
                result = fetch_evo_pdp_browser(page, url)
            except Exception as exc:
                result = {"_err": _format_error("browser", exc)}
        finally:
            page.close()
        if result and not result.get("_err"):
            best_result = (
                result
                if best_result is None
                else _evo_choose_more_informative_price(best_result, result)
            )
            if not retry_flat or _price_is_discounted(best_result):
                return best_result
        if attempt + 1 < attempts:
            time.sleep(retry_delay)
    return best_result or result or {"_err": "empty_browser_confirmation"}


def _evo_needs_browser_fallback(result: dict | None) -> bool:
    if not result:
        return True
    if result.get("_unavailable"):
        return False
    return bool(result.get("_err"))


def _evo_should_confirm_with_browser(result: dict | None) -> bool:
    """Confirm every usable Shopify snapshot because the PDP may have a deeper sale."""
    if not result or result.get("_err") or result.get("_unavailable"):
        return False
    sale = _num(result.get("sale_price"))
    original = _num(result.get("original_price"))
    if not sale or not original:
        return False
    return True


def _evo_choose_more_informative_price(direct_result: dict | None, browser_result: dict | None) -> dict | None:
    if not browser_result or browser_result.get("_err") or browser_result.get("_unavailable"):
        reason = (browser_result or {}).get("_err") or "unavailable_or_empty"
        return {"_err": f"browser_confirmation_failed:{reason}"}
    if not direct_result or direct_result.get("_err") or direct_result.get("_unavailable"):
        return browser_result

    direct_sale = _num(direct_result.get("sale_price"))
    direct_original = _num(direct_result.get("original_price"))
    browser_sale = _num(browser_result.get("sale_price"))
    browser_original = _num(browser_result.get("original_price"))
    if not browser_sale or not browser_original:
        return {"_err": "browser_confirmation_failed:invalid_price"}
    if not direct_sale or not direct_original:
        return browser_result

    sale = min(direct_sale, browser_sale)
    original = max(direct_original, browser_original, direct_sale, browser_sale)
    return {
        "sale_price": round(sale, 2),
        "original_price": round(original, 2),
        "discount_pct": _disc(original, sale),
    }


def _rei_variant_price(body: str, url: str) -> tuple[float, float] | None:
    """Return the cheapest available current-product SKU and its compare-at price."""
    product_match = re.search(r"/product/(\d+)/", url or "")
    if not product_match:
        return None
    product_id = product_match.group(1)
    decoder = json.JSONDecoder()
    marker = '"skus":'
    start = 0
    while True:
        marker_pos = body.find(marker, start)
        if marker_pos < 0:
            return None
        array_pos = marker_pos + len(marker)
        try:
            skus, _ = decoder.raw_decode(body[array_pos:])
        except (json.JSONDecodeError, TypeError):
            start = array_pos
            continue
        if not isinstance(skus, list) or not any(
            str(sku.get("skuId", "")).startswith(product_id)
            for sku in skus if isinstance(sku, dict)
        ):
            start = array_pos
            continue
        prices = []
        for sku in skus:
            if not isinstance(sku, dict) or sku.get("status") != "AVAILABLE":
                continue
            price = sku.get("price") or {}
            sale = _num((price.get("price") or {}).get("value"))
            original = _num((price.get("compareAt") or {}).get("value")) or sale
            if sale and str(sku.get("skuId", "")).startswith(product_id):
                prices.append((sale, max(original or sale, sale)))
        if not prices:
            return None
        lowest_sale = min(sale for sale, _ in prices)
        original = max(orig for sale, orig in prices if sale == lowest_sale)
        return lowest_sale, original

def fetch_rei_pdp(page, url: str) -> dict | None:
    """Read legacy/current buy-box prices, stopping on access restrictions."""
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=60000)
        response_error = _rei_response_error(response)
        if response_error:
            return response_error
        time.sleep(2)
    except Exception as e:
        return {"_err": _format_error("goto", e)}
    product_match = re.search(r"/product/(\d+)(?:/|$)", url or "")
    effective_url = str(getattr(page, "url", "") or "")
    if product_match and effective_url and not re.search(
        rf"/product/{re.escape(product_match.group(1))}(?:/|$)",
        effective_url,
    ):
        return {"_err": "product_redirect"}
    body = ""
    for _ in range(6):
        try:
            body = page.content()
            if len(body) >= 20000:
                break
        except Exception:
            # REI frequently replaces the document after domcontentloaded.
            pass
        time.sleep(2)
    if not body:
        return {"_err": "unstable_document"}
    if len(body) < 20000:
        return {"_err": "access_challenge"}
    if "page-not-found" in body.lower() or "page not found" in body.lower():
        return {"_unavailable": True}
    msale = re.search(r'data-ui="sale-price">\s*\$?([0-9.,]+)', body)
    mfull = re.search(r'data-ui="full-price">\s*[-\s]*\$?([0-9.,]+)', body)
    mreg  = re.search(r'data-ui="regular-price">\s*\$?([0-9.,]+)', body)
    mbuy  = re.search(r'id="buy-box-product-price"[^>]*>\s*\$?([0-9.,]+)', body)
    mitem = re.search(r'data-cnstrc-item-price="([0-9.,]+)"', body)
    sale = orig = None
    variant_price = _rei_variant_price(body, url)
    if variant_price:
        sale, orig = variant_price
    elif msale and mfull:
        sale = _num(msale.group(1)); orig = _num(mfull.group(1))
    elif mfull:
        sale = orig = _num(mfull.group(1))
    elif mreg:
        sale = orig = _num(mreg.group(1))
    elif msale:
        sale = orig = _num(msale.group(1))
    elif mbuy:
        sale = orig = _num(mbuy.group(1))
    elif mitem:
        sale = orig = _num(mitem.group(1))
    if not sale: return None
    if not orig: orig = sale
    result = {"sale_price": sale, "original_price": orig, "discount_pct": _disc(orig, sale)}
    integrity_error = _price_integrity_error(result)
    return {"_err": integrity_error} if integrity_error else result

def fetch_mec_pdp(session, url: str) -> dict | None:
    """MEC curl_cffi (impersonate=chrome). 解 __NEXT_DATA__.product 的 price.
    priceType=clearance → 有折扣; 否则满价 disc=0."""
    from dealers.mec import _get, _next_data, _parse_pdp_price
    r = _get(session, url)
    if not r: return {"_err": "http_failed"}
    d = _next_data(r.text)
    if not d: return {"_err": "no_next_data"}
    p = d.get("props",{}).get("pageProps",{}).get("product")
    if not p: return {"_err": "no_product"}
    if p.get("availabilityStatus") in ("Unavailable","SoldOut","Discontinued"):
        return {"_unavailable": True}
    sale, orig, disc = _parse_pdp_price(p)
    if not sale: return None
    return {
        "sale_price": float(sale),
        "original_price": float(orig or sale),
        "discount_pct": disc,
        "currency": "CAD",
        "symbol": "C$",
    }


def open_mec_revalidation_session(
    session_factory=None,
    warm_fn=None,
    browser_session_factory=None,
    browser_shim_factory=None,
    warm_url: str | None = None,
):
    """Use curl_cffi first, then Scrapling when MEC blocks the cookie warm-up flow."""
    if session_factory is None or warm_fn is None or browser_shim_factory is None or warm_url is None:
        from dealers.mec import HOST as MEC_HOST, _ScraplingShim, _make_session, _warm

        session_factory = session_factory or _make_session
        warm_fn = warm_fn or _warm
        browser_shim_factory = browser_shim_factory or _ScraplingShim
        warm_url = warm_url or f"{MEC_HOST}/en/"

    session = session_factory()
    if warm_fn(session):
        return session, None, "curl_cffi"

    if browser_session_factory is None:
        from scrapling.fetchers import StealthySession

        browser_session_factory = StealthySession

    browser_ctx = None
    try:
        browser_ctx = browser_session_factory(
            headless=True,
            network_idle=True,
            solve_cloudflare=True,
        )
        browser_session = browser_ctx.__enter__()
        browser_session.fetch(warm_url, timeout=90000)
        return browser_shim_factory(browser_session), browser_ctx, "scrapling"
    except Exception:
        if browser_ctx is not None:
            try:
                browser_ctx.__exit__(None, None, None)
            except Exception:
                pass
        raise

# ── Main runner ──────────────────────────────────────────────────────────
def load_all_dealer_rows(client):
    rows = []
    page = 0
    while True:
        res = client.table("products").select(
            "sku_id,dealer,url,sale_price,original_price,last_updated,"
            "status,missing_runs,last_seen_at,url_http_status,url_checked_at"
        ).neq("dealer", "arcteryx_outlet").range(page*1000, page*1000+999).execute()
        data = res.data or []
        rows.extend(data)
        if len(data) < 1000: break
        page += 1
    return rows

def update_row(client, sku_id, patch, old_row):
    """Persist a successful official PDP read and reactivate its lifecycle."""
    if not patch: return False
    integrity_error = _price_integrity_error(patch)
    if integrity_error:
        print(
            f"  INVALID PRICE {sku_id}: {integrity_error}; refusing update",
            file=sys.stderr,
        )
        return False
    now_iso = datetime.now(timezone.utc).isoformat()
    patch = dict(patch)
    patch.update({
        "status": "active",
        "missing_runs": 0,
        "last_seen_at": now_iso,
        "last_updated": now_iso,
        "url_http_status": 200,
        "url_checked_at": now_iso,
    })
    try:
        client.table("products").update(patch).eq("sku_id", sku_id).execute()
    except Exception as e:
        print(f"  UPDATE ERR {sku_id}: {str(e)[:100]}", file=sys.stderr)
        return False
    # 价格变了, 记录历史
    new_sale = patch.get("sale_price")
    old_sale = old_row.get("sale_price")
    if new_sale is not None and old_sale is not None and abs(new_sale - old_sale) > 0.01:
        try:
            client.table("price_history").insert({
                "sku_id":         sku_id,
                "sale_price":     new_sale,
                "original_price": patch.get("original_price") or old_row.get("original_price"),
                "discount_pct":   patch.get("discount_pct"),
                "recorded_at":    now_iso,
            }).execute()
        except Exception:
            pass
    return True


def quarantine_invalid_price_row(client, row: dict, reason: str) -> bool:
    """Hide one already-invalid active row without changing its price evidence."""
    if row.get("status") != "active":
        return False
    if _price_integrity_error(row) != "original_below_sale":
        return False
    try:
        missing_runs = max(1, int(row.get("missing_runs") or 0))
    except (TypeError, ValueError):
        missing_runs = 1
    patch = {
        "status": "missing",
        "missing_runs": missing_runs,
        "url_http_status": None,
        "url_checked_at": None,
    }
    try:
        client.table("products").update(patch).eq("sku_id", row["sku_id"]).execute()
    except Exception as exc:
        print(
            f"  QUARANTINE ERR {row.get('sku_id')}: {str(exc)[:100]}",
            file=sys.stderr,
        )
        return False
    print(
        f"  quarantined {row['sku_id']}: {reason}; prices unchanged",
        flush=True,
    )
    return True


def underperforming_dealers(by_dealer, stats, minimum_success_ratio: float = 0.70) -> list[str]:
    return sorted(
        d for d, dealer_rows in by_dealer.items()
        if dealer_rows and (
            stats[d]["ok"]
            + stats[d]["unavail"]
            + stats[d].get("quarantined", 0)
        ) / len(dealer_rows) < minimum_success_ratio
    )

def _chunks(rows, size):
    for start in range(0, len(rows), size):
        yield start, rows[start:start + size]


_REI_NON_RETRYABLE_ERRORS = {
    "non_positive_original",
    "non_positive_sale",
    "original_below_sale",
    "product_redirect",
}


def _rei_should_retry(result: dict | None) -> bool:
    """Retry transient REI reads, but keep deterministic lifecycle results final."""
    if not result:
        return True
    if result.get("_unavailable") or _rei_access_restricted(result):
        return False
    error = result.get("_err")
    return bool(error and error not in _REI_NON_RETRYABLE_ERRORS)


def _rei_access_restricted(result: dict | None) -> bool:
    return (result or {}).get("_err") in {
        "http_401", "http_403", "http_429", "access_challenge", "cf_stub",
    }


def _rei_response_error(response) -> dict | None:
    """Classify an REI navigation response without reading a challenge body."""
    status = getattr(response, "status", None)
    if status in (401, 403, 429):
        headers = getattr(response, "headers", {}) or {}
        return {
            "_err": f"http_{status}",
            "_http_status": status,
            "_retry_after": str(headers.get("retry-after", ""))[:100],
        }
    if isinstance(status, int) and status >= 500:
        return {"_err": f"http_{status}"}
    return None


def warm_rei_page(page, *, sleep_fn=None) -> dict | None:
    """Establish REI's first-party browser session before opening a PDP.

    The price-audit path already follows this sequence. Keep the warm-up bounded
    to one official homepage navigation and surface access denial immediately so
    callers can stop without touching any PDPs.
    """
    sleep_fn = sleep_fn or time.sleep
    try:
        response = page.goto(
            "https://www.rei.com/",
            wait_until="domcontentloaded",
            timeout=60000,
        )
    except Exception as exc:
        return {"_err": _format_error("warmup", exc)}
    response_error = _rei_response_error(response)
    if response_error:
        return response_error
    sleep_fn(2)
    return None


def _rei_browser_is_poisoned(result: dict | None) -> bool:
    """An unstable document may require a fresh browser for network recovery."""
    error = str((result or {}).get("_err") or "")
    return error == "unstable_document" or error.startswith("goto ")


def fetch_rei_rows_with_browser_retries(
    rows,
    *,
    attempts: int | None = None,
    chunk_size: int | None = None,
    delay: float | None = None,
    browser_context_factory=None,
    fetch_fn=None,
    sleep_fn=None,
):
    """Bound transient reads; one access denial stops all remaining REI requests.

    A denied/challenged response is not evidence about stock or price. Preserve
    earlier successful results and mark every unverified row as failed without
    retrying, including across chunks. Retry-After is reported for operators;
    this run makes no further requests to the source.
    """
    rows = list(rows)
    attempts = attempts or _env_int("REI_REVALIDATE_ATTEMPTS", 3, 1)
    chunk_size = chunk_size or _env_int("REI_BROWSER_ROTATE_ROWS", 5, 1)
    delay = delay if delay is not None else _env_float(
        "REI_REVALIDATE_DELAY_SECONDS", 3.0, 0.0
    )
    retry_delay = _env_float("REI_REVALIDATE_RETRY_DELAY_SECONDS", 5.0, 0.0)
    browser_context_factory = browser_context_factory or open_camoufox_browser
    fetch_fn = fetch_fn or fetch_rei_pdp
    sleep_fn = sleep_fn or time.sleep

    pending = rows
    final_results = {}
    last_results = {}

    for attempt in range(1, attempts + 1):
        retry_rows = []
        retry_ids = set()
        for _, chunk in _chunks(pending, chunk_size):
            page = None
            try:
                with browser_context_factory() as browser:
                    page = browser.new_page()
                    warm_result = warm_rei_page(page, sleep_fn=sleep_fn)
                    if warm_result:
                        if _rei_access_restricted(warm_result):
                            print(
                                f"  [rei] source restricted during warm-up "
                                f"({warm_result['_err']}); remaining requests stopped; "
                                f"Retry-After="
                                f"{warm_result.get('_retry_after') or 'unspecified'}",
                                flush=True,
                            )
                            restricted_sku_id = chunk[0]["sku_id"] if chunk else None
                            return [
                                (
                                    item,
                                    final_results.get(item["sku_id"], {
                                        "_err": (
                                            warm_result["_err"]
                                            if item["sku_id"] == restricted_sku_id
                                            else "source_access_deferred"
                                        ),
                                        "_cause": warm_result["_err"],
                                        "_retry_after": warm_result.get(
                                            "_retry_after", ""
                                        ),
                                    }),
                                )
                                for item in rows
                            ]
                        for row in chunk:
                            sku_id = row["sku_id"]
                            retry_rows.append(row)
                            retry_ids.add(sku_id)
                            last_results[sku_id] = warm_result
                        continue
                    for index, row in enumerate(chunk):
                        sku_id = row["sku_id"]
                        result = fetch_fn(page, row["url"])
                        normalized = result or {"_err": "empty_result"}
                        last_results[sku_id] = normalized
                        if _rei_access_restricted(normalized):
                            final_results[sku_id] = normalized
                            print(
                                f"  [rei] source restricted ({normalized['_err']}); "
                                f"remaining requests stopped; Retry-After="
                                f"{normalized.get('_retry_after') or 'unspecified'}",
                                flush=True,
                            )
                            return [
                                (item, final_results.get(item["sku_id"], {
                                    "_err": "source_access_deferred",
                                    "_cause": normalized["_err"],
                                    "_retry_after": normalized.get("_retry_after", ""),
                                }))
                                for item in rows
                            ]
                        if _rei_should_retry(result):
                            retry_rows.append(row)
                            retry_ids.add(sku_id)
                            if _rei_browser_is_poisoned(normalized):
                                for tail in chunk[index + 1:]:
                                    tail_id = tail["sku_id"]
                                    if tail_id not in retry_ids:
                                        retry_rows.append(tail)
                                        retry_ids.add(tail_id)
                                        last_results[tail_id] = {
                                            "_err": f"browser_poisoned:{normalized['_err']}"
                                        }
                                break
                        else:
                            final_results[sku_id] = normalized
                        sleep_fn(delay)
            except Exception as exc:
                failure = {"_err": _format_error("browser", exc)}
                for row in chunk:
                    sku_id = row["sku_id"]
                    if sku_id in final_results or sku_id in retry_ids:
                        continue
                    retry_rows.append(row)
                    retry_ids.add(sku_id)
                    last_results[sku_id] = failure
            finally:
                if page is not None:
                    try:
                        page.close()
                    except Exception:
                        pass

        if not retry_rows:
            break
        if attempt == attempts:
            for row in retry_rows:
                sku_id = row["sku_id"]
                final_results[sku_id] = last_results.get(
                    sku_id, {"_err": "retry_exhausted"}
                )
            break
        print(
            f"  [rei] transient read failures={len(retry_rows)}; "
            f"fresh-browser retry {attempt + 1}/{attempts}",
            flush=True,
        )
        if retry_delay:
            sleep_fn(retry_delay * attempt)
        pending = retry_rows

    return [
        (row, final_results.get(row["sku_id"], last_results.get(row["sku_id"])))
        for row in rows
    ]

def _close_context(context):
    if context is None:
        return
    try:
        context.__exit__(None, None, None)
    except Exception:
        pass

def main():
    if not SB_KEY:
        sys.exit("SUPABASE_KEY required (service_role)")
    from supabase import create_client
    client = create_client(SB_URL, SB_KEY)
    rows = [
        row
        for row in load_all_dealer_rows(client)
        if row.get("dealer") in REVALIDATION_DEALERS
    ]
    selected = requested_dealers()
    if selected is not None:
        rows = [row for row in rows if row.get("dealer") in selected]
        print(
            "[reval] bounded dealer subset: " + ", ".join(sorted(selected)),
            flush=True,
        )
    selected_sku_ids = requested_sku_ids()
    if selected_sku_ids is not None:
        available_sku_ids = {row.get("sku_id") for row in rows}
        missing_sku_ids = sorted(selected_sku_ids - available_sku_ids)
        if missing_sku_ids:
            raise ValueError(
                "requested SKU IDs not found in selected dealer rows: "
                + ", ".join(missing_sku_ids)
            )
        rows = [row for row in rows if row.get("sku_id") in selected_sku_ids]
        print(
            f"[reval] bounded exact SKU allowlist: {len(selected_sku_ids)}",
            flush=True,
        )
    max_rows_per_dealer = requested_max_rows_per_dealer()
    rows = select_oldest_rows_per_dealer(
        rows,
        max_rows_per_dealer,
        exact_sku_ids=selected_sku_ids,
    )
    if max_rows_per_dealer is not None and selected_sku_ids is None:
        print(
            "[reval] bounded oldest-first cohort: "
            f"maximum {max_rows_per_dealer} rows per dealer",
            flush=True,
        )
    elif max_rows_per_dealer is not None:
        print(
            "[reval] exact SKU allowlist takes precedence over scheduled cohort limit",
            flush=True,
        )
    print(f"[reval] loaded {len(rows)} dealer rows", flush=True)
    by_dealer = defaultdict(list)
    for r in rows:
        by_dealer[r.get("dealer")].append(r)
    for d, rs in by_dealer.items():
        print(f"  {d}: {len(rs)}", flush=True)

    stats = defaultdict(
        lambda: {
            "ok": 0,
            "skip": 0,
            "err": 0,
            "unavail": 0,
            "diff": 0,
            "quarantined": 0,
        }
    )

    # ── EVO: 纯 HTTP, 最快 ──
    print(f"\n[reval] EVO ({len(by_dealer.get('evo', []))})", flush=True)
    evo_rows = by_dealer.get("evo", [])
    evo_browser_cm = None
    evo_browser = None
    try:
        for i, r in enumerate(evo_rows, 1):
            new = fetch_evo_pdp(r["url"])
            if _evo_needs_browser_fallback(new):
                retry = fetch_evo_pdp(r["url"])
                if retry and not retry.get("_err"):
                    new = retry
                elif retry and retry.get("_unavailable"):
                    new = retry
                else:
                    if evo_browser is None:
                        evo_browser_cm = open_camoufox_browser()
                        evo_browser = evo_browser_cm.__enter__()
                    new = fetch_evo_pdp_browser_with_retry(
                        evo_browser,
                        r["url"],
                        retry_flat=(
                            (r.get("original_price") or 0)
                            > (r.get("sale_price") or 0) + 0.01
                        ),
                    )
            elif _evo_should_confirm_with_browser(new):
                if evo_browser is None:
                    evo_browser_cm = open_camoufox_browser()
                    evo_browser = evo_browser_cm.__enter__()
                new = _evo_choose_more_informative_price(
                    new,
                    fetch_evo_pdp_browser_with_retry(
                        evo_browser,
                        r["url"],
                        retry_flat=(
                            (r.get("original_price") or 0)
                            > (r.get("sale_price") or 0) + 0.01
                        ),
                    ),
                )
            if not new:
                stats["evo"]["err"] += 1
            elif new.get("_unavailable"):
                stats["evo"]["unavail"] += 1
            elif new.get("_err"):
                stats["evo"]["err"] += 1
            else:
                if update_row(client, r["sku_id"], new, r):
                    stats["evo"]["ok"] += 1
                    if abs((new.get("sale_price") or 0) - (r.get("sale_price") or 0)) > 0.01:
                        stats["evo"]["diff"] += 1
                else:
                    stats["evo"]["err"] += 1
            if i % 50 == 0: print(f"  evo {i}/{len(evo_rows)}", flush=True)
            time.sleep(0.1)
    finally:
        if evo_browser_cm is not None:
            try:
                evo_browser_cm.__exit__(None, None, None)
            except Exception:
                pass

    # ── REI: Camoufox (curl_cffi 在 AWS Lightsail 上被 Akamai 拒) ──
    if by_dealer.get("rei"):
        # Oldest first ensures rate-limited tail rows are first on the next run.
        rei_rows = sorted(by_dealer["rei"], key=lambda row: row.get("last_updated") or "")
        rei_delay = _env_float("REI_REVALIDATE_DELAY_SECONDS", 3.0, 0.5)
        chunk_size = _env_int("REI_BROWSER_ROTATE_ROWS", 5, 5)
        rei_attempts = _env_int("REI_REVALIDATE_ATTEMPTS", 3, 1)
        print(
            f"\n[reval] REI ({len(rei_rows)}) — Camoufox, "
            f"delay={rei_delay}s, rotate={chunk_size}, attempts={rei_attempts}",
            flush=True,
        )
        rei_results = fetch_rei_rows_with_browser_retries(
            rei_rows,
            attempts=rei_attempts,
            chunk_size=chunk_size,
            delay=rei_delay,
        )
        for i, (r, new) in enumerate(rei_results, 1):
            if not new: stats["rei"]["err"] += 1
            elif new.get("_unavailable"): stats["rei"]["unavail"] += 1
            elif new.get("_err"):
                if (
                    new["_err"] in {"product_redirect", "original_below_sale"}
                    and quarantine_invalid_price_row(client, r, new["_err"])
                ):
                    stats["rei"]["quarantined"] += 1
                else:
                    stats["rei"]["err"] += 1
            else:
                if update_row(client, r["sku_id"], new, r):
                    stats["rei"]["ok"] += 1
                    if abs((new.get("sale_price") or 0) - (r.get("sale_price") or 0)) > 0.01:
                        stats["rei"]["diff"] += 1
                else:
                    stats["rei"]["err"] += 1
            if i % 5 == 0:
                print(f"  rei {i}/{len(rei_rows)}", flush=True)

    # ── MEC: curl_cffi (Chrome TLS 指纹, 不用浏览器) ──
    if by_dealer.get("mec"):
        print(f"\n[reval] MEC ({len(by_dealer['mec'])}) — curl_cffi", flush=True)
        rotate_rows = _env_int("MEC_BROWSER_ROTATE_ROWS", 40, 10)
        mec_s = None
        mec_browser_ctx = None
        mec_source = None
        try:
            for i, r in enumerate(by_dealer["mec"], 1):
                rotate = (
                    mec_source == "scrapling"
                    and i > 1
                    and (i - 1) % rotate_rows == 0
                )
                if mec_s is None or rotate:
                    _close_context(mec_browser_ctx)
                    mec_s, mec_browser_ctx, mec_source = open_mec_revalidation_session()
                    if mec_source == "scrapling":
                        print(
                            f"  [mec] using Scrapling fallback for rows "
                            f"{i}-{min(i + rotate_rows - 1, len(by_dealer['mec']))}",
                            flush=True,
                        )
                new = fetch_mec_pdp(mec_s, r["url"])
                if not new: stats["mec"]["err"] += 1
                elif new.get("_unavailable"): stats["mec"]["unavail"] += 1
                elif new.get("_err"): stats["mec"]["err"] += 1
                else:
                    if update_row(client, r["sku_id"], new, r):
                        stats["mec"]["ok"] += 1
                        if abs((new.get("sale_price") or 0) - (r.get("sale_price") or 0)) > 0.01:
                            stats["mec"]["diff"] += 1
                if i % 20 == 0: print(f"  mec {i}/{len(by_dealer['mec'])}", flush=True)
                time.sleep(0.4)
        except Exception as e:
            print(f"  MEC fetch err: {e}", file=sys.stderr)
        finally:
            _close_context(mec_browser_ctx)

    print("\n=== REVAL DONE ===")
    for d in sorted(by_dealer):
        s = stats[d]
        print(
            f"  {d:8s} ok={s['ok']:4d}  价变={s['diff']:3d}  "
            f"缺货={s['unavail']:3d}  隔离={s['quarantined']:3d}  错={s['err']:3d}"
        )

    failed_dealers = underperforming_dealers(by_dealer, stats)
    if failed_dealers:
        raise SystemExit(
            "[reval] successful validation ratio below 70% for: "
            + ", ".join(failed_dealers)
        )

if __name__ == "__main__":
    main()
