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
  exit 0
fi

echo 'FAIL interactive install offers Claude, Codex, and both choices'
printf '%s\n' "$OUT"
exit 1
