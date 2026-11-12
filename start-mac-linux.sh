#!/bin/sh
# Mac / Linux: run  sh start-mac-linux.sh   (add "online" to also start the tunnel)
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js LTS from https://nodejs.org first."; exit 1; }
if [ "$1" = "online" ]; then
  command -v cloudflared >/dev/null || { echo "Install cloudflared first (Mac: brew install cloudflared)."; exit 1; }
  node server.js & SERVER=$!
  sleep 2; cloudflared tunnel --url http://localhost:3000
  kill $SERVER
else
  node server.js
fi
