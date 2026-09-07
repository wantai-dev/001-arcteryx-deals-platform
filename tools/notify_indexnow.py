#!/usr/bin/env python3
"""Notify IndexNow of recently changed GearDrop URLs without logging credentials."""

from __future__ import annotations

import argparse
import datetime as dt
import hmac
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
SITE_URL = "https://geardrop.100app.dev"
SITE_HOST = "geardrop.100app.dev"
DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_BATCH = 10_000
MAX_SITEMAP_BYTES = 16 * 1024 * 1024
DEFAULT_SITEMAPS = (
    ROOT / "sitemap-products.xml",
    ROOT / "sitemap-deals.xml",
    ROOT / "sitemap-insights.xml",
)
DEFAULT_KEY_FILE = ROOT / "indexnow-key.txt"
DEFAULT_KEY_LOCATION = f"{SITE_URL}/indexnow-key.txt"


def parse_lastmod(value: str | None) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def read_sitemap(source: Path | str) -> list[tuple[str, dt.date | None]]:
    if isinstance(source, Path):
        root = ET.parse(source).getroot()
    else:
        parsed_source = urllib.parse.urlparse(source)
        if parsed_source.scheme != "https" or parsed_source.netloc != SITE_HOST:
            raise ValueError(f"Remote sitemap must be hosted on {SITE_HOST}: {source!r}")
        request = urllib.request.Request(
            source,
            headers={
                "Accept": "application/xml,text/xml",
                "Accept-Encoding": "identity",
                "User-Agent": "GearDrop-IndexNow/1.0",
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read(MAX_SITEMAP_BYTES + 1)
        if not payload or len(payload) > MAX_SITEMAP_BYTES:
            raise ValueError(f"Remote sitemap size is outside the accepted range: {len(payload)}")
        root = ET.fromstring(payload)
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    rows: list[tuple[str, dt.date | None]] = []
    for node in root.findall("sm:url", namespace):
        location = node.findtext("sm:loc", namespaces=namespace) or ""
        modified = node.findtext("sm:lastmod", namespaces=namespace)
        parsed = urllib.parse.urlparse(location)
        if parsed.scheme != "https" or parsed.netloc != SITE_HOST:
            raise ValueError(f"Sitemap URL is outside {SITE_HOST}: {location!r}")
        rows.append((location, parse_lastmod(modified)))
    return rows


def collect_recent_urls(
    sitemap_paths: Iterable[Path | str], since_days: int, today: dt.date | None = None
) -> list[str]:
    if since_days < 0:
        raise ValueError("since-days must be zero or greater")
    observed_today = today or dt.datetime.now(dt.timezone.utc).date()
    cutoff = observed_today - dt.timedelta(days=since_days)
    urls = {f"{SITE_URL}/"}
    for path in sitemap_paths:
        for location, modified in read_sitemap(path):
            if modified is None or modified >= cutoff:
                urls.add(location)
    return sorted(urls)


def validate_credentials(key: str, key_location: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9-]{8,128}", key):
        raise ValueError("INDEXNOW_KEY must contain 8-128 URL-safe alphanumeric or hyphen characters")
    parsed = urllib.parse.urlparse(key_location)
    if parsed.scheme != "https" or parsed.netloc != SITE_HOST:
        raise ValueError(f"INDEXNOW_KEY_LOCATION must be an HTTPS URL on {SITE_HOST}")


def validate_key_file(
    key: str,
    key_location: str,
    key_file: Path = DEFAULT_KEY_FILE,
) -> None:
    validate_credentials(key, key_location)
    if key_location != DEFAULT_KEY_LOCATION:
        raise ValueError(f"INDEXNOW_KEY_LOCATION must equal {DEFAULT_KEY_LOCATION}")
    hosted_key = key_file.read_text(encoding="utf-8").strip()
    if not hmac.compare_digest(hosted_key, key):
        raise ValueError("INDEXNOW_KEY does not match the configured verification file")


def read_credentials_from_stdin(stream: io.TextIOBase) -> tuple[str, str]:
    """Read credentials without placing them in the process command."""
    key = stream.readline().strip()
    key_location = stream.readline().strip()
    if not key or not key_location:
        raise ValueError("stdin must contain the key and key location on separate lines")
    return key, key_location


def submit_batch(
    urls: list[str], key: str, key_location: str, endpoint: str = DEFAULT_ENDPOINT
) -> int:
    payload = json.dumps(
        {
            "host": SITE_HOST,
            "key": key,
            "keyLocation": key_location,
            "urlList": urls,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return int(getattr(response, "status", 200))


def safe_submission_error(error: Exception, url_count: int) -> dict[str, object]:
    """Return actionable diagnostics without response bodies or credentials."""
    payload: dict[str, object] = {
        "status": "submission_failed",
        "url_count": url_count,
        "error_type": type(error).__name__,
    }
    if isinstance(error, urllib.error.HTTPError):
        payload["http_status"] = int(error.code)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sitemap", action="append", type=Path, help="Local URL sitemap; repeatable")
    parser.add_argument(
        "--sitemap-url",
        action="append",
        help=f"HTTPS URL sitemap hosted on {SITE_HOST}; repeatable",
    )
    parser.add_argument("--since-days", type=int, default=2, help="Include URLs modified within this many UTC days")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="IndexNow API endpoint")
    parser.add_argument("--dry-run", action="store_true", help="Parse and count URLs without credentials or network")
    parser.add_argument("--check", action="store_true", help="Validate the credential-free tool contract")
    parser.add_argument(
        "--credentials-stdin",
        action="store_true",
        help="Read INDEXNOW_KEY and INDEXNOW_KEY_LOCATION from separate stdin lines",
    )
    args = parser.parse_args()

    if args.check:
        try:
            configured_key = DEFAULT_KEY_FILE.read_text(encoding="utf-8").strip()
            validate_key_file(configured_key, DEFAULT_KEY_LOCATION)
            key_file_valid = True
        except (OSError, ValueError):
            key_file_valid = False
        print(
            json.dumps(
                {
                    "valid": key_file_valid,
                    "site_host": SITE_HOST,
                    "endpoint": args.endpoint,
                    "max_batch_urls": MAX_BATCH,
                    "key_location": DEFAULT_KEY_LOCATION,
                    "key_file_present": DEFAULT_KEY_FILE.is_file(),
                    "key_file_valid": key_file_valid,
                    "credentials_required": ["INDEXNOW_KEY", "INDEXNOW_KEY_LOCATION"],
                    "credentials_logged": False,
                },
                indent=2,
            )
        )
        return 0 if key_file_valid else 1

    sitemap_paths = tuple(args.sitemap or ()) + tuple(args.sitemap_url or ())
    if not sitemap_paths:
        sitemap_paths = DEFAULT_SITEMAPS
    try:
        urls = collect_recent_urls(sitemap_paths, args.since_days)
    except (OSError, ET.ParseError, ValueError) as error:
        print(json.dumps({"status": "invalid_input", "error": str(error)}), file=sys.stderr)
        return 1

    if args.dry_run:
        print(json.dumps({"status": "dry_run", "url_count": len(urls), "batch_count": (len(urls) + MAX_BATCH - 1) // MAX_BATCH}))
        return 0

    try:
        if args.credentials_stdin:
            key, key_location = read_credentials_from_stdin(sys.stdin)
        else:
            key = os.environ.get("INDEXNOW_KEY", "")
            key_location = os.environ.get("INDEXNOW_KEY_LOCATION", "")
    except ValueError as error:
        print(
            json.dumps(
                {
                    "status": "invalid_credentials_input",
                    "error_type": type(error).__name__,
                }
            ),
            file=sys.stderr,
        )
        return 1
    if not key or not key_location:
        print(
            json.dumps(
                {
                    "status": "skipped_missing_credentials",
                    "url_count": len(urls),
                    "required": ["INDEXNOW_KEY", "INDEXNOW_KEY_LOCATION"],
                }
            )
        )
        return 0

    try:
        validate_key_file(key, key_location)
        statuses = [
            submit_batch(urls[start : start + MAX_BATCH], key, key_location, args.endpoint)
            for start in range(0, len(urls), MAX_BATCH)
        ]
    except (ValueError, urllib.error.URLError, TimeoutError, OSError) as error:
        print(json.dumps(safe_submission_error(error, len(urls))), file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "status": "submitted",
                "url_count": len(urls),
                "batch_count": len(statuses),
                "http_statuses": statuses,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
