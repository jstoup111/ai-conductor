#!/usr/bin/env bash
set -euo pipefail

# Both fresh installs and --update must rebuild the engine with a clean,
# lockfile-faithful dependency install. A corrupted node_modules directory must
# be replaced by `npm ci`, then the generated engine must be rebuilt.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

STUBS_DIR="$TMP_ROOT/stubs"
mkdir -p "$STUBS_DIR"

cat > "$STUBS_DIR/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  ci)
    printf '%s\n' "$*" >> "$NPM_CALLS"
    rm -rf node_modules
    mkdir -p node_modules
    ;;
  'run build')
    printf '%s\n' "$*" >> "$NPM_CALLS"
    ;;
  list*)
    ;;
  install*)
    printf '%s\n' "$*" >> "$NPM_CALLS"
    exit 97
    ;;
  *)
    exit 98
    ;;
esac
EOF
chmod +x "$STUBS_DIR/npm"

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

prepare_checkout() {
  local label=$1
  CHECKOUT="$TMP_ROOT/${label}-checkout"
  HOME_DIR="$TMP_ROOT/${label}-home"
  NPM_CALLS="$TMP_ROOT/${label}-npm-calls"
  CORRUPTION_SENTINEL="$CHECKOUT/src/conductor/node_modules/corrupted-dependency"

  mkdir -p "$CHECKOUT" "$HOME_DIR"
  cp -r "$HARNESS_DIR/bin" "$CHECKOUT/bin"
  cp -r "$HARNESS_DIR/skills" "$CHECKOUT/skills"
  cp -r "$HARNESS_DIR/hooks" "$CHECKOUT/hooks"
  cp -r "$HARNESS_DIR/src" "$CHECKOUT/src"
  cp "$HARNESS_DIR/HARNESS.md" "$CHECKOUT/HARNESS.md"
  cp "$HARNESS_DIR/VERSION" "$CHECKOUT/VERSION"

  mkdir -p "$(dirname "$CORRUPTION_SENTINEL")"
  touch "$CORRUPTION_SENTINEL"

  git -C "$CHECKOUT" init -q
  git -C "$CHECKOUT" config user.email test@example.invalid
  git -C "$CHECKOUT" config user.name 'Install update test'
  git -C "$CHECKOUT" add -A
  git -C "$CHECKOUT" commit -qm fixture
}

run_install() {
  local label=$1
  shift

  prepare_checkout "$label"
  : > "$NPM_CALLS"

  set +e
  HOME="$HOME_DIR" PATH="$STUBS_DIR:$PATH" NPM_CALLS="$NPM_CALLS" \
    "$CHECKOUT/bin/install" "$@" < /dev/null > "$TMP_ROOT/install-${label}.out" 2>&1
  local code=$?
  set -e

  if [ "$code" -eq 0 ] && [ "$(cat "$NPM_CALLS" 2>/dev/null || true)" = $'ci\nrun build' ] && [ ! -e "$CORRUPTION_SENTINEL" ]; then
    echo "PASS ${label} rebuilds with npm ci before npm run build"
    return 0
  fi

  echo "FAIL ${label} rebuilds with npm ci before npm run build" >&2
  echo "exit code: $code" >&2
  echo 'npm invocations:' >&2
  cat "$NPM_CALLS" 2>/dev/null >&2 || true
  if [ -e "$CORRUPTION_SENTINEL" ]; then
    echo "corruption sentinel remains after ${label}" >&2
  fi
  cat "$TMP_ROOT/install-${label}.out" >&2
  return 1
}

run_install update --update
run_install fresh

# Exercise configure_permissions directly so this regression remains focused on
# the write/cleanup boundary rather than the rest of a full installation.
PERMISSIONS_SETTINGS="$TMP_ROOT/permissions-settings.json"
PERMISSIONS_TMP="$TMP_ROOT/permissions-tmp"
PERMISSIONS_FRAGMENT="$CHECKOUT/bin/install-permissions-test"
mkdir -p "$PERMISSIONS_TMP"
printf '%s\n' '{"permissions":{"allow":[]}}' > "$PERMISSIONS_SETTINGS"

# Keep the installer setup and function definitions, but omit its mode
# dispatch; append one direct call to the function under test.
awk '/# ─── Main ─────────────────────────────────────────────────────────────────────/{exit} {print}' \
  "$CHECKOUT/bin/install" > "$PERMISSIONS_FRAGMENT"
printf '%s\n' 'configure_permissions "$1"' >> "$PERMISSIONS_FRAGMENT"
chmod +x "$PERMISSIONS_FRAGMENT"

set +e
TMPDIR="$PERMISSIONS_TMP" PATH="$STUBS_DIR:$PATH" \
  "$PERMISSIONS_FRAGMENT" "$PERMISSIONS_SETTINGS" > "$TMP_ROOT/permissions.out" 2>&1
permissions_code=$?
set -e

if [ "$permissions_code" -eq 0 ] && \
  rg -q '8 added, 0 already set' "$TMP_ROOT/permissions.out" && \
  python3 - "$PERMISSIONS_SETTINGS" <<'PYEOF' && \
  [ -z "$(find "$PERMISSIONS_TMP" -mindepth 1 -print -quit)" ]; then
import json
import sys

with open(sys.argv[1]) as settings_file:
    permissions = json.load(settings_file)["permissions"]["allow"]

assert "Bash(git status:*)" in permissions
assert "Bash(git checkout -b:*)" in permissions
PYEOF
  echo 'PASS configure_permissions reports and persists a successful permission write'
else
  echo 'FAIL configure_permissions reports and persists a successful permission write' >&2
  echo "exit code: $permissions_code" >&2
  cat "$TMP_ROOT/permissions.out" >&2
  exit 1
fi
