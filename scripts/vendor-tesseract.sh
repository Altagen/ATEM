#!/usr/bin/env bash
#
# Serve Tesseract ourselves, rather than loading it from a CDN.
#
# OCR scanning loaded its engine from `cdn.jsdelivr.net`: third-party code
# running in our origin, every time the screen opened. The session cookie is
# `httpOnly`, so that code cannot read it — but it can call the API on behalf of
# the signed-in person. And pinning by version protects nothing: the CDN decides
# what it serves under that name.
#
# The four files are therefore downloaded once, **checked by fingerprint**, and
# served from our own domain. The fingerprint is what changes everything: a
# pinned version trusts a name, a fingerprint trusts only the content.
#
# They are not in the repository — seven megabytes of binaries do not belong
# there. `pnpm build` calls this script, which only downloads what is missing.
set -uo pipefail
cd "$(dirname "$0")/.."

DEST="apps/web/public/tesseract"
FINGERPRINTS="scripts/tesseract.sha256"

# Pinned version **and** checked content. Changing one without the other fails.
JS="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
WORKER="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js"
CORE="https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js"
LANG="https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"

mkdir -p "$DEST/lang"

download() {
  local url="$1" target="$2"
  if [ -s "$target" ]; then return 0; fi
  echo "   ↓ $(basename "$target")"
  if ! curl -fsSL --max-time 180 -o "$target.part" "$url"; then
    echo "   ✗ download failed: $url" >&2
    rm -f "$target.part"
    return 1
  fi
  mv "$target.part" "$target"
}

echo "── OCR engine, served from our own domain"
missing=0
download "$JS"     "$DEST/tesseract.min.js"        || missing=1
download "$WORKER" "$DEST/worker.min.js"           || missing=1
download "$CORE"   "$DEST/tesseract-core-lstm.wasm.js" || missing=1
download "$LANG"   "$DEST/lang/eng.traineddata.gz" || missing=1

if [ "$missing" -ne 0 ]; then
  cat >&2 <<'END'

   Files are missing and could not be downloaded. The rest of the application
   works; only OCR scanning will stay silent, and will say so.
END
  exit 1
fi

echo "── Fingerprints"
if [ ! -f "$FINGERPRINTS" ]; then
  ( cd "$DEST" && find . -type f -name '*' ! -name '*.part' -print0 \
      | sort -z | xargs -0 sha256sum ) > "$FINGERPRINTS"
  echo "   · fingerprints recorded for the first time — review them before committing"
  cat "$FINGERPRINTS" | sed 's/^/       /'
  exit 0
fi

if ( cd "$DEST" && sha256sum --quiet -c "../../../../$FINGERPRINTS" ) 2>/dev/null; then
  echo "   ✓ all four files match the recorded fingerprints"
else
  cat >&2 <<'END'
   ✗ A file does not match its fingerprint.

   Either the content served under that name has changed — which is precisely
   what the fingerprint exists to detect — or a download ended badly. Delete
   apps/web/public/tesseract and run again; if the mismatch persists, do not
   work around it.
END
  exit 1
fi
