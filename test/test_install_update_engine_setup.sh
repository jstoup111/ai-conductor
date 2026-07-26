#!/usr/bin/env bash
set -euo pipefail

# bin/install --update reconciles user-scoped harness links only. Engine
# dependencies and builds belong to bin/setup, so an update from a normal
# checkout must not invoke `npm install` or `npm run build`.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

CHECKOUT="$TMP_ROOT/plain-checkout"
HOME_DIR="$TMP_ROOT/home"
STUBS_DIR="$TMP_ROOT/stubs"
NPM_CALLS="$TMP_ROOT/npm-calls"
mkdir -p "$CHECKOUT" "$HOME_DIR" "$STUBS_DIR"

# Include the engine source so this is a regression test for the branch that
# previously attempted dependency installation during --update.
cp -r "$HARNESS_DIR/bin" "$CHECKOUT/bin"
cp -r "$HARNESS_DIR/skills" "$CHECKOUT/skills"
cp -r "$HARNESS_DIR/hooks" "$CHECKOUT/hooks"
cp -r "$HARNESS_DIR/src" "$CHECKOUT/src"
cp "$HARNESS_DIR/HARNESS.md" "$CHECKOUT/HARNESS.md"
cp "$HARNESS_DIR/VERSION" "$CHECKOUT/VERSION"
# A normal fresh checkout has no generated engine output. Its absence must not
# make --update take over bin/setup's dependency/build responsibilities.
rm -rf "$CHECKOUT/src/conductor/dist" "$CHECKOUT/src/conductor/node_modules"
# Match a normal checkout rather than a bare directory fixture; --update may
# legitimately use repository state while reconciling an installed harness.
git -C "$CHECKOUT" init -q
git -C "$CHECKOUT" config user.email test@example.invalid
git -C "$CHECKOUT" config user.name 'Install update test'
git -C "$CHECKOUT" add -A
git -C "$CHECKOUT" commit -qm fixture

cat > "$STUBS_DIR/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$NPM_CALLS"
exit 97
EOF
chmod +x "$STUBS_DIR/npm"

# Keep unrelated optional integrations hermetic. python3 remains real because
# the installer uses it to write settings.
for tool in rtk claude uv; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBS_DIR/$tool"
  chmod +x "$STUBS_DIR/$tool"
done
cat > "$STUBS_DIR/node" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  echo v20.19.2
fi
EOF
chmod +x "$STUBS_DIR/node"
PY3="$(python3 -c 'import sys; print(sys.executable)')"
ln -s "$PY3" "$STUBS_DIR/python3"

set +e
HOME="$HOME_DIR" PATH="$STUBS_DIR:$PATH" NPM_CALLS="$NPM_CALLS" \
  "$CHECKOUT/bin/install" --update < /dev/null > "$TMP_ROOT/install.out" 2>&1
CODE=$?
set -e

if [ "$CODE" -eq 0 ] && ! grep -Eq '^(install|run build)( |$)' "$NPM_CALLS" 2>/dev/null; then
  echo 'PASS --update leaves engine setup to bin/setup'
  exit 0
fi

echo 'FAIL --update leaves engine setup to bin/setup' >&2
echo "exit code: $CODE" >&2
if [ -s "$NPM_CALLS" ]; then
  echo 'unexpected npm invocation:' >&2
  cat "$NPM_CALLS" >&2
fi
cat "$TMP_ROOT/install.out" >&2
exit 1
