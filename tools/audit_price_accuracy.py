#!/usr/bin/env python3
"""Read-only, stratified official-price audit for production products.

The audit deliberately does not import or use the Supabase service-role key.
It reads the public production catalog through the frontend anon API, samples
exactly 100 active positive-price SKUs, and compares each row with two
independent official-source reads.

Dealer browser policy mirrors the proven production revalidator while keeping
the audit read-only:

* Evo: raw official Shopify variants, independently enumerated without a browser.
* REI: warmed, humanized Camoufox contexts with bounded rotation.
* MEC: existing curl_cffi/Scrapling read-only session.
* Arc'teryx Outlet: official structured product data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import subprocess
import sys
import time
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dealers.revalidate import (  # noqa: E402
    fetch_mec_pdp,
    fetch_rei_pdp,
    open_camoufox_browser,
    open_mec_revalidation_session,
)
from dealers.source_registry import PRICE_AUDIT_TARGETS  # noqa: E402
from sku_scraper import (  # noqa: E402
    normalize_color,
    parse_next_product_from_html,
    price_from_variants,
)
from tools.check_data_quality import parse_frontend_config  # noqa: E402
from tools.evo_price_evidence import (  # noqa: E402
    check_evo_output_pair,
    fetch_evo_official_read,
    has_evo_variant_evidence,
)

SELECT = ",".join(
    [
        "sku_id",
        "dealer",
        "region",
        "color",
        "currency",
        "symbol",
        "sale_price",
        "original_price",
        "discount_pct",
        "url",
        "status",
        "last_updated",
    ]
)

DEALER_TARGETS = dict(PRICE_AUDIT_TARGETS)

TRANSIENT_AUDIT_ERROR_MARKERS = (
    "browser",
    "cf_stub",
    "connection",
    "goto",
    "http 401",
    "http 403",
    "http 429",
    "missing_dealer_result",
    "proxyerror",
    "readtimeout",
    "runtimeerror",
    "timeout",
    "unstable_document",
    "warmup",
)


class AuditSetupError(RuntimeError):
    """The audit could not establish its required read-only evidence surface."""


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def env_float(name: str, default: float, minimum: float = 0.0) -> float:
    try:
        return max(minimum, float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return max(minimum, default)


def env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return max(minimum, default)


def format_error(prefix: str, exc: Exception) -> dict:
    detail = " ".join(str(exc).split())
    suffix = f": {detail[:180]}" if detail else ""
    return {"_err": f"{prefix} {type(exc).__name__}{suffix}"}


def calc_discount(original: float | None, sale: float | None) -> int | None:
    try:
        original_value = float(original or 0)
        sale_value = float(sale or 0)
    except (TypeError, ValueError):
        return None
    if original_value <= 0 or sale_value <= 0:
        return None
    if sale_value > original_value:
        return 0
    return round((1 - sale_value / original_value) * 100)


def normalize_read(result: dict | None) -> dict:
    if not result:
        return {"_err": "empty_result"}
    evidence = {"evo_evidence": result["evo_evidence"]} if "evo_evidence" in result else {}
    if result.get("_unavailable"):
        return {"_err": "official_unavailable", **evidence}
    if result.get("_err"):
        return {"_err": str(result["_err"])[:240], **evidence}
    try:
        sale = round(float(result.get("sale_price") or 0), 2)
        original = round(float(result.get("original_price") or sale), 2)
    except (TypeError, ValueError):
        return {"_err": "invalid_numeric_price", **evidence}
    if not math.isfinite(sale) or not math.isfinite(original):
        return {"_err": "invalid_numeric_price", **evidence}
    if sale <= 0:
        return {"_err": "non_positive_sale", **evidence}
    if original < sale:
        return {"_err": "original_below_sale", **evidence}
    return {
        "sale_price": sale,
        "original_price": original,
        "discount_pct": calc_discount(original, sale),
        **evidence,
    }


def same_price(first: dict, second: dict) -> bool:
    if "evo_evidence" in first or "evo_evidence" in second:
        if not has_evo_variant_evidence(first) or not has_evo_variant_evidence(second):
            return False
        first_evidence, second_evidence = first["evo_evidence"], second["evo_evidence"]
        return all(first_evidence[key] == second_evidence[key] for key in (
            "sale_cents", "original_cents"
        ))
    return (
        abs(float(first.get("sale_price") or 0) - float(second.get("sale_price") or 0)) <= 0.01
        and abs(float(first.get("original_price") or 0) - float(second.get("original_price") or 0)) <= 0.01
        and int(first.get("discount_pct") or 0) == int(second.get("discount_pct") or 0)
    )


def db_matches(row: dict, official: dict) -> bool:
    if row.get("dealer") == "evo":
        if not has_evo_variant_evidence(official):
            return False
        proof = check_evo_output_pair(official, row)
        if not all(proof[key] for key in (
            "pair_exists", "sale_is_available_minimum", "matches_canonical_pair"
        )):
            return False
    db_sale = round(float(row.get("sale_price") or 0), 2)
    db_original = round(float(row.get("original_price") or 0), 2)
    db_discount = calc_discount(db_original, db_sale)
    return (
        db_sale > 0
        and db_original >= db_sale
        and db_discount == int(row.get("discount_pct") or 0)
        and abs(db_sale - float(official["sale_price"])) <= 0.01
        and abs(db_original - float(official["original_price"])) <= 0.01
        and db_discount == int(official.get("discount_pct") or 0)
    )


def load_online_rows() -> list[dict]:
    base_url, anon_key = parse_frontend_config()
    headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {anon_key}",
        "Accept": "application/json",
    }
    rows: list[dict] = []
    page_size = 1000
    session = requests.Session()
    for offset in range(0, 60000, page_size):
        response = None
        last_error = None
        for attempt in range(3):
            try:
                response = session.get(
                    f"{base_url}/rest/v1/products",
                    params={"select": SELECT, "order": "sku_id.asc"},
                    headers={**headers, "Range": f"{offset}-{offset + page_size - 1}"},
                    timeout=45,
                )
                response.raise_for_status()
                break
            except requests.RequestException as exc:
                last_error = exc
                if attempt + 1 < 3:
                    time.sleep(2**attempt)
        if response is None or not response.ok:
            raise AuditSetupError(f"production catalog read failed: {last_error}")
        data = response.json()
        rows.extend(data)
        if len(data) < page_size:
            break
    return rows


def eligible_rows(rows: Iterable[dict]) -> list[dict]:
    eligible: list[dict] = []
    for row in rows:
        if (row.get("status") or "active") != "active":
            continue
        dealer = row.get("dealer") or "arcteryx_outlet"
        if dealer not in DEALER_TARGETS:
            continue
        try:
            sale_price = float(row.get("sale_price") or 0)
        except (TypeError, ValueError):
            sale_price = 0
        if sale_price <= 0 or not row.get("url") or not row.get("sku_id"):
            continue
        eligible.append(row)
    return eligible


def sample_rows(rows: list[dict], run_start: str, origin_sha: str) -> tuple[list[dict], int]:
    seed_material = f"{run_start}|{origin_sha}"
    seed = int(hashlib.sha256(seed_material.encode("utf-8")).hexdigest()[:16], 16)
    rng = random.Random(seed)
    pools = {
        dealer: [
            row
            for row in rows
            if (row.get("dealer") or "arcteryx_outlet") == dealer
        ]
        for dealer in DEALER_TARGETS
    }
    chosen: list[dict] = []
    for dealer, target in DEALER_TARGETS.items():
        pool = pools[dealer][:]
        if len(pool) < target:
            raise AuditSetupError(
                f"insufficient eligible rows for {dealer}: {len(pool)} < {target}"
            )
        rng.shuffle(pool)
        chosen.extend(pool[:target])
    rng.shuffle(chosen)
    if (
        len(chosen) != 100
        or len({row["sku_id"] for row in chosen}) != 100
        or Counter(
            (row.get("dealer") or "arcteryx_outlet") for row in chosen
        ) != Counter(DEALER_TARGETS)
    ):
        raise AuditSetupError(f"sample sizing failed: got {len(chosen)} unique rows")
    return chosen, seed


def sample_rows_from_artifact(rows: list[dict], path: Path) -> tuple[list[dict], int]:
    source = json.loads(path.read_text(encoding="utf-8"))
    audits = source.get("audits")
    if not isinstance(audits, list) or len(audits) != 100:
        raise AuditSetupError("sample artifact must contain exactly 100 audits")
    sample_ids = [str(item.get("sku_id") or "") for item in audits]
    if len(set(sample_ids)) != 100 or any(not sku_id for sku_id in sample_ids):
        raise AuditSetupError("sample artifact contains missing or duplicate sku_id values")
    current = {row["sku_id"]: row for row in rows}
    missing = [sku_id for sku_id in sample_ids if sku_id not in current]
    if missing:
        raise AuditSetupError(
            "sample rows are no longer eligible: " + ", ".join(missing[:10])
        )
    seed = int(source.get("sample_seed") or 0)
    sample = [current[sku_id] for sku_id in sample_ids]
    counts = Counter((row.get("dealer") or "arcteryx_outlet") for row in sample)
    if counts != Counter(DEALER_TARGETS):
        raise AuditSetupError(
            f"sample artifact dealer counts do not match contract: {dict(counts)}"
        )
    return sample, seed


def read_outlet(row: dict, session: requests.Session) -> dict:
    url = row.get("url")
    color = row.get("color")
    if not url:
        return {"_err": "missing_url"}
    if not color:
        return {"_err": "missing_color"}
    try:
        if "arcteryx.com.au/products/" in url:
            parsed = urllib.parse.urlsplit(url)
            api_url = urllib.parse.urlunsplit(
                (parsed.scheme, parsed.netloc, parsed.path.rstrip("/") + ".js", "", "")
            )
            response = session.get(
                api_url,
                headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
                timeout=45,
            )
            response.raise_for_status()
            variants = response.json().get("variants") or []
            target = normalize_color(color)
            prices = []
            for variant in variants:
                variant_color = normalize_color(
                    (variant.get("option1") or variant.get("option2") or "").strip()
                )
                if target and variant_color != target:
                    continue
                if variant.get("available") is False:
                    continue
                sale = float(variant.get("price") or 0) / 100
                original = float(
                    variant.get("compare_at_price") or variant.get("price") or 0
                ) / 100
                if sale > 0:
                    prices.append((sale, max(original, sale)))
            if not prices:
                return {"_err": "color_variant_not_found"}
            sale = min(price for price, _ in prices)
            original = max(
                original
                for price, original in prices
                if abs(price - sale) <= 0.0001
            )
            return normalize_read(
                {"sale_price": sale, "original_price": original}
            )

        parsed = urllib.parse.urlsplit(url)
        cache_bust = f"price_audit={time.time_ns()}"
        query = f"{parsed.query}&{cache_bust}" if parsed.query else cache_bust
        request_url = urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment)
        )
        response = session.get(
            request_url,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"},
            timeout=45,
        )
        response.raise_for_status()
        product_data = parse_next_product_from_html(response.text)
        if not product_data:
            return {"_err": "no_next_data"}
        pricing = price_from_variants(product_data, color)
        if not pricing:
            return {"_err": "color_variant_not_found"}
        sale, original = pricing
        return normalize_read(
            {"sale_price": sale, "original_price": original}
        )
    except Exception as exc:
        return format_error("outlet", exc)


def read_evo(row: dict, session=None) -> dict:
    return normalize_read(fetch_evo_official_read(row["url"], session))


def read_mec(row: dict, session) -> dict:
    try:
        return normalize_read(fetch_mec_pdp(session, row["url"]))
    except Exception as exc:
        return format_error("mec", exc)


def chunks(rows: list[dict], size: int) -> Iterable[list[dict]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def assign_runtime_error(
    results: dict[str, dict],
    rows: Iterable[dict],
    prefix: str,
    exc: Exception,
) -> None:
    error = format_error(prefix, exc)
    for row in rows:
        results.setdefault(row["sku_id"], error)


def read_outlet_pass(rows: list[dict]) -> dict[str, dict]:
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    return {row["sku_id"]: read_outlet(row, session) for row in rows}


def read_evo_pass(rows: list[dict]) -> dict[str, dict]:
    results: dict[str, dict] = {}
    delay = env_float("EVO_AUDIT_DELAY_SECONDS", 0.8, 0.0)
    try:
        with requests.Session() as session:
            for index, row in enumerate(rows, 1):
                try:
                    results[row["sku_id"]] = read_evo(row, session)
                except Exception as exc:
                    results[row["sku_id"]] = format_error("evo", exc)
                print(f"  evo {index}/{len(rows)}", flush=True)
                if delay:
                    time.sleep(delay)
    except Exception as exc:
        assign_runtime_error(results, rows, "evo_http", exc)
    return results


def read_mec_pass(rows: list[dict]) -> dict[str, dict]:
    results: dict[str, dict] = {}
    browser_context = None
    try:
        session, browser_context, source = open_mec_revalidation_session()
        print(f"  mec source={source}", flush=True)
        for index, row in enumerate(rows, 1):
            results[row["sku_id"]] = read_mec(row, session)
            print(f"  mec {index}/{len(rows)}", flush=True)
    except Exception as exc:
        assign_runtime_error(results, rows, "mec_session", exc)
    finally:
        if browser_context is not None:
            try:
                browser_context.__exit__(None, None, None)
            except Exception:
                pass
    return results


def warm_page(browser, url: str, *, timeout: int = 60000):
    page = browser.new_page()
    page.set_default_navigation_timeout(timeout)
    first_error = None
    try:
        page.goto(url, wait_until="networkidle", timeout=timeout)
        page.wait_for_timeout(1500)
        return page, None
    except Exception as exc:
        first_error = exc
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        page.wait_for_timeout(1500)
        return page, None
    except Exception as exc:
        try:
            page.close()
        except Exception:
            pass
        detail = format_error("warmup", exc)
        if first_error is not None:
            detail["_err"] += f"; first={format_error('warmup', first_error)['_err']}"
        return None, detail


def read_rei_pass(rows: list[dict]) -> dict[str, dict]:
    results: dict[str, dict] = {}
    rotate_rows = env_int("REI_AUDIT_ROTATE_ROWS", 5, 1)
    delay = env_float("REI_AUDIT_DELAY_SECONDS", 3.0, 0.5)
    for chunk in chunks(rows, rotate_rows):
        try:
            with open_camoufox_browser() as browser:
                page, warm_error = warm_page(browser, "https://www.rei.com/")
                if page is None:
                    for row in chunk:
                        results[row["sku_id"]] = warm_error
                    continue
                try:
                    for row in chunk:
                        result = normalize_read(fetch_rei_pdp(page, row["url"]))
                        results[row["sku_id"]] = result
                        print(
                            f"  rei {len(results)}/{len(rows)}",
                            flush=True,
                        )
                        time.sleep(delay)
                finally:
                    page.close()
        except Exception as exc:
            assign_runtime_error(results, chunk, "rei_browser", exc)
    return results


PASS_READERS: dict[str, Callable[[list[dict]], dict[str, dict]]] = {
    "arcteryx_outlet": read_outlet_pass,
    "evo": read_evo_pass,
    "mec": read_mec_pass,
    "rei": read_rei_pass,
}


def is_retryable_audit_result(result: dict | None) -> bool:
    error = str((result or {}).get("_err") or "").lower()
    return bool(error) and any(
        marker in error for marker in TRANSIENT_AUDIT_ERROR_MARKERS
    )


def run_reader_with_transient_retries(
    dealer: str,
    rows: list[dict],
) -> dict[str, dict]:
    reader = PASS_READERS[dealer]

    def invoke(target_rows: list[dict]) -> dict[str, dict]:
        try:
            return reader(target_rows)
        except Exception as exc:
            failed: dict[str, dict] = {}
            assign_runtime_error(failed, target_rows, dealer, exc)
            return failed

    results = invoke(rows)
    retry_attempts = env_int("AUDIT_TRANSIENT_RETRY_ATTEMPTS", 1, 0)
    retry_delay = env_float("AUDIT_TRANSIENT_RETRY_DELAY_SECONDS", 5.0, 0.0)
    for attempt in range(1, retry_attempts + 1):
        retry_rows = [
            row
            for row in rows
            if is_retryable_audit_result(
                results.get(row["sku_id"], {"_err": "missing_dealer_result"})
            )
        ]
        if not retry_rows:
            break
        print(
            f"[audit] dealer={dealer} transient retry "
            f"{attempt}/{retry_attempts} rows={len(retry_rows)}",
            flush=True,
        )
        if retry_delay:
            time.sleep(retry_delay * attempt)
        retried = invoke(retry_rows)
        for row in retry_rows:
            results[row["sku_id"]] = retried.get(
                row["sku_id"],
                {"_err": "missing_dealer_result"},
            )
    return results


def run_official_pass(sample: list[dict], pass_number: int) -> dict[str, dict]:
    print(f"[audit] official pass {pass_number}/2", flush=True)
    results: dict[str, dict] = {}
    for dealer in DEALER_TARGETS:
        rows = [
            row
            for row in sample
            if (row.get("dealer") or "arcteryx_outlet") == dealer
        ]
        print(f"[audit] pass={pass_number} dealer={dealer} rows={len(rows)}", flush=True)
        if not rows:
            continue
        dealer_results = run_reader_with_transient_retries(dealer, rows)
        for row in rows:
            results[row["sku_id"]] = dealer_results.get(
                row["sku_id"],
                {"_err": "missing_dealer_result"},
            )
    return results


def build_audits(
    sample: list[dict],
    first_pass: dict[str, dict],
    second_pass: dict[str, dict],
) -> list[dict]:
    audits: list[dict] = []
    for row in sample:
        sku_id = row["sku_id"]
        first = normalize_read(first_pass.get(sku_id))
        second = normalize_read(second_pass.get(sku_id))
        is_evo = row.get("dealer") == "evo"
        if is_evo:
            for official in (first, second):
                if not official.get("_err") and not has_evo_variant_evidence(official):
                    official["_err"] = "evo_missing_variant_evidence"
        verdict = "unverifiable"
        error = None
        if not first.get("_err") and not second.get("_err") and same_price(first, second):
            if db_matches(row, first):
                verdict = "correct"
            else:
                verdict = "confirmed_wrong"
                error = "db_price_mismatch"
                if is_evo:
                    proof = check_evo_output_pair(first, row)
                    if not proof["pair_exists"]:
                        error = "db_pair_not_in_available_variant"
                    elif not proof["sale_is_available_minimum"]:
                        error = "db_sale_not_available_minimum"
                    elif not proof["matches_canonical_pair"]:
                        error = "db_noncanonical_variant_pair"
        else:
            error = (
                first.get("_err")
                or second.get("_err")
                or "inconsistent_official_reads"
            )
        audits.append(
            {
                "sku_id": sku_id,
                "dealer": row.get("dealer") or "arcteryx_outlet",
                "url": row.get("url"),
                "color": row.get("color"),
                "region": row.get("region"),
                "db_sale": round(float(row.get("sale_price") or 0), 2),
                "db_original": round(float(row.get("original_price") or 0), 2),
                "db_discount": row.get("discount_pct"),
                "currency": row.get("currency"),
                "official_reads": [first, second],
                **({"db_pair_evidence": [
                    check_evo_output_pair(first, row),
                    check_evo_output_pair(second, row),
                ]} if is_evo else {}),
                "verdict": verdict,
                "error": error,
            }
        )
    return audits


def summarize(audits: list[dict]) -> dict:
    summary = {
        "sampled": len(audits),
        "verified": 0,
        "correct": 0,
        "confirmed_wrong": 0,
        "unverifiable": 0,
        "by_dealer": {},
        "accuracy": None,
    }
    for dealer in DEALER_TARGETS:
        summary["by_dealer"][dealer] = {
            "sampled": 0,
            "verified": 0,
            "correct": 0,
            "confirmed_wrong": 0,
            "unverifiable": 0,
            "accuracy": None,
        }
    for audit in audits:
        dealer = audit["dealer"]
        verdict = audit["verdict"]
        dealer_summary = summary["by_dealer"].setdefault(
            dealer,
            {
                "sampled": 0,
                "verified": 0,
                "correct": 0,
                "confirmed_wrong": 0,
                "unverifiable": 0,
                "accuracy": None,
            },
        )
        dealer_summary["sampled"] += 1
        summary[verdict] += 1
        dealer_summary[verdict] += 1
        if verdict in {"correct", "confirmed_wrong"}:
            summary["verified"] += 1
            dealer_summary["verified"] += 1
    for dealer_summary in summary["by_dealer"].values():
        verified = dealer_summary["verified"]
        dealer_summary["accuracy"] = (
            round(dealer_summary["correct"] / verified, 4)
            if verified
            else None
        )
    summary["accuracy"] = (
        round(summary["correct"] / summary["verified"], 4)
        if summary["verified"]
        else None
    )
    return summary


def default_origin_sha() -> str:
    github_sha = os.environ.get("GITHUB_SHA")
    if github_sha:
        return github_sha
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def write_step_summary(summary: dict, gate_passed: bool) -> None:
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if not target:
        return
    lines = [
        "## Read-only official price audit",
        "",
        f"- Gate: **{'PASS' if gate_passed else 'FAIL'}**",
        f"- Sampled: `{summary['sampled']}`",
        f"- Verified: `{summary['verified']}`",
        f"- Correct: `{summary['correct']}`",
        f"- Confirmed wrong: `{summary['confirmed_wrong']}`",
        f"- Unverifiable: `{summary['unverifiable']}`",
        "",
        "| Dealer | Sampled | Verified | Correct | Wrong | Unverifiable |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for dealer, stats in summary["by_dealer"].items():
        lines.append(
            f"| {dealer} | {stats['sampled']} | {stats['verified']} | "
            f"{stats['correct']} | {stats['confirmed_wrong']} | "
            f"{stats['unverifiable']} |"
        )
    with Path(target).open("a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def write_setup_failure_artifact(args: argparse.Namespace, exc: Exception) -> str:
    """Persist an explicit non-pass state even when sampling cannot start."""
    message = str(exc)
    lifecycle_blocked = bool(
        args.sample_file and message.startswith("sample rows are no longer eligible:")
    )
    status = "inconclusive_lifecycle" if lifecycle_blocked else "setup_failed"
    result = {
        "schema_version": 1,
        "generated_at": now_utc_iso(),
        "start_time": args.run_start,
        "origin_sha": args.origin_sha,
        "sample_seed": None,
        "sample_counts": None,
        "source_sample_file": str(args.sample_file) if args.sample_file else None,
        "gate": {
            "passed": False,
            "status": status,
            "minimum_verified": args.minimum_verified,
            "maximum_confirmed_wrong": args.maximum_confirmed_wrong,
        },
        "setup_error": message,
        "summary": {
            "sampled": 0,
            "verified": 0,
            "correct": 0,
            "confirmed_wrong": 0,
            "unverifiable": 0,
            "accuracy": None,
            "by_dealer": {},
        },
        "audits": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"ARTIFACT {args.output.resolve()}", flush=True)
    print(f"AUDIT_GATE {status.upper()}", flush=True)
    return status


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/price-audit.json"),
        help="Non-sensitive JSON audit artifact path",
    )
    parser.add_argument(
        "--sample-file",
        type=Path,
        help="Reuse the exact 100 sku_id values from a prior audit artifact",
    )
    parser.add_argument("--run-start", default=now_utc_iso())
    parser.add_argument("--origin-sha", default=default_origin_sha())
    parser.add_argument("--minimum-verified", type=int, default=90)
    parser.add_argument("--maximum-confirmed-wrong", type=int, default=0)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        rows = eligible_rows(load_online_rows())
        if args.sample_file:
            sample, seed = sample_rows_from_artifact(rows, args.sample_file)
        else:
            sample, seed = sample_rows(rows, args.run_start, args.origin_sha)
    except (AuditSetupError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[audit] setup failed: {exc}", file=sys.stderr)
        write_setup_failure_artifact(args, exc)
        return 2

    sample_counts = dict(
        Counter((row.get("dealer") or "arcteryx_outlet") for row in sample)
    )
    print(
        f"[audit] start={args.run_start} origin={args.origin_sha} "
        f"seed={seed} sample_counts={sample_counts}",
        flush=True,
    )

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first_pass = pool.submit(run_official_pass, sample, 1).result()
            time.sleep(env_float("AUDIT_INDEPENDENT_READ_DELAY_SECONDS", 2.0, 0.0))
            second_pass = pool.submit(run_official_pass, sample, 2).result()
    except Exception as exc:
        print(
            f"[audit] runtime failed: {format_error('runtime', exc)['_err']}",
            file=sys.stderr,
        )
        return 2

    audits = build_audits(sample, first_pass, second_pass)
    summary = summarize(audits)
    gate_passed = (
        summary["sampled"] == 100
        and summary["verified"] >= args.minimum_verified
        and summary["confirmed_wrong"] <= args.maximum_confirmed_wrong
    )
    result = {
        "schema_version": 1,
        "generated_at": now_utc_iso(),
        "start_time": args.run_start,
        "origin_sha": args.origin_sha,
        "sample_seed": seed,
        "sample_counts": sample_counts,
        "source_sample_file": str(args.sample_file) if args.sample_file else None,
        "gate": {
            "passed": gate_passed,
            "status": "passed" if gate_passed else "failed",
            "minimum_verified": args.minimum_verified,
            "maximum_confirmed_wrong": args.maximum_confirmed_wrong,
        },
        "summary": summary,
        "audits": audits,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_step_summary(summary, gate_passed)
    print(f"ARTIFACT {args.output.resolve()}", flush=True)
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    print(f"AUDIT_GATE {'PASS' if gate_passed else 'FAIL'}", flush=True)
    return 0 if gate_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
