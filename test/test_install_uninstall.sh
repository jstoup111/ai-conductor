#!/usr/bin/env bash
# Covers: task:1
#
# Public-entry-point RED coverage for uninstalling the settings entries written
# by bin/install.  Every invocation uses a throwaway HOME and a copied harness
# checkout; the only real dependency exposed on PATH is python3, needed by the
# installer's local JSON configuration routines.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

CHECKOUT="$TMP_ROOT/checkout"
STUBS="$TMP_ROOT/stubs"
TEMPLATE_HOME="$TMP_ROOT/template-home"
PYTHON3="$(python3 -c 'import sys; print(sys.executable)')"
PASS=0
FAIL=0

pass() { printf 'PASS %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL %s\n' "$1"; FAIL=$((FAIL + 1)); }
check() {
  local description=$1
  shift
  if "$@"; then pass "$description"; else fail "$description"; fi
}

mkdir -p "$CHECKOUT" "$STUBS"
cp -R "$HARNESS_DIR/bin" "$HARNESS_DIR/skills" "$HARNESS_DIR/hooks" "$CHECKOUT/"
cp "$HARNESS_DIR/HARNESS.md" "$HARNESS_DIR/ARCHITECTURE.md" "$HARNESS_DIR/VERSION" "$CHECKOUT/"
mkdir -p "$CHECKOUT/src/conductor/dist"
: > "$CHECKOUT/src/conductor/dist/index.js"
for tool in rtk npm node claude codex uv; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$STUBS/$tool"
  chmod +x "$STUBS/$tool"
done
ln -s "$PYTHON3" "$STUBS/python3"

run_install() {
  local home=$1 output=$2
  shift 2
  mkdir -p "$home"
  (
    cd "$CHECKOUT" || exit 1
    HOME="$home" PATH="$STUBS:/usr/bin:/bin" \
      timeout 15s "$CHECKOUT/bin/install" "$@" --allow-worktree-root </dev/null
  ) >"$output" 2>&1
}

run_uninstall() {
  local home=$1 output=$2
  run_install "$home" "$output" --uninstall
}

make_case_home() {
  local home=$1
  mkdir -p "$home"
  cp -R "$TEMPLATE_HOME/." "$home/"
}

settings_file() { printf '%s/.claude/settings.json' "$1"; }

expect_removal_report() {
  local home=$1 output=$2 hooks=$3 permissions=$4
  grep -Fq "Settings: removed ${hooks} harness hook commands and ${permissions} permissions from $(settings_file "$home")" "$output"
}

assert_case_a() {
  "$PYTHON3" - "$(settings_file "$1")" "$CHECKOUT" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
commands = [h.get('command', '') for entries in settings.get('hooks', {}).values()
            for entry in entries for h in entry.get('hooks', [])]
assert not any(c.startswith(sys.argv[2] + '/hooks/claude/') for c in commands)
assert '/opt/mine/hook.sh' in commands
assert 'Bash(make:*)' in settings['permissions']['allow']
assert settings['theme'] == 'dark'
PY
}

assert_case_b() {
  "$PYTHON3" - "$(settings_file "$1")" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
assert 'hooks' not in settings
assert 'permissions' not in settings
PY
}

assert_case_c() {
  "$PYTHON3" - "$(settings_file "$1")" "$CHECKOUT" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
groups = settings['hooks']['PreToolUse']
group = next(g for g in groups if any(h.get('command') == '/opt/mine/same-group.sh' for h in g['hooks']))
assert group['matcher'] == 'Bash'
assert [h['command'] for h in group['hooks']] == ['/opt/mine/same-group.sh']
assert not any(h.get('command', '').startswith(sys.argv[2] + '/hooks/claude/')
               for g in groups for h in g['hooks'])
PY
}

assert_case_d() {
  "$PYTHON3" - "$(settings_file "$1")" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
commands = [h.get('command') for entries in settings.get('hooks', {}).values()
            for entry in entries for h in entry.get('hooks', [])]
assert '/elsewhere/hooks/claude/docs-guard.sh' in commands
assert 'Read(/elsewhere/**)' in settings['permissions']['allow']
PY
}

assert_case_e() {
  "$PYTHON3" - "$(settings_file "$1")" <<'PY'
import json, sys
settings = json.load(open(sys.argv[1]))
assert settings['hooks'] == {}
assert settings['permissions']['allow'] == []
PY
}

# Seed all owned entries through the real installer, rather than duplicating its
# permission or hook catalog in this test.  The stubbed build boundary can make
# default install non-zero; its settings output is still the fixture authority.
run_install "$TEMPLATE_HOME" "$TMP_ROOT/template-install.out" --providers claude,codex || true

# A: mixed independent operator groups and settings keys survive.
CASE_A="$TMP_ROOT/case-a"
make_case_home "$CASE_A"
"$PYTHON3" - "$(settings_file "$CASE_A")" <<'PY'
import json, sys
path = sys.argv[1]; settings = json.load(open(path))
settings['theme'] = 'dark'
settings['permissions']['allow'].append('Bash(make:*)')
settings['hooks']['PreToolUse'].append({'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': '/opt/mine/hook.sh'}]})
with open(path, 'w') as f: json.dump(settings, f, indent=2); f.write('\n')
PY
run_uninstall "$CASE_A" "$TMP_ROOT/case-a.out" || true
check 'A removes owned settings entries and preserves independent operator state' assert_case_a "$CASE_A"
check 'A reports all removed owned hook commands and permissions' expect_removal_report "$CASE_A" "$TMP_ROOT/case-a.out" 10 18

# B: owned-only containers disappear rather than remaining as empty objects.
CASE_B="$TMP_ROOT/case-b"
make_case_home "$CASE_B"
run_uninstall "$CASE_B" "$TMP_ROOT/case-b.out" || true
check 'B prunes owned-only hooks and permissions containers' assert_case_b "$CASE_B"
check 'B reports all removed owned hook commands and permissions' expect_removal_report "$CASE_B" "$TMP_ROOT/case-b.out" 10 18

# C: removal is command-level, retaining the matcher and its operator command.
CASE_C="$TMP_ROOT/case-c"
make_case_home "$CASE_C"
"$PYTHON3" - "$(settings_file "$CASE_C")" "$CHECKOUT" <<'PY'
import json, sys
path, checkout = sys.argv[1:3]; settings = json.load(open(path))
owned = checkout + '/hooks/claude/block-destructive-git.sh'
group = next(g for g in settings['hooks']['PreToolUse'] if any(h.get('command') == owned for h in g['hooks']))
group['hooks'].append({'type': 'command', 'command': '/opt/mine/same-group.sh', 'timeout': 5})
with open(path, 'w') as f: json.dump(settings, f, indent=2); f.write('\n')
PY
run_uninstall "$CASE_C" "$TMP_ROOT/case-c.out" || true
check 'C retains the mixed matcher group with only its operator command' assert_case_c "$CASE_C"
check 'C reports command-level owned removal' expect_removal_report "$CASE_C" "$TMP_ROOT/case-c.out" 10 18

# D: matching directory words are not ownership; only this checkout prefix is.
CASE_D="$TMP_ROOT/case-d"
make_case_home "$CASE_D"
"$PYTHON3" - "$(settings_file "$CASE_D")" <<'PY'
import json, sys
path = sys.argv[1]; settings = json.load(open(path))
settings['hooks']['PreToolUse'].append({'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': '/elsewhere/hooks/claude/docs-guard.sh'}]})
settings['permissions']['allow'].append('Read(/elsewhere/**)')
with open(path, 'w') as f: json.dump(settings, f, indent=2); f.write('\n')
PY
run_uninstall "$CASE_D" "$TMP_ROOT/case-d.out" || true
check 'D preserves prefix-lookalike hook and permission entries' assert_case_d "$CASE_D"
check 'D reports only exact owned settings removal' expect_removal_report "$CASE_D" "$TMP_ROOT/case-d.out" 10 18

# E: empty containers authored before any harness install must not be pruned.
CASE_E="$TMP_ROOT/case-e"
mkdir -p "$CASE_E/.claude"
printf '{\n  "hooks": {},\n  "permissions": {"allow": []}\n}\n' > "$(settings_file "$CASE_E")"
run_uninstall "$CASE_E" "$TMP_ROOT/case-e.out" || true
check 'E preserves pre-existing empty hooks and permissions containers' assert_case_e "$CASE_E"
check 'E reports zero removed settings entries' expect_removal_report "$CASE_E" "$TMP_ROOT/case-e.out" 0 0

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
