#!/usr/bin/env bash
# A development certificate, so scanning works from a phone.
#
# `getUserMedia` requires a secure context. The browser exempts `localhost`,
# never a network address: without HTTPS, opening the scanner from a phone
# yields a camera refusal that nothing explains.
#
# The certificate carries the machine's local **and** network addresses, so it
# holds on both sides. It is self-signed: the browser will show a warning to
# accept once.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

DEST=".certs"
mkdir -p "$DEST"

if [ -f "$DEST/dev-cert.pem" ] && [ -f "$DEST/dev-key.pem" ]; then
  echo "certificate already present — delete apps/web/.certs to make a new one"
  exit 0
fi

LAN=$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' || echo "127.0.0.1")
echo "── certificate for localhost and $LAN"

openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout "$DEST/dev-key.pem" -out "$DEST/dev-cert.pem" \
  -subj "/CN=ATEM development" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$LAN" 2>/dev/null

echo "── ready. Restart the server: the interface switches to https://"
echo "   From the phone: https://$LAN:5174 — accept the warning."
