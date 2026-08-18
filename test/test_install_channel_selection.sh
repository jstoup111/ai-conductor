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

if [ -z "$FAILURES" ]; then
  echo 'PASS explicit --channel selection is preserved on every non-interactive first run'
  exit 0
fi

echo 'FAIL explicit --channel selection is preserved on every non-interactive first run'
printf '%b' "$FAILURES"
exit 1
