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
printf '%s\n' 'configure_permissions "$1" || exit $?' >> "$PERMISSIONS_FRAGMENT"
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

# A malformed settings file must surface the Python write failure, clean its
# temporary permission list, and let install's caller guard report the failure.
PERMISSIONS_BAD_SETTINGS="$TMP_ROOT/permissions-bad-settings.json"
PERMISSIONS_BAD_TMP="$TMP_ROOT/permissions-bad-tmp"
mkdir -p "$PERMISSIONS_BAD_TMP"
printf '%s\n' '{ malformed json' > "$PERMISSIONS_BAD_SETTINGS"

set +e
TMPDIR="$PERMISSIONS_BAD_TMP" PATH="$STUBS_DIR:$PATH" \
  "$PERMISSIONS_FRAGMENT" "$PERMISSIONS_BAD_SETTINGS" > "$TMP_ROOT/permissions-bad.out" 2>&1
permissions_bad_code=$?
set -e

PERMISSIONS_BAD_HOME="$TMP_ROOT/permissions-bad-home"
mkdir -p "$PERMISSIONS_BAD_HOME/.claude"
cp "$PERMISSIONS_BAD_SETTINGS" "$PERMISSIONS_BAD_HOME/.claude/settings.json"
set +e
HOME="$PERMISSIONS_BAD_HOME" PATH="$STUBS_DIR:$PATH" NPM_CALLS="$NPM_CALLS" \
  "$CHECKOUT/bin/install" --update < /dev/null > "$TMP_ROOT/permissions-caller.out" 2>&1
permissions_caller_code=$?
set -e

if [ "$permissions_bad_code" -ne 0 ] && \
  rg -q 'Could not configure permissions automatically' "$TMP_ROOT/permissions-bad.out" && \
  rg -q "Manually add harness read permissions to ${PERMISSIONS_BAD_SETTINGS}" "$TMP_ROOT/permissions-bad.out" && \
  [ -z "$(find "$PERMISSIONS_BAD_TMP" -mindepth 1 -print -quit)" ] && \
  rg -q 'Permissions configuration incomplete — continuing' "$TMP_ROOT/permissions-caller.out"; then
  echo 'PASS configure_permissions surfaces failures to its caller and cleans up'
else
  echo 'FAIL configure_permissions surfaces failures to its caller and cleans up' >&2
  echo "direct exit code: $permissions_bad_code; caller exit code: $permissions_caller_code" >&2
  cat "$TMP_ROOT/permissions-bad.out" "$TMP_ROOT/permissions-caller.out" >&2
  exit 1
fi

# The viewer/renderer prompts delegate their persisted selections to conduct-ts.
# This faithful fake records the CLI contract and renders the sections so the
# installer boundary can assert the observable config result without a real bundle.
CONFIG_STUB_HOME="$TMP_ROOT/config-stub-home"
CONFIG_WRITE_CALLS="$TMP_ROOT/config-write-calls"
CONFIG_FRAGMENT="$CHECKOUT/bin/install-config-test"
mkdir -p "$CONFIG_STUB_HOME"
cat > "$STUBS_DIR/conduct-ts" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$CONFIG_WRITE_CALLS"
section=$3
mkdir -p "$HOME/.ai-conductor"
printf '%s:\n  preset: %s\n  command: %s\n  args: [%s]\n  mode: %s\n' \
  "$section" "$4" "$5" "$6" "$7" >> "$HOME/.ai-conductor/config.yml"
EOF
chmod +x "$STUBS_DIR/conduct-ts"

awk '/# ─── Main ─────────────────────────────────────────────────────────────────────/{exit} {print}' \
  "$CHECKOUT/bin/install" > "$CONFIG_FRAGMENT"
printf '%s\n' 'write_md_viewer_config "glow" "glow" "-p {file}" "inline"' >> "$CONFIG_FRAGMENT"
printf '%s\n' 'write_mermaid_renderer_config "mmdc-png" "mmdc" "-i {file}" "external"' >> "$CONFIG_FRAGMENT"
chmod +x "$CONFIG_FRAGMENT"

HOME="$CONFIG_STUB_HOME" PATH="$STUBS_DIR:$PATH" CONFIG_WRITE_CALLS="$CONFIG_WRITE_CALLS" \
  "$CONFIG_FRAGMENT"

if [ "$(cat "$CONFIG_WRITE_CALLS")" = $'config write markdown_viewer glow glow -p {file} inline\nconfig write mermaid_renderer mmdc-png mmdc -i {file} external' ] && \
  rg -Uq 'markdown_viewer:\n  preset: glow\n  command: glow\n  args: \[-p \{file\}\]\n  mode: inline' "$CONFIG_STUB_HOME/.ai-conductor/config.yml" && \
  rg -Uq 'mermaid_renderer:\n  preset: mmdc-png\n  command: mmdc\n  args: \[-i \{file\}\]\n  mode: external' "$CONFIG_STUB_HOME/.ai-conductor/config.yml"; then
  echo 'PASS viewer and renderer configuration delegate to conduct-ts'
else
  echo 'FAIL viewer and renderer configuration delegate to conduct-ts' >&2
  cat "$CONFIG_WRITE_CALLS" "$CONFIG_STUB_HOME/.ai-conductor/config.yml" >&2 || true
  exit 1
fi

# A missing conduct-ts must be reported before either interactive prompt tries
# to write configuration, rather than surfacing the generic incomplete warning.
NO_CONDUCT_HOME="$TMP_ROOT/no-conduct-home"
NO_CONDUCT_PATH="$TMP_ROOT/no-conduct-path"
mkdir -p "$NO_CONDUCT_HOME" "$NO_CONDUCT_PATH"

run_missing_conduct_config() {
  local function_name=$1
  local fragment="$CHECKOUT/bin/install-${function_name}-missing-conduct-test"
  awk '/# ─── Main ─────────────────────────────────────────────────────────────────────/{exit} {print}' \
    "$CHECKOUT/bin/install" > "$fragment"
  printf '%s\n' "$function_name" >> "$fragment"
  chmod +x "$fragment"

  set +e
  printf '\n' | HOME="$NO_CONDUCT_HOME" PATH="$NO_CONDUCT_PATH:/usr/bin:/bin" \
    script -qefc "$fragment" /dev/null > "$TMP_ROOT/${function_name}.out" 2>&1
  local code=$?
  set -e
  printf '%s\n' "$code"
}

md_missing_code=$(run_missing_conduct_config configure_md_viewer)
mermaid_missing_code=$(run_missing_conduct_config configure_mermaid_renderer)
if [ "$md_missing_code" -eq 0 ] && [ "$mermaid_missing_code" -eq 0 ] && \
  rg -q 'conduct-ts.*re-run bin/install' "$TMP_ROOT/configure_md_viewer.out" && \
  rg -q 'conduct-ts.*re-run bin/install' "$TMP_ROOT/configure_mermaid_renderer.out" && \
  ! rg -q 'configuration incomplete — continuing' "$TMP_ROOT/configure_md_viewer.out" "$TMP_ROOT/configure_mermaid_renderer.out" && \
  ! rg -q 'Markdown viewer:|Mermaid renderer:' "$TMP_ROOT/configure_md_viewer.out" "$TMP_ROOT/configure_mermaid_renderer.out"; then
  echo 'PASS missing conduct-ts names the write prerequisite without reporting success'
else
  echo 'FAIL missing conduct-ts names the write prerequisite without reporting success' >&2
  cat "$TMP_ROOT/configure_md_viewer.out" "$TMP_ROOT/configure_mermaid_renderer.out" >&2
  exit 1
fi
