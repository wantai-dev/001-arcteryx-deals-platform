#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 OUTPUT_DIR [GIT_REVISION]" >&2
  exit 2
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
MANIFEST="$SCRIPT_DIR/public-files.txt"
OUTPUT=$1
REVISION=${2:-HEAD}
COMMIT=$(git -C "$REPO_ROOT" rev-parse --verify "${REVISION}^{commit}")

mkdir -p "$(dirname "$OUTPUT")"
OUTPUT_PARENT=$(cd "$(dirname "$OUTPUT")" && pwd -P)
OUTPUT="$OUTPUT_PARENT/$(basename "$OUTPUT")"
STAGING="${OUTPUT}.tmp.$$"

if [ -e "$OUTPUT" ] || [ -L "$OUTPUT" ]; then
  echo "Refusing to overwrite existing release: $OUTPUT" >&2
  exit 1
fi

cleanup() {
  rm -rf "$STAGING"
}
trap cleanup EXIT INT TERM

mkdir -p "$STAGING/static"

PUBLIC_PATHS=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ""|\#*) continue ;;
  esac
  if ! git -C "$REPO_ROOT" cat-file -e "$COMMIT:$line" 2>/dev/null; then
    echo "Public manifest path is missing at $COMMIT: $line" >&2
    exit 1
  fi
  PUBLIC_PATHS+=("$line")
done < "$MANIFEST"

git -C "$REPO_ROOT" archive "$COMMIT" -- "${PUBLIC_PATHS[@]}" \
  | tar -xf - -C "$STAGING/static"
git -C "$REPO_ROOT" archive "$COMMIT" -- api/catalog.mjs api/product.mjs api/seo-index.mjs seo-index-policy.json ops/web/product-server.mjs \
  | tar -xf - -C "$STAGING"

# api/product.mjs intentionally reads this public template to recover the
# public Supabase URL and anon key when no environment override is present.
cp "$STAGING/static/product-detail.html" "$STAGING/product-detail.html"
printf '%s\n' "$COMMIT" > "$STAGING/REVISION"

for required in \
  static/index.html \
  static/product-detail.html \
  static/sitemap.xml \
  api/catalog.mjs \
  api/product.mjs \
  api/seo-index.mjs \
  seo-index-policy.json \
  ops/web/product-server.mjs; do
  if [ ! -s "$STAGING/$required" ]; then
    echo "Release is missing required file: $required" >&2
    exit 1
  fi
done

FORBIDDEN=$(find "$STAGING/static" -type f \( \
  -name '.env*' -o -name '.git*' -o -name '*.py' -o -name '*.sql' \
  -o -name '*.md' -o -name '*.pem' -o -name '*.key' -o -name '*.toml' \
  -o -name 'package-lock.json' -o -name 'package.json' \
\) -print -quit)
if [ -n "$FORBIDDEN" ]; then
  echo "Forbidden file entered public release: $FORBIDDEN" >&2
  exit 1
fi

if ! command -v gzip >/dev/null 2>&1; then
  echo "gzip is required to build precompressed static assets" >&2
  exit 1
fi

# Generate timestamp-free gzip sidecars for text assets. `-n` strips the source
# name and timestamp so repeated builds with the same gzip toolchain are byte
# reproducible. Keep the 1 KiB threshold aligned with Nginx's serving policy;
# smaller files do not recover the extra filesystem entry and negotiation cost.
COMPRESSED_FILES=0
while IFS= read -r -d '' asset; do
  gzip -n -9 -c "$asset" > "$asset.gz"
  COMPRESSED_FILES=$((COMPRESSED_FILES + 1))
done < <(find "$STAGING/static" -type f \( \
  -name '*.css' -o -name '*.html' -o -name '*.js' -o -name '*.json' \
  -o -name '*.svg' -o -name '*.txt' -o -name '*.webmanifest' \
  -o -name '*.xml' \
\) -size +1023c -print0)

for required_compressed in \
  static/index.html.gz \
  static/product-detail.html.gz; do
  if [ ! -s "$STAGING/$required_compressed" ]; then
    echo "Release is missing required compressed file: $required_compressed" >&2
    exit 1
  fi
  if ! gzip -cd "$STAGING/$required_compressed" \
    | cmp -s - "$STAGING/${required_compressed%.gz}"; then
    echo "Compressed release file does not match its source: $required_compressed" >&2
    exit 1
  fi
done

STATIC_FILES=$(find "$STAGING/static" -type f ! -name '*.gz' | wc -l | tr -d ' ')
mv "$STAGING" "$OUTPUT"
trap - EXIT INT TERM
printf 'release_commit=%s static_files=%s compressed_files=%s output=%s\n' \
  "$COMMIT" "$STATIC_FILES" "$COMPRESSED_FILES" "$OUTPUT"
