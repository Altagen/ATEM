#!/usr/bin/env bash
# Un certificat de développement, pour que le scan marche depuis un téléphone.
#
# `getUserMedia` exige un contexte sécurisé. Le navigateur excepte `localhost`,
# jamais une adresse réseau : sans HTTPS, ouvrir le scanner depuis un téléphone
# donne un refus de caméra que rien n'explique.
#
# Le certificat porte l'adresse locale **et** l'adresse réseau de la machine,
# pour qu'il vaille des deux côtés. Il est auto-signé : le navigateur affichera
# un avertissement à accepter une fois.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

DEST=".certs"
mkdir -p "$DEST"

if [ -f "$DEST/dev-cert.pem" ] && [ -f "$DEST/dev-key.pem" ]; then
  echo "certificat déjà présent — supprimez apps/web/.certs pour le refaire"
  exit 0
fi

LAN=$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' || echo "127.0.0.1")
echo "── certificat pour localhost et $LAN"

openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$DEST/dev-key.pem" -out "$DEST/dev-cert.pem" \
  -subj "/CN=ATEM développement" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$LAN" 2>/dev/null

echo "── prêt. Relancez le serveur : l'interface passe en https://"
echo "   Depuis le téléphone : https://$LAN:5174 — acceptez l'avertissement."
