#!/usr/bin/env bash
set -uo pipefail

# check_update_flow_config_ownership.sh — Verifies the update flow stays on the
# schema-owned configuration surface.
#
# The update flow formerly read and wrote ~/.claude/ai-conductor.config.json in
# several scripts. The legacy file is now a one-time seed input owned solely by
# bin/lib/harness-common.sh; any other bin/ reference recreates split ownership.
#
# The conductor-key allowlist is never duplicated here. It is extracted from
# validateConductorBlock, so a schema edit this shell guard cannot understand
# fails closed rather than silently accepting a stale allowlist.
#
# This check lives in its own script so test/test_harness_integrity_update_flow.sh
# can drive it against disposable fixture trees without re-invoking the whole
# integrity suite (which would recurse, since the suite runs that spec).
#
# Environment seams (for fixture trees):
#   HARNESS_INTEGRITY_UPDATE_FLOW_BIN_DIR    — bin/ directory to inspect
#   HARNESS_INTEGRITY_CONDUCTOR_SCHEMA_FILE  — config.ts carrying validateConductorBlock
#
# Usage: bash test/check_update_flow_config_ownership.sh
# Exit:  0 = the update flow owns only schema-allowed configuration
#        1 = a violation, an unreadable input, or a scan that could not run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

update_flow_bin_dir="${HARNESS_INTEGRITY_UPDATE_FLOW_BIN_DIR:-${HARNESS_DIR}/bin}"
conductor_schema_file="${HARNESS_INTEGRITY_CONDUCTOR_SCHEMA_FILE:-${HARNESS_DIR}/src/conductor/src/engine/config.ts}"
legacy_seed_file="${update_flow_bin_dir}/lib/harness-common.sh"

# Deterministic recursive scan. `grep` is the repository-standard scanner and is
# always present, so an absent ripgrep can no longer turn a guard into an empty
# passing scan. grep's exit codes are load-bearing here: 0 = matches, 1 = no
# matches (a real, trustworthy negative), >=2 = the scan itself failed. Only the
# first two are results; the third fails closed via SCAN_FAILED.
SCAN_FAILED=""
scan_update_flow() {
  local pattern=$1 hits status
  hits=$(grep -rnE "$pattern" "$update_flow_bin_dir" 2>/dev/null)
  status=$?
  if [ "$status" -ge 2 ]; then
    SCAN_FAILED="${SCAN_FAILED}${update_flow_bin_dir}: scan failed (grep exit ${status}) for pattern: ${pattern}
"
    return 0
  fi
  printf '%s' "$hits"
}

if [ ! -d "$update_flow_bin_dir" ]; then
  echo "Cannot inspect update flow: bin directory is missing: $update_flow_bin_dir"
  exit 1
fi

if [ ! -f "$conductor_schema_file" ]; then
  echo "Cannot determine conductor schema keys: missing $conductor_schema_file"
  exit 1
fi

# The allowlist is deliberately constrained to validateConductorBlock's
# declaration. Matching exactly one non-empty literal Set keeps a changed
# validator shape from silently turning this guard into a no-op.
conductor_allowed_line=$(awk '
  /^function validateConductorBlock\(/ { in_validator = 1 }
  in_validator && /const allowed = new Set\(\[[^]]*\]\);/ { print; count++ }
  in_validator && /^}/ { exit }
  END { if (count != 1) exit 1 }
' "$conductor_schema_file" 2>/dev/null || true)
conductor_allowed_keys=$(printf '%s\n' "$conductor_allowed_line" \
  | grep -oE "'[A-Za-z][A-Za-z0-9_]*'" \
  | tr -d "'" \
  | sort -u || true)

if [ -z "$conductor_allowed_line" ] || [ -z "$conductor_allowed_keys" ]; then
  echo "Cannot determine allowed conductor keys from ${conductor_schema_file}:validateConductorBlock"
  exit 1
fi

violations=""

legacy_config_hits=$(scan_update_flow 'ai-conductor\.config\.json')
if [ -n "$legacy_config_hits" ]; then
  while IFS= read -r legacy_config_hit; do
    [ -n "$legacy_config_hit" ] || continue
    legacy_config_path=${legacy_config_hit%%:*}
    if [ "$legacy_config_path" != "$legacy_seed_file" ]; then
      violations="${violations}${legacy_config_hit}
"
    fi
  done <<< "$legacy_config_hits"
fi

# Direct conduct-ts config calls must name a key admitted by the schema.
# The shared accessors may instead use legacy field names, so validate both
# their case-map outputs and every static accessor argument below.
conductor_key_hits=$(scan_update_flow 'conductor\.[A-Za-z_][A-Za-z0-9_]*')
if [ -n "$conductor_key_hits" ]; then
  while IFS= read -r conductor_key_hit; do
    [ -n "$conductor_key_hit" ] || continue
    # The legacy filename itself contains the text "conductor.config".
    # It belongs to the path-ownership audit above, not the schema-key
    # audit; otherwise the permitted seed would be a false unknown key.
    [[ "$conductor_key_hit" == *"ai-conductor.config.json"* ]] && continue
    conductor_key=$(printf '%s\n' "$conductor_key_hit" | sed -nE 's/.*conductor\.([A-Za-z_][A-Za-z0-9_]*).*/\1/p')
    if ! grep -Fxq "$conductor_key" <<< "$conductor_allowed_keys"; then
      violations="${violations}${conductor_key_hit}
"
    fi
  done <<< "$conductor_key_hits"
fi

if [ -f "$legacy_seed_file" ]; then
  accessor_map_hits=$(awk '
    /^conductor_cfg_key\(\)/ { in_map = 1 }
    in_map && /echo "[A-Za-z][A-Za-z0-9_]*"/ { print FILENAME ":" NR ":" $0 }
    in_map && /^}/ { exit }
  ' "$legacy_seed_file" 2>/dev/null || true)
  if [ -n "$accessor_map_hits" ]; then
    while IFS= read -r accessor_map_hit; do
      [ -n "$accessor_map_hit" ] || continue
      accessor_map_key=$(printf '%s\n' "$accessor_map_hit" | sed -nE 's/.*echo "([A-Za-z][A-Za-z0-9_]*)".*/\1/p')
      if ! grep -Fxq "$accessor_map_key" <<< "$conductor_allowed_keys"; then
        violations="${violations}${accessor_map_hit}
"
      fi
    done <<< "$accessor_map_hits"
  fi

  accessor_fields=$(scan_update_flow 'conductor_cfg_(get|set)[[:space:]]+[A-Za-z][A-Za-z0-9_]*')
  if [ -n "$accessor_fields" ]; then
    accessor_map_fields=$(awk '
      /^conductor_cfg_key\(\)/ { in_map = 1 }
      in_map && /^[[:space:]]*[A-Za-z][A-Za-z0-9_]*\)[[:space:]]+echo/ {
        sub(/^[[:space:]]*/, "")
        sub(/\).*/, "")
        print
      }
      in_map && /^}/ { exit }
    ' "$legacy_seed_file" 2>/dev/null || true)
    while IFS= read -r accessor_field_hit; do
      [ -n "$accessor_field_hit" ] || continue
      accessor_field=$(printf '%s\n' "$accessor_field_hit" | sed -nE 's/.*conductor_cfg_(get|set)[[:space:]]+([A-Za-z][A-Za-z0-9_]*).*/\2/p')
      if ! grep -Fxq "$accessor_field" <<< "$accessor_map_fields" \
        && ! grep -Fxq "$accessor_field" <<< "$conductor_allowed_keys"; then
        violations="${violations}${accessor_field_hit}
"
      fi
    done <<< "$accessor_fields"
  fi
else
  violations="${violations}${legacy_seed_file}: missing shared accessor map
"
fi

# A scan that could not run is never a pass: report it before any verdict.
if [ -n "$SCAN_FAILED" ]; then
  printf '%s' "$SCAN_FAILED" | sed 's/^/Scan error: /'
  exit 1
fi

if [ -n "$violations" ]; then
  printf '%s' "$violations" | sed 's/^/Violation: /'
  exit 1
fi

exit 0
