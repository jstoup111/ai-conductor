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

PREREQUISITE_PATH="$TMP_ROOT/prerequisites"
mkdir -p "$PREREQUISITE_PATH"
cat > "$PREREQUISITE_PATH/present" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$PREREQUISITE_PATH/python3" <<'EOF'
#!/bin/sh
if [ "${1-}" = '-c' ] && [ "${2-}" = 'import yaml' ]; then
  exit 0
fi
exit 1
EOF
chmod +x "$PREREQUISITE_PATH/present" "$PREREQUISITE_PATH/python3"
for tool in git gh node npm tmux; do
  ln -s present "$PREREQUISITE_PATH/$tool"
done

MISSING_TOOLS_PATH="$TMP_ROOT/prerequisites-missing-tools"
mkdir -p "$MISSING_TOOLS_PATH"
for tool in git node npm; do
  ln -s "$PREREQUISITE_PATH/present" "$MISSING_TOOLS_PATH/$tool"
done
ln -s "$PREREQUISITE_PATH/python3" "$MISSING_TOOLS_PATH/python3"

PYTHON_FAILURE_PATH="$TMP_ROOT/prerequisites-no-yaml"
mkdir -p "$PYTHON_FAILURE_PATH"
for tool in git gh node npm tmux; do
  ln -s "$PREREQUISITE_PATH/present" "$PYTHON_FAILURE_PATH/$tool"
done
cat > "$PYTHON_FAILURE_PATH/python3" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$PYTHON_FAILURE_PATH/python3"

failures=''

run_case() {
  local name=$1
  shift
  local case_home="$TMP_ROOT/home-$name"
  local case_stdout="$TMP_ROOT/$name.stdout"
  local case_stderr="$TMP_ROOT/$name.stderr"
  mkdir -p "$case_home"
  : > "$RECORD"

  set +e
  HOME="$case_home" PATH="${CASE_PATH-$PATH}" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$RECORD" /bin/sh -s -- "$@" < "$INSTALL_SCRIPT" > "$case_stdout" 2> "$case_stderr"
  CASE_STATUS=$?
  set -e
  CASE_STDOUT=$(< "$case_stdout")
  CASE_STDERR=$(< "$case_stderr")
  CASE_OUTPUT="$CASE_STDOUT$CASE_STDERR"
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

CASE_PATH="$PREREQUISITE_PATH" run_case prerequisites-present
if [ "$CASE_STATUS" -eq 0 ] && [ -z "$CASE_STDOUT" ] && [ -z "$CASE_STDERR" ]; then
  echo 'PASS present prerequisites allow the bootstrap to continue quietly'
else
  failures+="present prerequisites did not continue quietly: $CASE_OUTPUT\\n"
fi

CASE_PATH="$MISSING_TOOLS_PATH" run_case missing-tools
if [ "$CASE_STATUS" -ne 0 ] \
  && [ "$(grep -c '^error:' <<< "$CASE_STDERR" || true)" -eq 1 ] \
  && grep -Eq '^error:.*tmux.*gh|^error:.*gh.*tmux' <<< "$CASE_STDERR"; then
  echo 'PASS all missing prerequisites are named in one message'
else
  failures+="missing tools were not named in one error message: $CASE_STDERR\\n"
fi
assert_untouched missing-tools

CASE_PATH="$PYTHON_FAILURE_PATH" run_case missing-pyyaml
if [ "$CASE_STATUS" -ne 0 ] && grep -Fq 'PyYAML' <<< "$CASE_OUTPUT"; then
  echo 'PASS missing PyYAML is reported'
else
  failures+="missing PyYAML was not reported: $CASE_OUTPUT\\n"
fi
assert_untouched missing-pyyaml

if [ -z "$failures" ]; then
  echo 'PASS bootstrap option parsing and prerequisites are covered'
  exit 0
fi

printf 'FAIL bootstrap option parsing and prerequisites are covered\n%b' "$failures"
exit 1
