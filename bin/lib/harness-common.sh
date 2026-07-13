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

# Read a scalar field from the legacy ai-conductor.config.json. Kept as a
# read-only fallback for installs that haven't migrated to YAML yet.
# Usage: conductor_cfg_get <field> [default]
conductor_cfg_get() {
  local field=$1 default=${2:-}
  [ -f "$CONDUCTOR_CONFIG" ] || { echo "$default"; return 0; }
  python3 - "$CONDUCTOR_CONFIG" "$field" "$default" <<'PY' 2>/dev/null || echo "$default"
import json, sys
try:
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
    val = cfg.get(sys.argv[2], sys.argv[3])
    print(val if val is not None else sys.argv[3])
except Exception:
    print(sys.argv[3])
PY
}

# Write a scalar field to the legacy ai-conductor.config.json, preserving
# other fields. Kept only so a pre-migration install can still boot; new
# writes should target the YAML via harness_cfg_set.
# Usage: conductor_cfg_set <field> <value>
conductor_cfg_set() {
  local field=$1 value=$2
  mkdir -p "$(dirname "$CONDUCTOR_CONFIG")"
  CFG_PATH="$CONDUCTOR_CONFIG" FIELD="$field" VALUE="$value" python3 -c '
import json, os
from pathlib import Path
p = Path(os.environ["CFG_PATH"])
try:
    cfg = json.loads(p.read_text())
except Exception:
    cfg = {}
cfg[os.environ["FIELD"]] = os.environ["VALUE"]
p.write_text(json.dumps(cfg, indent=2) + "\n")
'
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
