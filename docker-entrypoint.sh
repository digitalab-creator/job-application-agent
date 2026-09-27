#!/bin/sh
set -e
Xvfb :99 -screen 0 1366x900x24 &
export DISPLAY=:99
cd /app
exec node dist/server.js
