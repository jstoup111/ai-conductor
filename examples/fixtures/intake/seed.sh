#!/usr/bin/env bash
# examples/fixtures/intake/seed.sh — seed envelope.json into the sandbox
# engineer store's durable inbox (plan Task 12).
#
# Mirrors createFileQueue's pending-file naming
# (src/conductor/src/engine/engineer/intake/queue.ts):
#   <sanitised-receivedAt>__<sanitised-id>.json
# where sanitize() replaces any char outside [a-zA-Z0-9-.] with "_".
#
# Requires AI_CONDUCTOR_ENGINEER_DIR to already be exported (sandbox_up).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENVELOPE_JSON="$SCRIPT_DIR/envelope.json"

if [ -z "${AI_CONDUCTOR_ENGINEER_DIR:-}" ]; then
  echo "seed.sh: AI_CONDUCTOR_ENGINEER_DIR is not set (run sandbox_up first)" >&2
  exit 1
fi

sanitize() {
  printf '%s' "$1" | tr -c 'a-zA-Z0-9-.' '_'
}

RECEIVED_AT="$(sed -n 's/.*"receivedAt": *"\([^"]*\)".*/\1/p' "$ENVELOPE_JSON")"
ID="$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$ENVELOPE_JSON")"

INBOX_DIR="$AI_CONDUCTOR_ENGINEER_DIR/inbox"
mkdir -p "$INBOX_DIR"

DEST="$INBOX_DIR/$(sanitize "$RECEIVED_AT")__$(sanitize "$ID").json"
cp "$ENVELOPE_JSON" "$DEST"

echo "seeded pending envelope: $DEST"
