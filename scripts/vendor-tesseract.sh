#!/usr/bin/env bash
#
# Servir Tesseract nous-mêmes, plutôt que de le charger depuis un CDN.
#
# Le scan OCR chargeait son moteur depuis `cdn.jsdelivr.net` : du code tiers
# exécuté dans notre origine, à chaque ouverture de l'écran. Le cookie de
# session est `httpOnly`, donc ce code ne peut pas le lire — mais il peut
# appeler l'API au nom de la personne connectée. Et l'épinglage par version ne
# protège de rien : c'est le CDN qui décide de ce qu'il sert sous ce nom.
#
# Les quatre fichiers sont donc téléchargés une fois, **vérifiés par empreinte**,
# et servis depuis notre domaine. L'empreinte est ce qui change tout : une
# version épinglée fait confiance à un nom, une empreinte ne fait confiance
# qu'au contenu.
#
# Ils ne sont pas dans le dépôt — sept mégaoctets de binaires n'y ont pas leur
# place. `pnpm build` appelle ce script, qui ne retélécharge que ce qui manque.
set -uo pipefail
cd "$(dirname "$0")/.."

DEST="apps/web/public/tesseract"
EMPREINTES="scripts/tesseract.sha256"

# Version épinglée **et** contenu vérifié. Changer l'une sans l'autre échoue.
JS="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
WORKER="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js"
CORE="https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js"
LANG="https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"

mkdir -p "$DEST/lang"

telecharger() {
  local url="$1" cible="$2"
  if [ -s "$cible" ]; then return 0; fi
  echo "   ↓ $(basename "$cible")"
  if ! curl -fsSL --max-time 180 -o "$cible.part" "$url"; then
    echo "   ✗ téléchargement impossible : $url" >&2
    rm -f "$cible.part"
    return 1
  fi
  mv "$cible.part" "$cible"
}

echo "── Moteur OCR, servi depuis notre domaine"
manque=0
telecharger "$JS"     "$DEST/tesseract.min.js"        || manque=1
telecharger "$WORKER" "$DEST/worker.min.js"           || manque=1
telecharger "$CORE"   "$DEST/tesseract-core-lstm.wasm.js" || manque=1
telecharger "$LANG"   "$DEST/lang/eng.traineddata.gz" || manque=1

if [ "$manque" -ne 0 ]; then
  cat >&2 <<'FIN'

   Les fichiers manquent et n'ont pas pu être téléchargés. Le reste de
   l'application fonctionne ; seul le scan OCR restera muet, et le dira.
FIN
  exit 1
fi

echo "── Empreintes"
if [ ! -f "$EMPREINTES" ]; then
  ( cd "$DEST" && find . -type f -name '*' ! -name '*.part' -print0 \
      | sort -z | xargs -0 sha256sum ) > "$EMPREINTES"
  echo "   · empreintes enregistrées pour la première fois — à relire avant de committer"
  cat "$EMPREINTES" | sed 's/^/       /'
  exit 0
fi

if ( cd "$DEST" && sha256sum --quiet -c "../../../../$EMPREINTES" ) 2>/dev/null; then
  echo "   ✓ les quatre fichiers correspondent aux empreintes enregistrées"
else
  cat >&2 <<'FIN'
   ✗ Un fichier ne correspond pas à son empreinte.

   Soit le contenu servi sous ce nom a changé — ce qui est précisément ce que
   l'empreinte sert à détecter — soit un téléchargement s'est mal terminé.
   Effacer apps/web/public/tesseract et relancer ; si l'écart persiste, ne pas
   le contourner.
FIN
  exit 1
fi
