#!/usr/bin/env bash
set -eo pipefail

PROFILE="$DSH_PROFILE"
if [ -z "$PROFILE" ]; then PROFILE=desktop; fi
SOURCE="$*"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$#" -gt 0 ] && [ "$1" = "--local" ]; then
  SOURCE="link:$ROOT"
fi

if [ -z "$SOURCE" ]; then
  cat <<'USAGE'
Usage:
  ./scripts/install-plugin.sh --local
  ./scripts/install-plugin.sh github:YOUR_NAME/dsh-mobile
USAGE
  exit 1
fi

if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "$PROFILE" add "$SOURCE"
else
  APP="/Applications/DeepSeek Harness.app"
  EXE="$APP/Contents/MacOS/DeepSeek Harness"
  CLI="$APP/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
  if [ ! -x "$EXE" ] || [ ! -f "$CLI" ]; then
    echo "dsh was not found. Install the DSH CLI, or run this on a Mac with DeepSeek Harness installed." >&2
    exit 1
  fi
  ELECTRON_RUN_AS_NODE=1 "$EXE" --expose-internals "$CLI" plugin --profile "$PROFILE" add "$SOURCE"
fi

cat <<'NEXT'

Installed. Next:
  1. Quit and reopen DeepSeek Harness.
  2. Open DSH Settings -> Plugins and enable dsh-mobile if needed.
  3. The pairing page opens automatically; it is also printed in the DSH log.
NEXT
