#!/usr/bin/env bash
set -euo pipefail

# Covers: task:1
# Exercises the public bootstrap entry point with only a local stand-in source.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_SCRIPT="$HARNESS_DIR/docs/install.sh"

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

SOURCE_REPO="$TMP_ROOT/source"
RECORD="$TMP_ROOT/installer-record"
git init -q "$SOURCE_REPO"
git -C "$SOURCE_REPO" config user.email test@example.invalid
git -C "$SOURCE_REPO" config user.name test
mkdir -p "$SOURCE_REPO/bin"
cat > "$SOURCE_REPO/bin/install" <<'EOF'
#!/bin/sh
printf '%s\n' "$PWD|$*|${AI_CONDUCTOR_CHANNEL-}" >> "$INSTALLER_RECORD"
EOF
cat > "$SOURCE_REPO/bin/update" <<'EOF'
#!/bin/sh
printf '%s\n' "$PWD|$*|${AI_CONDUCTOR_CHANNEL-}" >> "$INSTALLER_RECORD"
EOF
chmod +x "$SOURCE_REPO/bin/install" "$SOURCE_REPO/bin/update"
git -C "$SOURCE_REPO" add bin
git -C "$SOURCE_REPO" commit -qm fixture

failures=''

run_case() {
  local name=$1
  shift
  local case_home="$TMP_ROOT/home-$name"
  mkdir -p "$case_home"
  : > "$RECORD"

  set +e
  CASE_OUTPUT=$(HOME="$case_home" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$RECORD" sh -s -- "$@" < "$INSTALL_SCRIPT" 2>&1)
  CASE_STATUS=$?
  set -e
  CASE_HOME=$case_home
}

assert_untouched() {
  local name=$1
  if [ -e "$CASE_HOME/.ai-conductor/harness" ] || [ -s "$RECORD" ]; then
    failures+="$name touched the target or reached the stand-in installer\n"
  fi
}

run_case help --help
if [ "$CASE_STATUS" -eq 0 ] \
  && grep -Fq -- '--channel' <<< "$CASE_OUTPUT" \
  && grep -Fq -- '--providers' <<< "$CASE_OUTPUT"; then
  echo 'PASS help prints bootstrap options without acquiring'
else
  failures+="help did not exit 0 with both option names: $CASE_OUTPUT\n"
fi
assert_untouched help

run_case short-help -h
if [ "$CASE_STATUS" -eq 0 ] && grep -Fq -- '--channel' <<< "$CASE_OUTPUT"; then
  echo 'PASS short help prints usage without acquiring'
else
  failures+="short help did not exit 0 with usage: $CASE_OUTPUT\n"
fi
assert_untouched short-help

run_case accepted-equals --channel=stable --providers=claude,codex
if [ "$CASE_STATUS" -eq 0 ]; then
  echo 'PASS equals-form options accept supported values without acquiring'
else
  failures+="supported equals-form options were rejected: $CASE_OUTPUT\n"
fi
assert_untouched accepted-equals

run_case unknown --not-an-option
if [ "$CASE_STATUS" -ne 0 ] && grep -Fq -- '--not-an-option' <<< "$CASE_OUTPUT"; then
  echo 'PASS unknown option is rejected before acquiring'
else
  failures+="unknown option was not rejected by name: $CASE_OUTPUT\n"
fi
assert_untouched unknown

run_case invalid-channel --channel beta
if [ "$CASE_STATUS" -ne 0 ] \
  && grep -Fq 'beta' <<< "$CASE_OUTPUT" \
  && grep -Fq 'stable, tagged, main' <<< "$CASE_OUTPUT"; then
  echo 'PASS invalid channel is rejected before acquiring'
else
  failures+="invalid channel was not rejected with accepted values: $CASE_OUTPUT\n"
fi
assert_untouched invalid-channel

run_case invalid-providers --providers gemini
if [ "$CASE_STATUS" -ne 0 ] \
  && grep -Fq 'gemini' <<< "$CASE_OUTPUT" \
  && grep -Fq 'claude, codex' <<< "$CASE_OUTPUT"; then
  echo 'PASS invalid provider is rejected before acquiring'
else
  failures+="invalid provider was not rejected with accepted values: $CASE_OUTPUT\n"
fi
assert_untouched invalid-providers

if [ -z "$failures" ]; then
  echo 'PASS bootstrap option parsing behavior is covered'
  exit 0
fi

printf 'FAIL bootstrap option parsing behavior is covered\n%b' "$failures"
exit 1
