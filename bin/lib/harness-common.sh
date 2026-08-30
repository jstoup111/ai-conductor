#!/usr/bin/env bash
# harness-common.sh — Shared helpers used by the surviving shell entrypoints.
#
# This module is the permanent home for shell-side configuration and update
# helpers used by bin/update and other harness maintenance commands.
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

# Resolve the launcher used by harness-owned shell helpers.  A sourced library
# has no caller-provided HARNESS_DIR, so its own BASH_SOURCE location is the
# authoritative repo-relative anchor.  An explicit override wins; unusual
# layouts retain the historical PATH fallback.
# Usage: conductor_cli
conductor_cli() {
  if [ -n "${AI_CONDUCTOR_ENGINE_BIN:-}" ]; then
    printf '%s\n' "$AI_CONDUCTOR_ENGINE_BIN"
    return 0
  fi

  local common_dir repo_launcher
  common_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_launcher="$common_dir/../ai-conductor"
  if [ -x "$repo_launcher" ]; then
    printf '%s\n' "$repo_launcher"
  else
    printf '%s\n' 'ai-conductor'
  fi
}

# Read a scalar field from the schema-owned conductor block.
#
# The optional default is retained for callers migrating from the legacy
# accessor signature, but intentionally never substitutes for a failed read:
# update decisions must decline rather than pretend configuration was read.
#
# Seeding the legacy JSON is a one-time migration convenience, not a
# precondition for reading. It therefore degrades rather than blocking: the
# seed reports its own failure on stderr and leaves its source in place for a
# later repair, and the read below still decides fail-closed on the
# schema-owned block. Letting a stale ~/.claude JSON file veto the read
# disabled the update check outright even when config.yml was perfectly
# readable — most visibly mid-update, when an installed ai-conductor too old for
# `config set` failed the seed's write while `config read` still worked.
# Usage: conductor_cfg_get <field> [default]
conductor_cfg_get() {
  seed_conductor_config_from_legacy || true
  local field=$1
  local cli
  cli="$(conductor_cli)"
  if [ "$cli" = 'ai-conductor' ] && ! command -v ai-conductor &>/dev/null; then
    warn "ai-conductor is required to read conductor configuration; install or restore it, then re-run bin/install" >&2
    return 1
  fi
  local value
  # Keep diagnostics separate from scalar stdout: combining streams turns a
  # value such as `false` or `main` into a multi-line string and makes callers
  # take the tagged/default path. Failed reads still report their original
  # diagnostic, while successful reads remain silent.
  local diagnostic_file diagnostics
  if ! diagnostic_file=$(mktemp "${TMPDIR:-/tmp}/conduct-config-read.XXXXXX"); then
    warn "could not create a temporary file to read conductor configuration" >&2
    return 1
  fi
  if ! value=$("$cli" config read "conductor.$(conductor_cfg_key "$field")" 2>"$diagnostic_file"); then
    diagnostics=$(<"$diagnostic_file")
    rm -f "$diagnostic_file"
    diagnostics=$(printf '%s\n%s\n' "$value" "$diagnostics" | sed '/^$/d')
    warn "${diagnostics:-ai-conductor could not read conductor configuration; install or restore it, then re-run bin/install}" >&2
    return 1
  fi
  rm -f "$diagnostic_file"
  printf '%s\n' "$value"
}

# Write a scalar field to the schema-owned conductor block.
# Usage: conductor_cfg_set <field> <value>
conductor_cfg_set() {
  if ! seed_conductor_config_from_legacy; then
    return 1
  fi
  local field=$1 value=$2
  local cli
  cli="$(conductor_cli)"
  if [ "$cli" = 'ai-conductor' ] && ! command -v ai-conductor &>/dev/null; then
    warn "ai-conductor is required to save conductor configuration; install or restore it, then re-run bin/install" >&2
    return 1
  fi
  "$cli" config set "conductor.$(conductor_cfg_key "$field")" "$value"
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
    warn "legacy JSON configuration is empty or malformed; leaving it unchanged" >&2
    return 1
  fi

  while IFS=$'\t' read -r field value; do
    [ -n "$field" ] || continue
    if [ "$field" = "invalid-updateChannel" ]; then
      warn "legacy JSON updateChannel is invalid; expected tagged or main" >&2
      continue
    fi
    if ! conductor_cfg_set "$field" "$value"; then
      warn "could not seed conductor configuration from legacy JSON" >&2
      return 1
    fi
  done <<< "$legacy_values"

  if ! mv "$CONDUCTOR_CONFIG" "${CONDUCTOR_CONFIG}.migrated"; then
    warn "could not rename legacy JSON configuration after seeding" >&2
    return 1
  fi
}

# Resolve the installed harness identity from its checkout.
#
# Output is tab-separated: kind, identity, baseline, distance, source.
# The baseline is the highest stable release tag reachable from HEAD.  An
# absent baseline or an unqueryable checkout is intentionally undeterminable:
# callers must decline to guess rather than treating persisted configuration
# as an identity source.
# Usage: resolve_harness_identity <harness_dir>
resolve_harness_identity() {
  local harness_dir=$1 baseline="" distance tag tags

  if ! tags=$(git -C "$harness_dir" tag --merged HEAD -l 'v*.*.*' --sort=-v:refname 2>/dev/null); then
    printf 'undeterminable\tunknown\t\t\tnone\n'
    return 0
  fi

  while IFS= read -r tag; do
    if [[ "$tag" =~ ^v[0-9]+(\.[0-9]+)+$ ]]; then
      baseline=$tag
      break
    fi
  done <<< "$tags"

  if [ -z "$baseline" ]; then
    printf 'undeterminable\tunknown\t\t\tnone\n'
    return 0
  fi

  if ! distance=$(git -C "$harness_dir" rev-list --count "$baseline"..HEAD 2>/dev/null); then
    printf 'undeterminable\tunknown\t\t\tnone\n'
    return 0
  fi

  if [ "$distance" -eq 0 ]; then
    printf 'release\t%s\t%s\t%s\tchecked-out tag\n' "$baseline" "$baseline" "$distance"
  else
    printf 'post-release\t%s+%s\t%s\t%s\tcheckout\n' "$baseline" "$distance" "$baseline" "$distance"
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
# .ai-conductor/config.yml in the project — not read here directly; ai-conductor does
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

# ─── Global codex rate card ─────────────────────────────────────────────────

# Link the harness checkout's committed codex rate card
# (.ai-conductor/rate-card.json) at ~/.ai-conductor/rate-card.json. The engine
# falls back to that global card when a project has no committed card of its
# own, so codex dispatches price to real dollars in every project — not just
# ones that ran `conduct rate-card refresh` themselves. A symlink (same idiom
# as skill installs) tracks the checkout: a daily rate-card bot PR merged to
# main updates the global card with no re-run of install/update. A missing
# target simply fails closed to cost-unmetered. A regular file already at the
# destination is operator-owned and left alone. Never fatal.
sync_global_rate_card() {
  local harness_dir=$1
  local src="${harness_dir}/.ai-conductor/rate-card.json"
  local dest_dir="${HOME}/.ai-conductor"
  local dest="${dest_dir}/rate-card.json"
  [ -f "$src" ] || return 0

  if [ -L "$dest" ]; then
    [ "$(readlink "$dest")" = "$src" ] && return 0
  elif [ -e "$dest" ]; then
    warn "Global rate card ${dest} is a regular file — leaving it; remove it to link the harness card"
    return 0
  fi

  if mkdir -p "$dest_dir" && ln -sfn "$src" "$dest"; then
    ok "Linked global rate card (${dest} -> ${src})"
  else
    warn "Could not link global rate card at ${dest}"
  fi
}
