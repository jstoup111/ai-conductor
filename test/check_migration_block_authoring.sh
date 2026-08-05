#!/usr/bin/env bash
set -euo pipefail

# Lexically validates runnable CHANGELOG migration blocks. This is an
# authoring-time guard, not a sandbox: it rejects known unsafe forms before a
# consumer's bin/migrate ever sees them.

CHANGELOG=${1:-"$(cd "$(dirname "$0")/.." && pwd)/CHANGELOG.md"}

if [ ! -f "$CHANGELOG" ]; then
  printf 'FAIL migration block authoring contract: changelog not found: %s\n' "$CHANGELOG" >&2
  exit 1
fi

FAIL=0
IN_BLOCK=false
RELEASE=""
BLOCK_RELEASE=""
SKIP_BLOCK=false
LINE_NUMBER=0

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
      if [ "$quote" = "'" ] && [ "$character" = "'" ]; then
        quote=''
      elif [ "$quote" = '"' ]; then
        if [ "$escaped" = true ]; then
          escaped=false
        elif [ "$character" = $'\\' ]; then
          escaped=true
        elif [ "$character" = '"' ]; then
          quote=''
        fi
      fi
    elif [ "$escaped" = true ]; then
      # An unquoted backslash quotes the next character. Keep ordinary
      # characters because quote removal makes them part of the command word,
      # but replace syntax characters so they cannot start a string or become
      # a command separator in the stripped representation.
      if [[ "$character" = [[:space:]] || "$character" = '"' || "$character" = "'" || "$character" = ';' || "$character" = '|' || "$character" = '&' ]]; then
        result+=x
      else
        result+=$character
      fi
      escaped=false
    elif [ "$character" = $'\\' ]; then
      escaped=true
    elif [ "$character" = "'" ] || [ "$character" = '"' ]; then
      quote=$character
    else
      result+=$character
    fi

    index=$((index + 1))
  done

  [ "$escaped" = true ] && result+=x

  printf '%s' "$result"
}

while IFS= read -r line || [ -n "$line" ]; do
  LINE_NUMBER=$((LINE_NUMBER + 1))

  if [ "$IN_BLOCK" = false ]; then
    if [[ "$line" =~ ^##\ \[ ]]; then
      if [[ "$line" =~ ^##\ \[([0-9]+\.[0-9]+\.[0-9]+)\] ]]; then
        RELEASE=${BASH_REMATCH[1]}
        SKIP_BLOCK=false
      elif [[ "$line" =~ ^##\ \[Unversioned\] ]]; then
        # The pre-versioned archive predates runnable release attribution and
        # is unreachable by bin/migrate's semver selector.
        RELEASE=""
        SKIP_BLOCK=true
      else
        RELEASE=""
        SKIP_BLOCK=false
      fi
    fi

    if [ "$line" = '```bash migration' ]; then
      IN_BLOCK=true
      BLOCK_RELEASE=$RELEASE
      if [ -z "$BLOCK_RELEASE" ] && [ "$SKIP_BLOCK" = false ]; then
        violation 'attribution' 'migration block must belong to a ## [x.y.z] release entry'
      fi
    fi
    continue
  fi

  if [ "$line" = '```' ]; then
    IN_BLOCK=false
    continue
  fi

  [ "$SKIP_BLOCK" = true ] && continue

  # Documentation and comments may describe forbidden commands; only source
  # lines that execute them are subject to the command clauses.
  trimmed=${line#"${line%%[![:space:]]*}"}
  [ -z "$trimmed" ] && continue
  [[ "$trimmed" == \#* ]] && continue
  [[ "$trimmed" == echo\ * ]] && continue

  if [[ "$line" =~ (^|[[:space:];|&])\./bin/ ]]; then
    violation 'harness-path' 'harness binaries must use ${HARNESS_DIR}/bin, never ./bin'
  fi
  consumer_harness_source_pattern='(git[[:space:]]+rev-parse[[:space:]]+--show-toplevel\)"?[[:space:]]*/src/conductor|git[[:space:]]+rev-parse[[:space:]]+--show-toplevel\)"?[[:space:]]*/\.claude/harness|\$\{?PROJECT_ROOT\}?"?/src/conductor|\$\{?PROJECT_ROOT\}?"?/\.claude/harness)'
  if [[ "$line" =~ $consumer_harness_source_pattern ]]; then
    violation 'harness-path' 'harness-owned conductor and hook sources must use ${HARNESS_DIR}, never consumer-relative paths'
  fi
  command_line=$(strip_quoted_strings "$line")
  if [[ "$command_line" =~ (^[[:space:]]*|[;|&][[:space:]]*|[[:space:]](if|then|do|else|elif)[[:space:]]+)git[[:space:]]+worktree[[:space:]]+remove.*(^|[[:space:]])(-f+|--force)([[:space:]]|$) ]] \
    || [[ "$command_line" =~ (^[[:space:]]*|[;|&][[:space:]]*|[[:space:]](if|then|do|else|elif)[[:space:]]+)git[[:space:]]+branch.*(^|[[:space:]])-D([[:space:]]|$) ]]; then
    violation 'destructive-git' 'do not force-remove worktrees or branches'
  fi
  if [[ "$line" =~ (^|[[:space:];|&])(conduct-ts|.+/bin/conduct-ts)[[:space:]]+daemon[[:space:]]+(start|stop|restart) ]] \
    || [[ "$line" =~ (^|[[:space:];|&])(kill|pkill|killall)[[:space:]] ]]; then
    violation 'daemon-lifecycle' 'daemon lifecycle actions require an operator and cannot run in a block'
  fi
done < "$CHANGELOG"

if [ "$IN_BLOCK" = true ]; then
  violation 'attribution' 'migration block is unterminated and cannot be attributed safely'
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

printf 'PASS migration block authoring contract: %s\n' "$CHANGELOG"
