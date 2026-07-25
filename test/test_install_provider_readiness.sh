#!/usr/bin/env bash
set -euo pipefail

# test_install_provider_readiness.sh — Interactive install provider-selection
# acceptance test for #901. Runs the real installer in a disposable checkout
# with a pseudo-TTY so the prompt is observable without touching operator state.

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

FAKE_HOME="$TMP_ROOT/home"
STUBS="$TMP_ROOT/stubs"
mkdir -p "$FAKE_HOME" "$STUBS"
for tool in rtk npm node claude codex uv; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBS/$tool"
  chmod +x "$STUBS/$tool"
done
PY3="$(python3 -c 'import sys; print(sys.executable)')"
ln -s "$PY3" "$STUBS/python3"

# `script` supplies a true TTY; the answer is intentionally harmless until
# provider selection is implemented, at which point it chooses Claude.
set +e
# The test needs only the first interactive question. Bound the real installer
# so unrelated setup work cannot make this RED assertion hang.
OUT=$(cd "$CHECKOUT" && printf '1\n' | HOME="$FAKE_HOME" PATH="$STUBS:$PATH" timeout 8s script -qec "$CHECKOUT/bin/install --allow-worktree-root" "$TMP_ROOT/install.log" 2>&1)
CODE=$?
set -e

# One behavior, one assertion: the interactive prompt makes all built-in
# readiness choices visible before setup continues.
if printf '%s' "$OUT" | tr '\n' ' ' | grep -qiE 'claude.*codex.*both'; then
  echo 'PASS interactive install offers Claude, Codex, and both choices'
else
  echo 'FAIL interactive install offers Claude, Codex, and both choices'
  printf '%s\n' "$OUT"
  exit 1
fi

# One behavior, one assertion: unsupported explicit selection is rejected
# synchronously, before installation can continue into setup or readiness.
set +e
UNSUPPORTED_OUT=$(cd "$CHECKOUT" && HOME="$FAKE_HOME" PATH="$STUBS:$PATH" timeout 8s script -qec "$CHECKOUT/bin/install --providers unsupported --allow-worktree-root" "$TMP_ROOT/unsupported.log" 2>&1)
UNSUPPORTED_CODE=$?
set -e

if [ "$UNSUPPORTED_CODE" -ne 0 ] \
  && [ "$UNSUPPORTED_CODE" -ne 124 ] \
  && printf '%s' "$UNSUPPORTED_OUT" | grep -qi 'claude' \
  && printf '%s' "$UNSUPPORTED_OUT" | grep -qi 'codex'; then
  echo 'PASS unsupported provider selection names Claude and Codex before setup'
else
  echo 'FAIL unsupported provider selection names Claude and Codex before setup'
  printf 'exit code: %s\n' "$UNSUPPORTED_CODE"
  printf '%s\n' "$UNSUPPORTED_OUT"
  exit 1
fi

# A normal scripted install must still finish when a selected built-in CLI is
# absent, while making the Codex-specific remedy visible to the operator.
MISSING_CODEX_STUBS="$TMP_ROOT/stubs-without-codex"
mkdir -p "$MISSING_CODEX_STUBS"
for tool in rtk npm node claude uv python3; do
  ln -s "$STUBS/$tool" "$MISSING_CODEX_STUBS/$tool"
done

set +e
MISSING_CODEX_OUT=$(cd "$CHECKOUT" && HOME="$FAKE_HOME" PATH="$MISSING_CODEX_STUBS:/usr/bin:/bin" timeout 8s "$CHECKOUT/bin/install" --providers codex --allow-worktree-root </dev/null 2>&1)
MISSING_CODEX_CODE=$?
set -e

if [ "$MISSING_CODEX_CODE" -eq 0 ] \
  && printf '%s' "$MISSING_CODEX_OUT" | grep -qiE 'codex.*(not found|missing|not installed)' \
  && printf '%s' "$MISSING_CODEX_OUT" | grep -qi 'install'; then
  echo 'PASS missing selected Codex CLI warns with an actionable remedy without blocking install'
else
  echo 'FAIL missing selected Codex CLI warns with an actionable remedy without blocking install'
  printf 'exit code: %s\n' "$MISSING_CODEX_CODE"
  printf '%s\n' "$MISSING_CODEX_OUT"
  exit 1
fi

# A Codex-only installation retains the shared conduct surface and installs
# both built-in provider skill and harness surfaces, even without the Codex CLI.
if [ -L "$FAKE_HOME/.local/bin/conduct" ] \
  && [ -f "$FAKE_HOME/.claude/skills/conduct/SKILL.md" ] \
  && [ -f "$FAKE_HOME/.claude/skills/HARNESS.md" ] \
  && [ -f "$FAKE_HOME/.codex/skills/conduct/SKILL.md" ] \
  && [ -f "$FAKE_HOME/.codex/skills/HARNESS.md" ]; then
  echo 'PASS Codex installation preserves common, Claude, and Codex surfaces without the Codex CLI'
else
  echo 'FAIL Codex installation preserves common, Claude, and Codex surfaces without the Codex CLI'
  exit 1
fi

# The normal install above has established both provider surfaces. Its strict
# readiness counterpart must still fail specifically for the selected, absent
# Codex CLI; stub the common conduct-ts check so it cannot mask that condition.
mkdir -p "$FAKE_HOME/.local/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_HOME/.local/bin/conduct-ts"
chmod +x "$FAKE_HOME/.local/bin/conduct-ts"

# With all installed surfaces, both provider CLIs, and the common check
# available, strict readiness accepts every supported required-provider set.
STRICT_READY_MATRIX_OK=true
for REQUIRED_PROVIDERS in claude codex claude,codex; do
  set +e
  STRICT_READY_MATRIX_OUT=$(cd "$CHECKOUT" && HOME="$FAKE_HOME" PATH="$STUBS:$FAKE_HOME/.local/bin:/usr/bin:/bin" timeout 8s "$CHECKOUT/bin/install" --check --providers "$REQUIRED_PROVIDERS" --allow-worktree-root 2>&1)
  STRICT_READY_MATRIX_CODE=$?
  set -e

  if [ "$STRICT_READY_MATRIX_CODE" -ne 0 ]; then
    STRICT_READY_MATRIX_OK=false
    break
  fi
done

if [ "$STRICT_READY_MATRIX_OK" = true ]; then
  echo 'PASS strict readiness succeeds for Claude, Codex, and both required-provider selections when ready'
else
  echo 'FAIL strict readiness succeeds for Claude, Codex, and both required-provider selections when ready'
  printf 'providers: %s; exit code: %s\n' "$REQUIRED_PROVIDERS" "$STRICT_READY_MATRIX_CODE"
  printf '%s\n' "$STRICT_READY_MATRIX_OUT"
  exit 1
fi

set +e
MISSING_CODEX_CHECK_OUT=$(cd "$CHECKOUT" && HOME="$FAKE_HOME" PATH="$MISSING_CODEX_STUBS:$FAKE_HOME/.local/bin:/usr/bin:/bin" timeout 8s "$CHECKOUT/bin/install" --check --providers codex --allow-worktree-root 2>&1)
MISSING_CODEX_CHECK_CODE=$?
set -e

if [ "$MISSING_CODEX_CHECK_CODE" -ne 0 ] \
  && printf '%s' "$MISSING_CODEX_CHECK_OUT" | grep -qiE 'codex.*(not found|missing|not installed)'; then
  echo 'PASS strict Codex readiness fails when the selected Codex CLI is absent'
else
  echo 'FAIL strict Codex readiness fails when the selected Codex CLI is absent'
  printf 'exit code: %s\n' "$MISSING_CODEX_CHECK_CODE"
  printf '%s\n' "$MISSING_CODEX_CHECK_OUT"
  exit 1
fi

# Every non-interactive provider selection, including the implicit default,
# establishes the common conduct command and both client skill surfaces.
INSTALL_SURFACE_MATRIX_FAILURE=''
for INSTALL_SELECTION in claude codex claude,codex omitted; do
  INSTALL_SURFACE_HOME="$TMP_ROOT/install-surface-$INSTALL_SELECTION"
  mkdir -p "$INSTALL_SURFACE_HOME"

  case "$INSTALL_SELECTION" in
    omitted) INSTALL_SURFACE_ARGS=(--allow-worktree-root) ;;
    *) INSTALL_SURFACE_ARGS=(--providers "$INSTALL_SELECTION" --allow-worktree-root) ;;
  esac

  set +e
  INSTALL_SURFACE_OUT=$(cd "$CHECKOUT" && HOME="$INSTALL_SURFACE_HOME" PATH="$STUBS:$PATH" timeout 8s "$CHECKOUT/bin/install" "${INSTALL_SURFACE_ARGS[@]}" </dev/null 2>&1)
  INSTALL_SURFACE_CODE=$?
  set -e

  ( [ "$INSTALL_SURFACE_CODE" -eq 0 ] \
    && [ -L "$INSTALL_SURFACE_HOME/.local/bin/conduct" ] \
    && [ -f "$INSTALL_SURFACE_HOME/.claude/skills/conduct/SKILL.md" ] \
    && [ -f "$INSTALL_SURFACE_HOME/.claude/skills/HARNESS.md" ] \
    && [ -f "$INSTALL_SURFACE_HOME/.codex/skills/conduct/SKILL.md" ] \
    && [ -f "$INSTALL_SURFACE_HOME/.codex/skills/HARNESS.md" ] ) || {
      INSTALL_SURFACE_MATRIX_FAILURE="$INSTALL_SELECTION (exit $INSTALL_SURFACE_CODE)"
      INSTALL_SURFACE_MATRIX_OUT="$INSTALL_SURFACE_OUT"
    }
done

if [ -z "$INSTALL_SURFACE_MATRIX_FAILURE" ]; then
  echo 'PASS non-interactive install establishes common, Claude, and Codex surfaces for every provider selection'
else
  echo 'FAIL non-interactive install establishes common, Claude, and Codex surfaces for every provider selection'
  printf 'selection: %s\n' "$INSTALL_SURFACE_MATRIX_FAILURE"
  printf '%s\n' "$INSTALL_SURFACE_MATRIX_OUT"
  exit 1
fi

# A trailing comma denotes an empty provider token and must be rejected before
# the installer reaches any setup action.
set +e
TRAILING_COMMA_OUT=$(cd "$CHECKOUT" && HOME="$FAKE_HOME" PATH="$STUBS:$PATH" timeout 8s script -qec "$CHECKOUT/bin/install --providers claude, --allow-worktree-root" "$TMP_ROOT/trailing-comma.log" 2>&1)
TRAILING_COMMA_CODE=$?
set -e

if [ "$TRAILING_COMMA_CODE" -ne 0 ] \
  && [ "$TRAILING_COMMA_CODE" -ne 124 ] \
  && printf '%s' "$TRAILING_COMMA_OUT" | grep -qi 'claude' \
  && printf '%s' "$TRAILING_COMMA_OUT" | grep -qi 'codex'; then
  echo 'PASS trailing-comma provider selection names Claude and Codex before setup'
  exit 0
fi

echo 'FAIL trailing-comma provider selection names Claude and Codex before setup'
printf 'exit code: %s\n' "$TRAILING_COMMA_CODE"
printf '%s\n' "$TRAILING_COMMA_OUT"
exit 1
