#!/bin/sh
set -e
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1366x900x24 >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99
i=0
while [ "$i" -lt 25 ]; do
  if [ -S /tmp/.X11-unix/X99 ]; then
    break
  fi
  i=$((i + 1))
  sleep 0.2
done
cd /app
exec node dist/server.js
