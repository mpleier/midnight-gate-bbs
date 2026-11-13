#!/usr/bin/env sh
# The Midnight Gate — start the board from a shell (macOS, Linux, git-bash).
# Windows users can just double-click START.bat instead.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 18 or newer from https://nodejs.org/" >&2
  exit 1
fi

echo
echo "  ============================================"
echo "           T H E   M I D N I G H T   G A T E"
echo "  ============================================"
echo
echo "  Starting the board. Your browser will open when the line is up."
echo "  Press Ctrl-C to hang up."
echo

node tools/open-board.js &
exec node server.js
