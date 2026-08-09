#!/usr/bin/env bash
# harness-common.sh — Shared helpers used by bin/conduct and bin/update.
#
# Copied here (not moved) from bin/conduct so bin/update can source them
# without depending on bin/conduct's internals. bin/conduct still defines
# its own copies until #226 removes its update block — until then, any fix
# made here should be mirrored there (and vice versa) to avoid drift.
#
# Requires: python3, and optionally PyYAML for harness_cfg_get/harness_cfg_set.

# ─── Colors ───────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Logging ──────────────────────────────────────────────────────────────

log()  { echo -e "${BLUE}[conduct]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }

# ─── Legacy JSON config (~/.claude/ai-conductor.config.json) ───────────────

CONDUCTOR_CONFIG="${HOME}/.claude/ai-conductor.config.json"
HARNESS_USER_CONFIG="${HOME}/.ai-conductor/config.yml"

# Map the legacy update-flow field names to the schema-owned conductor block.
# Usage: conductor_cfg_key <legacyField>
conductor_cfg_key() {
  case "$1" in
    updateChannel) echo "update_channel" ;;
    autoCheck) echo "auto_check" ;;
    currentVersion) echo "current_version" ;;
    lastCheckedAt) echo "last_checked_at" ;;
    *) echo "$1" ;;
  esac
}

# Read a scalar field from the schema-owned conductor block.
#
# The optional default is retained for callers migrating from the legacy
# accessor signature, but intentionally never substitutes for a failed read:
# update decisions must decline rather than pretend configuration was read.
# Usage: conductor_cfg_get <field> [default]
conductor_cfg_get() {
  if ! seed_conductor_config_from_legacy; then
    return 1
  fi
  local field=$1
  if ! command -v conduct-ts &>/dev/null; then
    warn "conduct-ts is required to read conductor configuration; install or restore it, then re-run bin/install"
    return 1
  fi
  local value
  if ! value=$(conduct-ts config read "conductor.$(conductor_cfg_key "$field")" 2>&1); then
    warn "${value:-conduct-ts could not read conductor configuration; install or restore it, then re-run bin/install}"
    return 1
  fi
  printf '%s\n' "$value"
}

# Write a scalar field to the schema-owned conductor block.
# Usage: conductor_cfg_set <field> <value>
conductor_cfg_set() {
  if ! seed_conductor_config_from_legacy; then
    return 1
  fi
  local field=$1 value=$2
  if ! command -v conduct-ts &>/dev/null; then
    warn "conduct-ts is required to save conductor configuration; install or restore it, then re-run bin/install"
    return 1
  fi
  conduct-ts config set "conductor.$(conductor_cfg_key "$field")" "$value"
}

# Copy supported values from the former Claude-only JSON config into the
# schema-owned conductor block exactly once.  Renaming the source is the
# migration marker, so invalid JSON remains available for a later repair.
# Usage: seed_conductor_config_from_legacy
seed_conductor_config_from_legacy() {
  local legacy_values field value

  if [ "${CONDUCTOR_LEGACY_SEED_ATTEMPTED:-}" = "1" ]; then
    return 0
  fi
  CONDUCTOR_LEGACY_SEED_ATTEMPTED=1

  [ -e "$CONDUCTOR_CONFIG" ] || return 0

  if ! legacy_values=$(CONDUCTOR_CONFIG="$CONDUCTOR_CONFIG" python3 - <<'PY'
import json
import os
import sys

path = os.environ["CONDUCTOR_CONFIG"]
try:
    with open(path, encoding="utf-8") as source:
        config = json.load(source)
except (OSError, json.JSONDecodeError) as error:
    print(error, file=sys.stderr)
    sys.exit(1)

if not isinstance(config, dict):
    print("expected a JSON object", file=sys.stderr)
    sys.exit(1)

channel = config.get("updateChannel")
if "updateChannel" in config:
    if isinstance(channel, str) and channel in {"tagged", "main"}:
        print(f"updateChannel\t{channel}")
    else:
        print("invalid-updateChannel")

if type(config.get("autoCheck")) is bool:
    print(f"autoCheck\t{'true' if config['autoCheck'] else 'false'}")

for field in ("currentVersion", "lastCheckedAt"):
    if isinstance(config.get(field), str):
        print(f"{field}\t{config[field]}")
PY
); then
    warn "legacy JSON configuration is empty or malformed; leaving it unchanged"
    return 1
  fi

  while IFS=$'\t' read -r field value; do
    [ -n "$field" ] || continue
    if [ "$field" = "invalid-updateChannel" ]; then
      warn "legacy JSON updateChannel is invalid; expected tagged or main"
      continue
    fi
    if ! conductor_cfg_set "$field" "$value"; then
      warn "could not seed conductor configuration from legacy JSON"
      return 1
    fi
  done <<< "$legacy_values"

  if ! mv "$CONDUCTOR_CONFIG" "${CONDUCTOR_CONFIG}.migrated"; then
    warn "could not rename legacy JSON configuration after seeding"
    return 1
  fi
}

# Read a scalar or array from ~/.ai-conductor/config.yml using dotted paths
# (e.g. "markdown_viewer.command"). Arrays come back space-joined. Falls back
# to the default if the file or path is missing.
# Usage: harness_cfg_get <dotted.path> [default]
harness_cfg_get() {
  local field=$1 default=${2:-}
  [ -f "$HARNESS_USER_CONFIG" ] || { echo "$default"; return 0; }
  CFG_PATH="$HARNESS_USER_CONFIG" FIELD="$field" DEFAULT="$default" python3 - <<'PY' 2>/dev/null || echo "$default"
import os, sys
try:
    import yaml
except Exception:
    print(os.environ.get("DEFAULT", ""))
    sys.exit(0)
path = os.environ["CFG_PATH"]
field = os.environ["FIELD"]
default = os.environ.get("DEFAULT", "")
try:
    with open(path) as f:
        cfg = yaml.safe_load(f) or {}
except Exception:
    print(default); sys.exit(0)
node = cfg
for part in field.split("."):
    if isinstance(node, dict) and part in node:
        node = node[part]
    else:
        print(default); sys.exit(0)
if node is None:
    print(default)
elif isinstance(node, list):
    print(" ".join(str(x) for x in node))
elif isinstance(node, bool):
    print("true" if node else "false")
else:
    print(node)
PY
}

# Write a scalar to ~/.ai-conductor/config.yml at a dotted path, preserving
# surrounding content. Intermediate mappings are created as needed.
# Usage: harness_cfg_set <dotted.path> <value>
harness_cfg_set() {
  local field=$1 value=$2
  mkdir -p "$(dirname "$HARNESS_USER_CONFIG")"
  CFG_PATH="$HARNESS_USER_CONFIG" FIELD="$field" VALUE="$value" python3 - <<'PY'
import os, yaml
from pathlib import Path
p = Path(os.environ["CFG_PATH"])
field = os.environ["FIELD"].split(".")
value = os.environ["VALUE"]
try:
    cfg = yaml.safe_load(p.read_text()) or {}
except Exception:
    cfg = {}
node = cfg
for part in field[:-1]:
    node = node.setdefault(part, {})
node[field[-1]] = value
p.write_text(yaml.safe_dump(cfg, default_flow_style=False, sort_keys=False))
PY
}

# ─── Markdown rendering ─────────────────────────────────────────────────────

# Render a markdown file using the configured viewer. Reads
# markdown_viewer.{command,args,mode} from ~/.ai-conductor/config.yml (or
# .ai-conductor/config.yml in the project — not read here directly; conduct-ts does
# the full project-level merge). Falls back to cat if the configured viewer
# isn't on PATH, so conduct never hard-crashes on a missing renderer.
render_md() {
  local file=$1
  local cmd args mode
  cmd=$(harness_cfg_get markdown_viewer.command "glow")
  args=$(harness_cfg_get markdown_viewer.args "-p -w 80 {file}")
  mode=$(harness_cfg_get markdown_viewer.mode "inline")

  if ! command -v "$cmd" &>/dev/null; then
    warn "markdown viewer '$cmd' not found — falling back to cat"
    cat "$file"
    return
  fi

  local resolved_args=()
  local a
  for a in $args; do
    resolved_args+=("${a//\{file\}/$file}")
  done

  case "$mode" in
    inline|blocking)
      "$cmd" "${resolved_args[@]}"
      ;;
    external)
      "$cmd" "${resolved_args[@]}" &>/dev/null &
      if [ -t 0 ]; then
        read -r -p "  Press enter when done reviewing $(basename "$file"): " _ || true
      fi
      ;;
    *)
      warn "unknown markdown_viewer.mode '$mode' — running inline"
      "$cmd" "${resolved_args[@]}"
      ;;
  esac
}
