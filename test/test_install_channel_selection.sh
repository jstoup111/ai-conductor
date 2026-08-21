#!/usr/bin/env bash
set -euo pipefail

# test_install_channel_selection.sh — First-run explicit update-channel
# acceptance test. Runs the real installer in a disposable checkout with a
# non-TTY stdin and fakes only external command boundaries.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

CHECKOUT="$TMP_ROOT/checkout"
mkdir -p "$CHECKOUT"
cp -r "$HARNESS_DIR/bin" "$CHECKOUT/bin"
cp -r "$HARNESS_DIR/skills" "$CHECKOUT/skills"
cp -r "$HARNESS_DIR/hooks" "$CHECKOUT/hooks"
cp "$HARNESS_DIR/HARNESS.md" "$HARNESS_DIR/VERSION" "$CHECKOUT/"

STUBS="$TMP_ROOT/stubs"
mkdir -p "$STUBS"
for tool in rtk npm node claude codex uv; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBS/$tool"
  chmod +x "$STUBS/$tool"
done
PY3="$(python3 -c 'import sys; print(sys.executable)')"
ln -s "$PY3" "$STUBS/python3"

# The installer owns configuration through conduct-ts. This faithful local fake
# preserves that boundary while recording the scalar values it receives.
cat > "$STUBS/conduct-ts" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = config ] && [ "$2" = set ]; then
  if [ "${CONDUCT_TS_FAIL_SET:-}" = 1 ]; then
    exit 1
  fi
  config_dir="${HOME}/.ai-conductor"
  config_file="${config_dir}/config.yml"
  mkdir -p "$config_dir"
  if [ ! -f "$config_file" ]; then
    printf '%s\n' 'conductor:' > "$config_file"
  fi
  case "$3" in
    conductor.update_channel) key=update_channel ;;
    conductor.auto_check) key=auto_check ;;
    conductor.current_version) key=current_version ;;
    conductor.last_checked_at) key=last_checked_at ;;
    *) exit 1 ;;
  esac
  printf '  %s: %s\n' "$key" "$4" >> "$config_file"
  exit 0
fi

if [ "$1" = config ] && [ "$2" = read ]; then
  case "$3" in
    conductor.update_channel) key=update_channel ;;
    conductor.auto_check) key=auto_check ;;
    conductor.current_version) key=current_version ;;
    conductor.last_checked_at) key=last_checked_at ;;
    *) exit 1 ;;
  esac
  sed -n "s/^  ${key}: //p" "${HOME}/.ai-conductor/config.yml" | tail -n 1
  exit 0
fi

exit 1
EOF
chmod +x "$STUBS/conduct-ts"

# Each invocation begins with no harness configuration and no TTY. Explicit
# channel selection must survive the entire install and become the stored
# first-run update channel, regardless of the supported flag spelling/value.
FAILURES=''
for CHANNEL_CASE in 'separate-main:--channel main:main' 'equals-main:--channel=main:main' 'stable:--channel stable:stable' 'tagged:--channel tagged:tagged'; do
  IFS=':' read -r CASE_NAME CHANNEL_ARGS EXPECTED_CHANNEL <<< "$CHANNEL_CASE"
  CASE_HOME="$TMP_ROOT/home-$CASE_NAME"
  mkdir -p "$CASE_HOME"
  read -r -a ARGS <<< "$CHANNEL_ARGS"

  set +e
  OUT=$(cd "$CHECKOUT" && HOME="$CASE_HOME" PATH="$STUBS:$PATH" timeout 8s "$CHECKOUT/bin/install" "${ARGS[@]}" --allow-worktree-root </dev/null 2>&1)
  CODE=$?
  set -e

  if [ "$CODE" -eq 0 ] && grep -Fxq "  update_channel: $EXPECTED_CHANNEL" "$CASE_HOME/.ai-conductor/config.yml"; then
    echo "PASS first-run --channel ${CHANNEL_ARGS} records ${EXPECTED_CHANNEL} without a TTY"
  else
    FAILURES="${FAILURES}${CASE_NAME} (exit ${CODE}; expected ${EXPECTED_CHANNEL})\n${OUT}\n"
  fi
done

run_case() {
  local case_home=$1
  shift
  (cd "$CHECKOUT" && HOME="$case_home" PATH="$STUBS:$PATH" timeout 8s "$CHECKOUT/bin/install" "$@" --allow-worktree-root </dev/null 2>&1)
}

run_pty_case() {
  local case_home=$1 case_name=$2 install_args=$3 prompt_answers=${4:-'3\n1\n1\n'}
  printf '%b' "$prompt_answers" | timeout -k 1s 8s script -qec "env HOME='$case_home' PATH='$STUBS:$PATH' '$CHECKOUT/bin/install' $install_args --allow-worktree-root" \
    "$TMP_ROOT/${case_name}.log" 2>&1 || true
}

snapshot_home() {
  local case_home=$1
  (
    cd "$case_home"
    find . -mindepth 1 -printf '%y %p -> %l\n' | sort | while IFS= read -r entry; do
      path=${entry#? }
      path=${path%% -> *}
      if [ -f "$path" ] && [ ! -L "$path" ]; then
        sha256sum "$path"
      fi
    done
  )
}

ENV_HOME="$TMP_ROOT/home-env"
EMPTY_ENV_HOME="$TMP_ROOT/home-empty-env"
PRECEDENCE_HOME="$TMP_ROOT/home-precedence"
mkdir -p "$ENV_HOME" "$EMPTY_ENV_HOME" "$PRECEDENCE_HOME"
ENV_OUT=$(AI_CONDUCTOR_CHANNEL=tagged run_case "$ENV_HOME")
EMPTY_ENV_OUT=$(AI_CONDUCTOR_CHANNEL='   ' run_case "$EMPTY_ENV_HOME")
PRECEDENCE_OUT=$(AI_CONDUCTOR_CHANNEL=main run_case "$PRECEDENCE_HOME" --channel stable)
if grep -Fxq '  update_channel: tagged' "$ENV_HOME/.ai-conductor/config.yml" \
  && grep -Fq 'AI_CONDUCTOR_CHANNEL environment variable' <<< "$ENV_OUT" \
  && grep -Fxq '  update_channel: stable' "$EMPTY_ENV_HOME/.ai-conductor/config.yml" \
  && grep -Fq 'Stable was used as a fallback; choose explicitly with --channel, AI_CONDUCTOR_CHANNEL, or bin/update --set-channel.' <<< "$EMPTY_ENV_OUT" \
  && grep -Fxq '  update_channel: stable' "$PRECEDENCE_HOME/.ai-conductor/config.yml" \
  && grep -Fq -- '--channel flag' <<< "$PRECEDENCE_OUT"; then
  echo 'PASS environment fallback, whitespace fallback, and flag precedence choose the expected source'
else
  FAILURES="${FAILURES}environment precedence or source confirmation failed\n"
fi

for INVALID_CASE in 'flag:--channel bogus' 'missing:--channel' 'empty:--channel=' 'env:'; do
  IFS=':' read -r CASE_NAME INVALID_ARGS <<< "$INVALID_CASE"
  CASE_HOME="$TMP_ROOT/home-invalid-$CASE_NAME"
  mkdir -p "$CASE_HOME"
  BEFORE_SNAPSHOT=$(snapshot_home "$CASE_HOME")
  set +e
  if [ "$CASE_NAME" = env ]; then
    INVALID_OUT=$(AI_CONDUCTOR_CHANNEL=bogus run_case "$CASE_HOME")
  else
    read -r -a ARGS <<< "$INVALID_ARGS"
    INVALID_OUT=$(run_case "$CASE_HOME" "${ARGS[@]}")
  fi
  INVALID_CODE=$?
  set -e
  AFTER_SNAPSHOT=$(snapshot_home "$CASE_HOME")
  INVALID_SOURCE_OK=true
  case "$CASE_NAME" in
    flag)
      grep -Fq "Unsupported channel 'bogus' from --channel flag" <<< "$INVALID_OUT" || INVALID_SOURCE_OK=false
      ;;
    env)
      grep -Fq "Unsupported channel 'bogus' from AI_CONDUCTOR_CHANNEL environment variable" <<< "$INVALID_OUT" || INVALID_SOURCE_OK=false
      ;;
  esac
  if [ "$INVALID_CODE" -ne 0 ] && [ ! -e "$CASE_HOME/.ai-conductor/config.yml" ] \
    && [ ! -L "$CASE_HOME/.ai-conductor/config.yml" ] \
    && [ ! -e "$CASE_HOME/.claude/skills" ] && [ ! -L "$CASE_HOME/.claude/skills" ] \
    && [ "$BEFORE_SNAPSHOT" = "$AFTER_SNAPSHOT" ] \
    && [ "$INVALID_SOURCE_OK" = true ] \
    && grep -Fq 'stable, tagged, main' <<< "$INVALID_OUT"; then
    echo "PASS invalid ${CASE_NAME} channel is rejected before configuration"
  else
    FAILURES="${FAILURES}invalid ${CASE_NAME} channel was not rejected before configuration\n"
  fi
done

CONFIGURED_HOME="$TMP_ROOT/home-configured"
mkdir -p "$CONFIGURED_HOME/.ai-conductor"
printf 'conductor:\n  update_channel: main\n' > "$CONFIGURED_HOME/.ai-conductor/config.yml"
CONFIGURED_OUT=$(run_case "$CONFIGURED_HOME" --channel stable)
if grep -Fxq '  update_channel: main' "$CONFIGURED_HOME/.ai-conductor/config.yml" \
  && grep -Fq 'Ignoring --channel flag channel' <<< "$CONFIGURED_OUT" \
  && grep -Fq 'bin/update --set-channel' <<< "$CONFIGURED_OUT"; then
  echo 'PASS an existing channel is preserved and an explicit first-run choice is explained'
else
  FAILURES="${FAILURES}configured channel was overwritten or ignored silently\n"
fi

HELP_LONG=$(HOME="$TMP_ROOT/help-home" "$CHECKOUT/bin/install" --help)
HELP_SHORT=$(HOME="$TMP_ROOT/help-home" "$CHECKOUT/bin/install" -h)
if [ "$HELP_LONG" = "$HELP_SHORT" ] && grep -Fq -- '--channel' <<< "$HELP_LONG" \
  && grep -Fq 'stable, tagged, or main' <<< "$HELP_LONG" \
  && grep -Fq 'AI_CONDUCTOR_CHANNEL' <<< "$HELP_LONG"; then
  echo 'PASS help documents the channel flag and environment equivalent'
else
  FAILURES="${FAILURES}installer help does not document channel selection\n"
fi

PTY_FLAG_HOME="$TMP_ROOT/home-pty-flag"
PTY_ENV_HOME="$TMP_ROOT/home-pty-env"
PTY_INTERACTIVE_HOME="$TMP_ROOT/home-pty-interactive"
mkdir -p "$PTY_FLAG_HOME" "$PTY_ENV_HOME" "$PTY_INTERACTIVE_HOME"
PTY_FLAG_OUT=$(run_pty_case "$PTY_FLAG_HOME" pty-flag '--channel tagged')
PTY_ENV_OUT=$(AI_CONDUCTOR_CHANNEL=main run_pty_case "$PTY_ENV_HOME" pty-env '')
PTY_INTERACTIVE_OUT=$(run_pty_case "$PTY_INTERACTIVE_HOME" pty-interactive '' '3\n3\n1\n1\n')
if ! grep -Fq 'Harness update channel' <<< "$PTY_FLAG_OUT" \
  && ! grep -Fq 'Harness update channel' <<< "$PTY_ENV_OUT" \
  && grep -Fq 'Created conductor configuration (channel: tagged, source: --channel flag' <<< "$PTY_FLAG_OUT" \
  && grep -Fq 'Created conductor configuration (channel: main, source: AI_CONDUCTOR_CHANNEL environment variable' <<< "$PTY_ENV_OUT" \
  && grep -Fxq '  update_channel: tagged' "$PTY_FLAG_HOME/.ai-conductor/config.yml" \
  && grep -Fxq '  update_channel: main' "$PTY_ENV_HOME/.ai-conductor/config.yml" \
  && grep -Fq 'Harness update channel' <<< "$PTY_INTERACTIVE_OUT" \
  && grep -Fq 'Created conductor configuration (channel: main, source: interactive prompt' <<< "$PTY_INTERACTIVE_OUT" \
  && grep -Fxq '  update_channel: main' "$PTY_INTERACTIVE_HOME/.ai-conductor/config.yml"; then
  echo 'PASS explicit flag and environment channel choices suppress the TTY prompt'
else
  FAILURES="${FAILURES}explicit channel choices did not suppress the TTY prompt\n"
fi

CONFIGURED_PTY_HOME="$TMP_ROOT/home-configured-pty"
mkdir -p "$CONFIGURED_PTY_HOME/.ai-conductor"
printf 'conductor:\n  update_channel: main\n' > "$CONFIGURED_PTY_HOME/.ai-conductor/config.yml"
CONFIGURED_PTY_OUT=$(run_pty_case "$CONFIGURED_PTY_HOME" configured-pty '')
UPDATE_PTY_OUT=$(run_pty_case "$CONFIGURED_PTY_HOME" update-pty '--update')
if ! grep -Fq 'Harness update channel' <<< "$CONFIGURED_PTY_OUT" \
  && ! grep -Fq 'Harness update channel' <<< "$UPDATE_PTY_OUT" \
  && grep -Fxq '  update_channel: main' "$CONFIGURED_PTY_HOME/.ai-conductor/config.yml"; then
  echo 'PASS configured and update-mode installs never re-prompt or overwrite the channel'
else
  FAILURES="${FAILURES}configured or update-mode install re-prompted or changed the channel\n"
fi

FAILED_WRITE_HOME="$TMP_ROOT/home-failed-write"
mkdir -p "$FAILED_WRITE_HOME"
set +e
FAILED_WRITE_OUT=$(CONDUCT_TS_FAIL_SET=1 run_case "$FAILED_WRITE_HOME" --channel main)
FAILED_WRITE_CODE=$?
set -e
if [ "$FAILED_WRITE_CODE" -eq 0 ] \
  && grep -Fq 'Could not create conductor configuration' <<< "$FAILED_WRITE_OUT" \
  && ! grep -Fq 'Created conductor configuration' <<< "$FAILED_WRITE_OUT"; then
  echo 'PASS a failed channel write emits no false recorded-channel confirmation'
else
  FAILURES="${FAILURES}failed configuration write emitted false success or unexpected exit\n"
fi

if [ -z "$FAILURES" ]; then
  echo 'PASS explicit channel selection behavior is fully covered'
  exit 0
fi

echo 'FAIL explicit channel selection behavior is fully covered'
printf '%b' "$FAILURES"
exit 1
