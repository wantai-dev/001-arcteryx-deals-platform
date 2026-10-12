#!/usr/bin/env python3
"""Wait until the server publishes a post-sync, internally consistent data release."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import time
import urllib.parse
import urllib.request
from typing import Any


SITE_URL = "https://geardrop.100app.dev"
MAX_BYTES = 2 * 1024 * 1024


def parse_timestamp(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset")
    return parsed.astimezone(dt.timezone.utc)


def release_match(
    status: dict[str, Any], manifest: dict[str, Any], after: dt.datetime
) -> tuple[bool, str]:
    try:
        checked_at = parse_timestamp(str(status["checked_at"]))
    except (KeyError, TypeError, ValueError) as error:
        return False, f"invalid data status timestamp: {error}"
    if checked_at < after:
        return False, f"data status checked_at={checked_at.isoformat()} is before required time"
    try:
        release_generated_at = parse_timestamp(str(status["release_generated_at"]))
        manifest_generated_at = parse_timestamp(str(manifest["generated_at"]))
    except (KeyError, TypeError, ValueError) as error:
        return False, f"invalid release generation timestamp: {error}"
    if release_generated_at != manifest_generated_at:
        return False, "status and public manifest release generation times differ"
    if release_generated_at < after:
        return False, (
            f"release generated_at={release_generated_at.isoformat()} is before required time"
        )

    revision = str(status.get("data_revision") or "")
    artifact_revision = str(status.get("artifact_revision") or "")
    code_revision = str(status.get("code_revision") or "")
    if (
        not re.fullmatch(r"[a-f0-9]{20}", revision)
        or not re.fullmatch(r"[a-f0-9]{20}", artifact_revision)
        or not re.fullmatch(r"[a-f0-9]{40}", code_revision)
    ):
        return False, "data status has invalid revision identities"
    if manifest.get("data_revision") != revision:
        return False, "status and public manifest data revisions differ"
    if manifest.get("code_revision") != code_revision:
        return False, "status and public manifest code revisions differ"
    if manifest.get("artifact_revision") != artifact_revision:
        return False, "status and public manifest artifact revisions differ"
    if manifest.get("active_products") != status.get("active_products"):
        return False, "status and public manifest product counts differ"
    if manifest.get("snapshot_observed_at") != status.get("snapshot_observed_at"):
        return False, "status and public manifest snapshot times differ"
    return True, (
        f"data_revision={revision} artifact_revision={artifact_revision} code_revision={code_revision} "
        f"active_products={status.get('active_products')} "
        f"generated_at={release_generated_at.isoformat()} checked_at={checked_at.isoformat()}"
    )


def read_json(url: str, cache_buster: str) -> dict[str, Any]:
    separator = "&" if "?" in url else "?"
    request = urllib.request.Request(
        f"{url}{separator}receipt={urllib.parse.quote_plus(cache_buster)}",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Cache-Control": "no-cache",
            "User-Agent": "GearDrop-Data-Release-Gate/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read(MAX_BYTES + 1)
    if not payload or len(payload) > MAX_BYTES:
        raise ValueError(f"response size is outside the accepted range: {len(payload)}")
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("response must be a JSON object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-url", default=SITE_URL)
    parser.add_argument("--after", required=True, help="UTC timestamp captured after Supabase sync")
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--interval-seconds", type=int, default=10)
    args = parser.parse_args()
    if args.timeout_seconds < 1 or args.interval_seconds < 1:
        parser.error("timeouts must be positive")
    origin = args.site_url.rstrip("/")
    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path:
        parser.error("site-url must be an HTTPS origin")
    after = parse_timestamp(args.after)
    deadline = time.monotonic() + args.timeout_seconds
    attempt = 0
    reason = "not checked"
    while True:
        attempt += 1
        cache_buster = f"{args.after}-{attempt}"
        try:
            status = read_json(f"{origin}/data-status.json", cache_buster)
            manifest = read_json(f"{origin}/data-manifest.json", cache_buster)
            matched, reason = release_match(status, manifest, after)
            if matched:
                print(json.dumps({"status": "published", "attempt": attempt, "receipt": reason}))
                return 0
        except (OSError, ValueError, json.JSONDecodeError) as error:
            reason = f"{type(error).__name__}: {error}"
        if time.monotonic() >= deadline:
            print(json.dumps({"status": "timeout", "attempt": attempt, "reason": reason}))
            return 1
        print(f"waiting for data release: {reason}")
        time.sleep(args.interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
