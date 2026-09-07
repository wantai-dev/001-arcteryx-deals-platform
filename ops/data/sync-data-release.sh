#!/usr/bin/env bash
set -euo pipefail

ROOT=${GEARDROP_ROOT:-/srv/geardrop}
SOURCE=${GEARDROP_SOURCE:-$ROOT/source}
DATA_ROOT=${GEARDROP_DATA_ROOT:-$ROOT/data}
LOCK_FILE=${GEARDROP_DATA_LOCK:-$ROOT/data-sync.lock}
DEPLOY_LOCK=${GEARDROP_DEPLOY_LOCK:-$ROOT/deploy.lock}
KEEP_RELEASES=${GEARDROP_DATA_KEEP_RELEASES:-12}

if [ ! -d "$SOURCE/.git" ]; then
  echo "Dedicated source clone is missing: $SOURCE" >&2
  exit 1
fi

mkdir -p "$DATA_ROOT/releases"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another GearDrop data sync is already running"
  exit 0
fi
exec 8>"$DEPLOY_LOCK"
flock 8

CODE_REVISION=$(tr -d '[:space:]' < "$ROOT/current/REVISION")
STAGING=$(mktemp -d "$DATA_ROOT/.stage.XXXXXX")
STATUS_STAGING=""
cleanup() {
  if [ -n "${STAGING:-}" ] && [ -d "$STAGING" ]; then
    rm -rf -- "$STAGING"
  fi
  if [ -n "${STATUS_STAGING:-}" ] && [ -f "$STATUS_STAGING" ]; then
    rm -f -- "$STATUS_STAGING"
  fi
}
trap cleanup EXIT INT TERM

GEARDROP_CODE_REVISION="$CODE_REVISION" \
  /usr/bin/node "$SOURCE/ops/data/build-data-release.mjs" --output "$STAGING"
DATA_REVISION=$(tr -d '[:space:]' < "$STAGING/DATA_REVISION")
if [[ ! "$DATA_REVISION" =~ ^[a-f0-9]{20}$ ]]; then
  echo "Invalid data revision: $DATA_REVISION" >&2
  exit 1
fi
ARTIFACT_REVISION=$(tr -d '[:space:]' < "$STAGING/ARTIFACT_REVISION")
if [[ ! "$ARTIFACT_REVISION" =~ ^[a-f0-9]{20}$ ]]; then
  echo "Invalid artifact revision: $ARTIFACT_REVISION" >&2
  exit 1
fi

RELEASE="$DATA_ROOT/releases/$ARTIFACT_REVISION"
if [ -d "$RELEASE" ]; then
  EXISTING_REVISION=$(tr -d '[:space:]' < "$RELEASE/DATA_REVISION")
  EXISTING_ARTIFACT=$(tr -d '[:space:]' < "$RELEASE/ARTIFACT_REVISION")
  if [ "$EXISTING_REVISION" != "$DATA_REVISION" ] \
    || [ "$EXISTING_ARTIFACT" != "$ARTIFACT_REVISION" ] \
    || [ ! -s "$RELEASE/MANIFEST.json" ]; then
    echo "Existing data release failed identity validation: $RELEASE" >&2
    exit 1
  fi
  echo "data_unchanged=$DATA_REVISION artifact_unchanged=$ARTIFACT_REVISION"
else
  mv "$STAGING" "$RELEASE"
  STAGING=""
fi

# mktemp creates the staging root as 0700. The release contains only public
# snapshots and receipts, so make directories traversable and files readable
# before Nginx can switch to it.
chmod -R u=rwX,go=rX "$RELEASE"

for required in \
  public/data.js \
  public/data.js.gz \
  public/dealers/results.json \
  public/dealers/results.json.gz \
  public/sitemap-products.xml \
  public/sitemap-deals.xml \
  public/brands/arcteryx.html \
  public/categories/pants.html \
  public/publication.json \
  public/data-manifest.json \
  ARTIFACT_REVISION \
  MANIFEST.json; do
  if [ ! -s "$RELEASE/$required" ]; then
    echo "Data release is missing: $required" >&2
    exit 1
  fi
done
if ! gzip -cd "$RELEASE/public/data.js.gz" | cmp -s - "$RELEASE/public/data.js"; then
  echo "Compressed data.js does not match its source" >&2
  exit 1
fi

NEXT_LINK="$DATA_ROOT/current.next.$$"
ln -s "releases/$ARTIFACT_REVISION" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$DATA_ROOT/current"

/usr/bin/node "$SOURCE/ops/data/prune-data-releases.mjs" "$DATA_ROOT" "$KEEP_RELEASES"

STATUS_STAGING=$(mktemp "$DATA_ROOT/.status.XXXXXX")
rm -f "$STATUS_STAGING"
/usr/bin/node "$SOURCE/ops/data/write-data-status.mjs" \
  "$RELEASE/MANIFEST.json" "$STATUS_STAGING"
mv -f "$STATUS_STAGING" "$DATA_ROOT/status.json"
STATUS_STAGING=""

READBACK_REVISION=$(tr -d '[:space:]' < "$DATA_ROOT/current/DATA_REVISION")
if [ "$READBACK_REVISION" != "$DATA_REVISION" ]; then
  echo "Data release readback mismatch: $READBACK_REVISION != $DATA_REVISION" >&2
  exit 1
fi
STATUS_REVISION=$(/usr/bin/node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(value.data_revision || ""));
' "$DATA_ROOT/status.json")
if [ "$STATUS_REVISION" != "$DATA_REVISION" ]; then
  echo "Data status readback mismatch: $STATUS_REVISION != $DATA_REVISION" >&2
  exit 1
fi

echo "data_current=$DATA_REVISION artifact_current=$ARTIFACT_REVISION code_revision=$CODE_REVISION"
