#!/usr/bin/env bash
set -euo pipefail

# Lexically validates runnable CHANGELOG migration blocks. This is an
# authoring-time guard, not a sandbox: it rejects known unsafe forms before a
# consumer's bin/migrate ever sees them.

CHANGELOG=${1:-"$(cd "$(dirname "$0")/.." && pwd)/CHANGELOG.md"}
MIGRATION_FENCES_HELPER=${MIGRATION_FENCES_HELPER:-"$(cd "$(dirname "$0")/.." && pwd)/bin/lib/migration_fences.py"}

if [ ! -f "$CHANGELOG" ]; then
  printf 'FAIL migration block authoring contract: changelog not found: %s\n' "$CHANGELOG" >&2
  exit 1
fi

FAIL=0
LINE_NUMBER=0
RECORDS=$(mktemp)
trap 'rm -f "$RECORDS"' EXIT

violation() {
  local clause=$1 line=$2
  printf '%s:%s: %s clause: %s\n' "$CHANGELOG" "$LINE_NUMBER" "$clause" "$line" >&2
  FAIL=1
}

strip_quoted_strings() {
  local source=$1 result='' quote='' character escaped=false index=0
  while [ "$index" -lt "${#source}" ]; do
    character=${source:index:1}
    if [ -n "$quote" ]; then
      if [ "$quote" = "'" ] && [ "$character" = "'" ]; then quote=''
      elif [ "$quote" = '"' ]; then
        if [ "$escaped" = true ]; then escaped=false
        elif [ "$character" = $'\\' ]; then escaped=true
        elif [ "$character" = '"' ]; then quote=''; fi
      fi
    elif [ "$escaped" = true ]; then
      # Keep ordinary escaped characters, but hide syntax that would become
      # executable after quote removal.
      if [[ "$character" = [[:space:]] || "$character" = '"' || "$character" = "'" || "$character" = ';' || "$character" = '|' || "$character" = '&' ]]; then result+=x; else result+=$character; fi
      escaped=false
    elif [ "$character" = $'\\' ]; then escaped=true
    elif [ "$character" = "'" ] || [ "$character" = '"' ]; then quote=$character
    else result+=$character; fi
    index=$((index + 1))
  done
  [ "$escaped" = true ] && result+=x
  printf '%s' "$result"
}

release_context_for_line() {
  local candidate_line=$1 line release='' skip_block=false line_number=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_number=$((line_number + 1))
    [ "$line_number" -ge "$candidate_line" ] && break
    line=${line%$'\r'}
    if [[ "$line" =~ ^##\ \[ ]]; then
      if [[ "$line" =~ ^##\ \[([0-9]+\.[0-9]+\.[0-9]+)\] ]]; then release=${BASH_REMATCH[1]}; skip_block=false
      elif [[ "$line" =~ ^##\ \[Unversioned\] ]]; then release=''; skip_block=true
      else release=''; skip_block=false; fi
    fi
  done < "$CHANGELOG"
  BLOCK_RELEASE=$release
  SKIP_BLOCK=$skip_block
}

check_source_line() {
  local line=$1 trimmed command_line consumer_harness_source_pattern
  [ "$SKIP_BLOCK" = true ] && return
  trimmed=${line#"${line%%[![:space:]]*}"}
  [ -z "$trimmed" ] && return
  [[ "$trimmed" == \#* ]] && return
  [[ "$trimmed" == echo\ * ]] && return
  if [[ "$line" =~ (^|[[:space:];\|&])\./bin/ ]]; then violation 'harness-path' 'harness binaries must use ${HARNESS_DIR}/bin, never ./bin'; fi
  consumer_harness_source_pattern='(git[[:space:]]+rev-parse[[:space:]]+--show-toplevel\)"?[[:space:]]*/src/conductor|git[[:space:]]+rev-parse[[:space:]]+--show-toplevel\)"?[[:space:]]*/\.claude/harness|\$\{?PROJECT_ROOT\}?"?/src/conductor|\$\{?PROJECT_ROOT\}?"?/\.claude/harness)'
  if [[ "$line" =~ $consumer_harness_source_pattern ]]; then violation 'harness-path' 'harness-owned conductor and hook sources must use ${HARNESS_DIR}, never consumer-relative paths'; fi
  command_line=$(strip_quoted_strings "$line")
  if [[ "$command_line" =~ (^|[[:space:];\|&])git[[:space:]]+worktree[[:space:]]+remove.*(^|[[:space:]])(-f+|--force)([[:space:]]|$) ]] || [[ "$command_line" =~ (^|[[:space:];\|&])git[[:space:]]+branch.*(^|[[:space:]])-D([[:space:]]|$) ]]; then violation 'destructive-git' 'do not force-remove worktrees or branches'; fi
  if [[ "$line" =~ (^|[[:space:];\|&])(conduct-ts|.+/bin/conduct-ts)[[:space:]]+daemon[[:space:]]+(start|stop|restart) ]] || [[ "$line" =~ (^|[[:space:];\|&])(kill|pkill|killall)[[:space:]] ]]; then violation 'daemon-lifecycle' 'daemon lifecycle actions require an operator and cannot run in a block'; fi
}

if ! python3 "$MIGRATION_FENCES_HELPER" --authoring-records "$CHANGELOG" > "$RECORDS"; then
  printf 'FAIL migration block authoring contract: migration fence recognizer unavailable or failed: %s\n' "$MIGRATION_FENCES_HELPER" >&2
  exit 1
fi

while :; do
  if ! IFS= read -r -d '' candidate_line; then
    [ -z "$candidate_line" ] && break
    printf 'FAIL migration block authoring contract: invalid truncated migration fence recognizer output\n' >&2; exit 1
  fi
  if ! IFS= read -r -d '' record_kind || ! IFS= read -r -d '' closed || ! IFS= read -r -d '' in_migration_section || ! IFS= read -r -d '' script; then
    printf 'FAIL migration block authoring contract: invalid truncated migration fence recognizer output\n' >&2; exit 1
  fi
  if [ "$record_kind" != candidate ] || [[ ! "$candidate_line" =~ ^[1-9][0-9]*$ ]] || [[ ! "$closed" =~ ^[01]$ ]] || [[ ! "$in_migration_section" =~ ^[01]$ ]]; then
    printf 'FAIL migration block authoring contract: invalid migration fence recognizer record\n' >&2; exit 1
  fi
  release_context_for_line "$candidate_line"
  if [ -z "$BLOCK_RELEASE" ] && [ "$SKIP_BLOCK" = false ]; then LINE_NUMBER=$candidate_line; violation 'attribution' 'migration block must belong to a ## [x.y.z] release entry'; fi
  script_line=0
  while IFS= read -r line || [ -n "$line" ]; do
    script_line=$((script_line + 1)); LINE_NUMBER=$((candidate_line + script_line)); check_source_line "$line"
  done <<< "$script"
  if [ "$closed" = 0 ]; then LINE_NUMBER=$candidate_line; violation 'attribution' 'migration block is unterminated and cannot be attributed safely'; fi
done < "$RECORDS"

if [ "$FAIL" -ne 0 ]; then exit 1; fi
printf 'PASS migration block authoring contract: %s\n' "$CHANGELOG"
