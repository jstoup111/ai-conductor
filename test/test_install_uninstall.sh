#!/usr/bin/env bash
# Covers: task:1, task:2, task:4, task:5
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
mkdir -p "$CHECKOUT/.ai-conductor"
cp "$HARNESS_DIR/.ai-conductor/rate-card.json" "$CHECKOUT/.ai-conductor/"
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
rate_card_file() { printf '%s/.ai-conductor/rate-card.json' "$1"; }

expect_removal_report() {
  local home=$1 output=$2 hooks=$3 permissions=$4
  grep -Fq "Settings: removed ${hooks} harness hook commands and ${permissions} permissions from $(settings_file "$home")" "$output"
}

has_no_kept_line() {
  ! grep -Fq 'Kept ' "$1"
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
cp "$(settings_file "$CASE_B")" "$TMP_ROOT/case-b-after-first-uninstall.json"
run_uninstall "$CASE_B" "$TMP_ROOT/case-b-second.out"
CASE_B_SECOND_EXIT=$?
check 'B second uninstall exits successfully after all owned entries are removed' test "$CASE_B_SECOND_EXIT" -eq 0
check 'B second uninstall reports that no harness settings entries remain' \
  grep -Fq "Settings: no harness settings entries found to remove in $(settings_file "$CASE_B")" "$TMP_ROOT/case-b-second.out"
check 'B second uninstall leaves settings byte-identical' \
  cmp -s "$(settings_file "$CASE_B")" "$TMP_ROOT/case-b-after-first-uninstall.json"

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
check 'E reports that no harness settings entries remain' \
  grep -Fq "Settings: no harness settings entries found to remove in $(settings_file "$CASE_E")" "$TMP_ROOT/case-e.out"

# F: uninstalling without a settings file is successful and does not create one.
CASE_F="$TMP_ROOT/case-f"
mkdir -p "$CASE_F"
run_uninstall "$CASE_F" "$TMP_ROOT/case-f.out"
CASE_F_EXIT=$?
check 'F uninstall exits successfully when settings are absent' test "$CASE_F_EXIT" -eq 0
check 'F uninstall does not create an absent settings file' test ! -e "$(settings_file "$CASE_F")"
check 'F reports that the settings file was not found' \
  grep -Fq "Settings: no settings entries to remove ($(settings_file "$CASE_F") not found)" "$TMP_ROOT/case-f.out"

# R1: uninstall removes only the rate-card symlink this checkout installed.
CASE_R1="$TMP_ROOT/case-r1"
make_case_home "$CASE_R1"
run_uninstall "$CASE_R1" "$TMP_ROOT/case-r1.out" || true
check 'R1 removes the harness global rate-card link' \
  test ! -e "$(rate_card_file "$CASE_R1")" -a ! -L "$(rate_card_file "$CASE_R1")"
check 'R1 reports removal of the harness global rate-card link' \
  grep -Fq "Removed global rate card link $(rate_card_file "$CASE_R1")" "$TMP_ROOT/case-r1.out"

# R2: an operator-owned regular file is not a harness link and stays byte-identical.
CASE_R2="$TMP_ROOT/case-r2"
make_case_home "$CASE_R2"
rm "$(rate_card_file "$CASE_R2")"
printf '{"operator":"rate-card"}\n' > "$(rate_card_file "$CASE_R2")"
cp "$(rate_card_file "$CASE_R2")" "$TMP_ROOT/case-r2-before.json"
run_uninstall "$CASE_R2" "$TMP_ROOT/case-r2.out" || true
check 'R2 preserves an operator-owned global rate-card file byte-identically' \
  cmp -s "$(rate_card_file "$CASE_R2")" "$TMP_ROOT/case-r2-before.json"
check 'R2 warns that a regular global rate card is not a harness link' \
  grep -Fq "Global rate card $(rate_card_file "$CASE_R2") is not a harness link" "$TMP_ROOT/case-r2.out"

# R3: a symlink owned by another checkout remains untouched.
CASE_R3="$TMP_ROOT/case-r3"
make_case_home "$CASE_R3"
rm "$(rate_card_file "$CASE_R3")"
ln -s /elsewhere/rate-card.json "$(rate_card_file "$CASE_R3")"
run_uninstall "$CASE_R3" "$TMP_ROOT/case-r3.out" || true
check 'R3 preserves a foreign global rate-card symlink' \
  test "$(readlink "$(rate_card_file "$CASE_R3")")" = /elsewhere/rate-card.json
check 'R3 warns that a global rate-card symlink points elsewhere' \
  grep -Fq "Global rate card $(rate_card_file "$CASE_R3") points elsewhere" "$TMP_ROOT/case-r3.out"

# K1: plain uninstall keeps operator configuration and runtime data after
# removing its rate-card link, and says how to remove that retained state.
CASE_K1="$TMP_ROOT/case-k1"
make_case_home "$CASE_K1"
mkdir -p "$CASE_K1/.ai-conductor/memory"
printf '{"project":"registry"}\n' > "$CASE_K1/.ai-conductor/registry.json"
printf 'operator memory\n' > "$CASE_K1/.ai-conductor/memory/note.md"
cp "$CASE_K1/.ai-conductor/registry.json" "$TMP_ROOT/case-k1-registry-before.json"
cp "$CASE_K1/.ai-conductor/memory/note.md" "$TMP_ROOT/case-k1-note-before.md"
run_uninstall "$CASE_K1" "$TMP_ROOT/case-k1.out" || true
check 'K1 keeps the operator project registry byte-identical' \
  cmp -s "$CASE_K1/.ai-conductor/registry.json" "$TMP_ROOT/case-k1-registry-before.json"
check 'K1 keeps operator memory byte-identical' \
  cmp -s "$CASE_K1/.ai-conductor/memory/note.md" "$TMP_ROOT/case-k1-note-before.md"
check 'K1 reports the exact kept-state guidance' \
  grep -Fq "Kept $CASE_K1/.ai-conductor: operator configuration and runtime data (project registry, memory). Re-run with --uninstall --purge to remove it." "$TMP_ROOT/case-k1.out"

# K2: uninstall does not create absent harness state or announce a kept path.
CASE_K2="$TMP_ROOT/case-k2"
mkdir -p "$CASE_K2"
run_uninstall "$CASE_K2" "$TMP_ROOT/case-k2.out"
CASE_K2_EXIT=$?
check 'K2 uninstall exits successfully without harness state' test "$CASE_K2_EXIT" -eq 0
check 'K2 does not create absent harness state' test ! -e "$CASE_K2/.ai-conductor"
check 'K2 does not report kept state when none exists' \
  has_no_kept_line "$TMP_ROOT/case-k2.out"

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
