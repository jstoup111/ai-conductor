#!/usr/bin/env bash
set -euo pipefail

# Story-level acceptance coverage for the safe multi-version migration feature.
# Covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13
# The real bin/migrate entry point is copied into an isolated harness fixture;
# only bin/install is replaced because installation is outside this story's
# boundary. No provider, network, package-manager, or daemon process is called.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE_SRC="$REPO_ROOT/bin/migrate"
COMMON_SRC="$REPO_ROOT/bin/lib/harness-common.sh"

PASS=0
FAIL=0
TOTAL=0
OUT=""
CODE=0

assert() {
  local description=$1 result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  fi
}

contains() {
  case "$1" in
    *"$2"*) return 0 ;;
    *) return 1 ;;
  esac
}

if ! command -v rg >/dev/null 2>&1; then
  printf 'SKIP ripgrep is required for multi-version migration acceptance coverage\n'
  exit 0
fi

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

STUBS_DIR="$TMP_ROOT/stubs"
mkdir -p "$STUBS_DIR"
PY3=$(python3 -c 'import sys; print(sys.executable)')
ln -s "$PY3" "$STUBS_DIR/python3"
# The copied runner reaches the actual 0.99.20 migration blocks below. Their
# package-manager and provider commands are third-party boundaries, so keep
# those commands local and deterministic while leaving bin/migrate itself real.
cat > "$STUBS_DIR/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$PWD" >> "${NPM_PWD_LOG:?}"
exit 0
EOF
cat > "$STUBS_DIR/claude" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = setup-token ]; then
  mkdir -p "$HOME/.ai-conductor"
  : > "$HOME/.ai-conductor/build-auth"
fi
exit 0
EOF
chmod +x "$STUBS_DIR/npm" "$STUBS_DIR/claude"
TEST_PATH="$STUBS_DIR:$REPO_ROOT/bin:$PATH"

make_harness() {
  local name=$1
  local harness="$TMP_ROOT/harness-$name"
  mkdir -p "$harness/bin/lib"
  cp "$MIGRATE_SRC" "$harness/bin/migrate"
  cp "$COMMON_SRC" "$harness/bin/lib/harness-common.sh"
  chmod +x "$harness/bin/migrate"
  # Installation has its own acceptance suite. Keep this fixture at the
  # migration-command boundary and prevent writes outside the isolated home.
  printf '#!/usr/bin/env bash\nexit 0\n' > "$harness/bin/install"
  chmod +x "$harness/bin/install"
  printf '1.2.0\n' > "$harness/VERSION"
  printf '%s\n' "$harness"
}

make_consumer() {
  local name=$1
  local consumer="$TMP_ROOT/consumer-$name"
  mkdir -p "$consumer/.ai-conductor" "$consumer/.daemon"
  printf 'name: migration-acceptance\n' > "$consumer/.ai-conductor/config.yml"
  printf '{"pid": 99999999}\n' > "$consumer/.daemon/daemon.pid"
  printf '.daemon/\n' > "$consumer/.gitignore"
  git -C "$consumer" init -q -b main
  git -C "$consumer" config user.email test@example.com
  git -C "$consumer" config user.name Test
  git -C "$consumer" add -A
  git -C "$consumer" commit -q -m initial
  printf '%s\n' "$consumer"
}

make_home() {
  local name=$1 version=$2
  local isolated_home="$TMP_ROOT/home-$name"
  mkdir -p "$isolated_home/.ai-conductor"
  python3 - "$isolated_home/.ai-conductor/config.yml" "$version" <<'PY'
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(f"conductor:\n  current_version: {sys.argv[2]}\n")
PY
  printf '%s\n' "$isolated_home"
}

set_version() {
  local isolated_home=$1 version=$2
  python3 - "$isolated_home/.ai-conductor/config.yml" "$version" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.write_text(f"conductor:\n  current_version: {sys.argv[2]}\n")
PY
}

run_migrate() {
  local harness=$1 consumer=$2 isolated_home=$3
  shift 3
  set +e
  OUT=$(cd "$consumer" && HOME="$isolated_home" PATH="$TEST_PATH" "$harness/bin/migrate" "$@" < /dev/null 2>&1)
  CODE=$?
  set -e
}

run_tty_migrate() {
  local harness=$1 consumer=$2 isolated_home=$3 input=$4
  set +e
  # Keep a defective approval loop from wedging the Story 6 path forever.
  OUT=$(cd "$consumer" && printf '%s' "$input" | HOME="$isolated_home" PATH="$TEST_PATH" timeout --foreground 10s script -qec "$harness/bin/migrate" /dev/null 2>&1)
  CODE=$?
  set -e
}

fail_current_version_read() {
  local harness=$1
  cat >> "$harness/bin/lib/harness-common.sh" <<'EOF'

conductor_cfg_get() {
  return 1
}
EOF
}

find_ledger() {
  local isolated_home=$1
  if [ ! -d "$isolated_home/.ai-conductor" ]; then
    return 0
  fi
  find "$isolated_home/.ai-conductor" -type f -name '*.json' -print 2>/dev/null | head -n 1 || true
}

consumer_file_hashes() {
  local consumer=$1
  find "$consumer" -path "$consumer/.git" -prune -o -type f -print0 \
    | sort -z \
    | xargs -0r sha256sum
}

queued_migration_block_count() {
  awk '
    /^## \[0\.99\.20\]/{ in_release = 1; next }
    /^## \[0\.99\.17\]/{ in_release = 0 }
    in_release && /^```bash migration$/{ count += 1 }
    END { print count + 0 }
  ' "$REPO_ROOT/CHANGELOG.md"
}

write_ordered_changelog() {
  local harness=$1
  cat > "$harness/CHANGELOG.md" <<'EOF'
# Changelog

## [1.2.0]

## Migration

```bash migration
printf '1.2-first\n' >> execution.log
printf '%s\n' "$HARNESS_DIR" > harness-dir.log
```

## Migration

```bash migration
printf '1.2-second\n' >> execution.log
```

## [1.1.0]

## Migration

```bash migration
printf 'same-body\n' >> execution.log
```

## [1.0.0]

## Migration

```bash migration
printf 'same-body\n' >> execution.log
```

## [0.8.0]

## Migration

```bash migration
printf 'too-old\n' >> execution.log
```
EOF
}

printf 'Parser — every Migration section in document order\n'
PARSER_HARNESS=$(make_harness parser)
PARSER_CONSUMER=$(make_consumer parser)
PARSER_HOME=$(make_home parser v1.1.0)
cat > "$PARSER_HARNESS/CHANGELOG.md" <<'EOF'
# Changelog

## [1.2.0]

### Migration

```bash migration
printf 'nested-heading\n' >> execution.log
```

````markdown
### Migration

```bash migration
printf 'nested-example-leak\n' >> execution.log
```
````

````text
## Migration

```bash migration
printf 'heading-in-fence-leak\n' >> execution.log
```
````

## Migration

```bash migration
printf 'release-heading\n' >> execution.log
```
EOF
run_migrate "$PARSER_HARNESS" "$PARSER_CONSUMER" "$PARSER_HOME" --dry-run
PARSER_BLOCKS=$(printf '%s\n' "$OUT" | rg "printf '" || true)
assert 'a release entry contributes fences from every Migration section at mixed heading depths' "$(
  [ "$PARSER_BLOCKS" = $'printf \'nested-heading\\n\' >> execution.log\nprintf \'release-heading\\n\' >> execution.log' ] && echo 0 || echo 1
)"
assert 'nested Migration examples inside fenced content are never offered' "$(
  ! contains "$PARSER_BLOCKS" 'nested-example-leak' && echo 0 || echo 1
)"
assert 'Migration headings inside fenced content are never offered' "$(
  ! contains "$PARSER_BLOCKS" 'heading-in-fence-leak' && echo 0 || echo 1
)"
run_migrate "$PARSER_HARNESS" "$PARSER_CONSUMER" "$PARSER_HOME" --yes
assert 'nested fenced Migration examples are never executed' "$(
  [ "$(cat "$PARSER_CONSUMER/execution.log" 2>/dev/null || true)" = $'nested-heading\nrelease-heading' ] && echo 0 || echo 1
)"

printf 'Parser — excluded unparsable release labels are reported\n'
EXCLUSION_HARNESS=$(make_harness exclusion)
EXCLUSION_CONSUMER=$(make_consumer exclusion)
EXCLUSION_HOME=$(make_home exclusion v1.1.0)
cat > "$EXCLUSION_HARNESS/CHANGELOG.md" <<'EOF'
# Changelog

## [Unversioned]

## Migration

```bash migration
printf 'unversioned-first\n' >> execution.log
```

```bash migration
printf 'unversioned-second\n' >> execution.log
```

## [preview-alpha]

### Migration

```bash migration
printf 'preview-only\n' >> execution.log
```
EOF
run_migrate "$EXCLUSION_HARNESS" "$EXCLUSION_CONSUMER" "$EXCLUSION_HOME" --dry-run
assert 'Unversioned release exclusions name the label and withheld fence count' "$(
  contains "$OUT" 'Excluded unparsable release [Unversioned]: withheld 2 runnable migration fences' && echo 0 || echo 1
)"
assert 'non-numeric release exclusions name the label and withheld fence count' "$(
  contains "$OUT" 'Excluded unparsable release [preview-alpha]: withheld 1 runnable migration fence' && echo 0 || echo 1
)"
assert 'unparsable release fences are withheld from the dry-run block listing' "$(
  ! contains "$OUT" 'unversioned-first' && ! contains "$OUT" 'unversioned-second' && ! contains "$OUT" 'preview-only' && echo 0 || echo 1
)"
if [ "${MIGRATE_TEST_SCOPE:-}" = parser ]; then
  printf 'Summary: %s passed, %s failed, %s executed\n' "$PASS" "$FAIL" "$TOTAL"
  [ "$FAIL" -eq 0 ]
  exit
fi

printf 'Story 6 — real 0.99.17-era jump end to end\n'
HARNESS=$(make_harness real-jump)
CONSUMER=$(make_consumer real-jump)
HOME_DIR=$(make_home real-jump v0.99.17)
# Exercise the exact frozen queued set, rather than a synthetic changelog.
cp "$REPO_ROOT/CHANGELOG.md" "$HARNESS/CHANGELOG.md"
printf '0.99.20\n' > "$HARNESS/VERSION"
# The 0.99.20 migrations must take both their rebuild and hook sources from
# HARNESS_DIR. These sentinels make that boundary observable without calling npm.
mkdir -p "$HARNESS/src/conductor" "$HARNESS/hooks/claude"
printf '#!/usr/bin/env bash\nprintf harness-hook-sentinel\\n\n' \
  > "$HARNESS/hooks/claude/post-commit-derive-feedback.sh"
chmod +x "$HARNESS/hooks/claude/post-commit-derive-feedback.sh"
NPM_PWD_LOG="$TMP_ROOT/real-jump-npm-pwd.log"
export NPM_PWD_LOG
QUEUED_BLOCK_COUNT=$(queued_migration_block_count)
WORKTREE="$TMP_ROOT/preserved-worktree"
git -C "$CONSUMER" worktree add -q -b preserved-worktree "$WORKTREE"
BEFORE_WORKTREES=$(git -C "$CONSUMER" worktree list --porcelain)
BEFORE_BRANCHES=$(git -C "$CONSUMER" branch --format='%(refname:short)' | sort)
BEFORE_DAEMON=$(cat "$CONSUMER/.daemon/daemon.pid")

run_migrate "$HARNESS" "$CONSUMER" "$HOME_DIR" --yes
assert 'the real 0.99.17-era multi-version jump exits zero' "$([ "$CODE" -eq 0 ] && echo 0 || echo 1)"
EXPECTED_ORDER=$(seq 1 "$QUEUED_BLOCK_COUNT")
ACTUAL_ORDER=$(printf '%s\n' "$OUT" | sed -nE 's/.*candidate block ([0-9]+).*/\1/p')
assert 'the full corrected queued set executes in candidate order' "$([ "$ACTUAL_ORDER" = "$EXPECTED_ORDER" ] && echo 0 || echo 1)"
LEDGER=$(find_ledger "$HOME_DIR")
assert 'the completed jump records every real queued block in its durable per-consumer ledger' "$(
  [ -n "$LEDGER" ] \
    && [ "$(python3 - "$LEDGER" <<'PY'
import json
import sys
print(len(json.load(open(sys.argv[1]))["appliedBlocks"]))
PY
)" -eq "$QUEUED_BLOCK_COUNT" ] \
    && echo 0 || echo 1
)"
assert 'worktrees are unchanged by the completed jump' "$([ "$(git -C "$CONSUMER" worktree list --porcelain)" = "$BEFORE_WORKTREES" ] && echo 0 || echo 1)"
assert 'branches are unchanged by the completed jump' "$([ "$(git -C "$CONSUMER" branch --format='%(refname:short)' | sort)" = "$BEFORE_BRANCHES" ] && echo 0 || echo 1)"
assert 'daemon state is unchanged by the completed jump' "$([ "$(cat "$CONSUMER/.daemon/daemon.pid")" = "$BEFORE_DAEMON" ] && echo 0 || echo 1)"

assert 'the conductor rebuild runs from the harness-owned source directory' "$(
  [ "$(sort -u "$NPM_PWD_LOG")" = "$HARNESS/src/conductor" ] && echo 0 || echo 1
)"
assert 'the derive hook is installed from the harness-owned source' "$(
  contains "$(cat "$CONSUMER/.git/hooks/post-commit")" harness-hook-sentinel && echo 0 || echo 1
)"
assert 'the jump does not require a consumer-side harness source tree' "$(
  [ ! -e "$CONSUMER/src/conductor" ] && echo 0 || echo 1
)"

FIRST_BYTES=$(consumer_file_hashes "$CONSUMER")
run_migrate "$HARNESS" "$CONSUMER" "$HOME_DIR" --yes
SECOND_BYTES=$(consumer_file_hashes "$CONSUMER")
assert 'an immediate rerun exits zero and applies nothing' "$([ "$CODE" -eq 0 ] && ! contains "$OUT" 'Executing migration for' && echo 0 || echo 1)"
assert 'an immediate rerun leaves consumer files byte-for-byte unchanged' "$([ "$SECOND_BYTES" = "$FIRST_BYTES" ] && echo 0 || echo 1)"
assert 'an immediate rerun accounts for every already-applied block' "$(contains "$OUT" "already-applied=$QUEUED_BLOCK_COUNT" && echo 0 || echo 1)"

if [ "${MIGRATE_TEST_SCOPE:-}" = real-jump ]; then
  printf 'Summary: %s passed, %s failed, %s executed\n' "$PASS" "$FAIL" "$TOTAL"
  [ "$FAIL" -eq 0 ]
  exit
fi

printf 'Story 1/2 — channel identity, exclusions, and malformed state\n'
TAGGED_HARNESS=$(make_harness tagged)
MAIN_HARNESS=$(make_harness main)
write_ordered_changelog "$TAGGED_HARNESS"
cp "$TAGGED_HARNESS/CHANGELOG.md" "$MAIN_HARNESS/CHANGELOG.md"
TAGGED_CONSUMER=$(make_consumer tagged)
MAIN_CONSUMER=$(make_consumer main)
TAGGED_HOME=$(make_home tagged v0.99.17)
# A main@ identity has no sortable lower bound. Seed the only pre-0.99.17
# block as already applied, then verify it offers the same pending set as the
# equivalent tagged consumer.
MAIN_HOME=$(make_home main v0.7.0)
cp "$MAIN_HARNESS/CHANGELOG.md" "$MAIN_HARNESS/CHANGELOG.full"
cat > "$MAIN_HARNESS/CHANGELOG.md" <<'EOF'
# Changelog

## [0.8.0]

## Migration

```bash migration
printf 'too-old\n' >> execution.log
```
EOF
run_migrate "$MAIN_HARNESS" "$MAIN_CONSUMER" "$MAIN_HOME" --yes
mv "$MAIN_HARNESS/CHANGELOG.full" "$MAIN_HARNESS/CHANGELOG.md"
set_version "$MAIN_HOME" 'main@abc1234'
run_migrate "$TAGGED_HARNESS" "$TAGGED_CONSUMER" "$TAGGED_HOME" --dry-run
TAGGED_PREVIEW=$OUT
run_migrate "$MAIN_HARNESS" "$MAIN_CONSUMER" "$MAIN_HOME" --dry-run
MAIN_PREVIEW=$OUT
TAGGED_BLOCKS=$(printf '%s\n' "$TAGGED_PREVIEW" | rg "printf '" || true)
MAIN_BLOCKS=$(printf '%s\n' "$MAIN_PREVIEW" | rg "printf '" || true)
assert 'main@sha offers the same candidate bodies as the equivalent tagged installation' "$([ "$MAIN_BLOCKS" = "$TAGGED_BLOCKS" ] && echo 0 || echo 1)"

NO_LEDGER_MAIN_HARNESS=$(make_harness no-ledger-main)
NO_LEDGER_MAIN_CONSUMER=$(make_consumer no-ledger-main)
NO_LEDGER_MAIN_HOME=$(make_home no-ledger-main 'main@abc1234')
cat > "$NO_LEDGER_MAIN_HARNESS/CHANGELOG.md" <<'EOF'
# Changelog

## [1.2.0]

## Migration

```bash migration
printf 'already-current\n' >> execution.log
```
EOF
run_migrate "$NO_LEDGER_MAIN_HARNESS" "$NO_LEDGER_MAIN_CONSUMER" "$NO_LEDGER_MAIN_HOME" --yes
NO_LEDGER_MAIN_LEDGER=$(find_ledger "$NO_LEDGER_MAIN_HOME")
assert 'a no-ledger main@sha run bootstraps a durable candidate baseline even when its first range is empty' "$(
  [ "$CODE" -eq 0 ] \
    && [ -n "$NO_LEDGER_MAIN_LEDGER" ] \
    && if python3 - "$NO_LEDGER_MAIN_LEDGER" <<'PY'
import json
import sys

ledger = json.load(open(sys.argv[1]))
raise SystemExit(0 if ledger.get("candidateBaseline") == "v1.2.0" and ledger["appliedBlocks"] == [] else 1)
PY
then echo 0; else echo 1; fi
)"
printf '1.3.0\n' > "$NO_LEDGER_MAIN_HARNESS/VERSION"
cat >> "$NO_LEDGER_MAIN_HARNESS/CHANGELOG.md" <<'EOF'

## [1.3.0]

## Migration

```bash migration
printf 'pending-first\n' >> execution.log
```

```bash migration
printf 'pending-second\n' >> execution.log
```
EOF
set_version "$NO_LEDGER_MAIN_HOME" 'main@def5678'
run_migrate "$NO_LEDGER_MAIN_HARNESS" "$NO_LEDGER_MAIN_CONSUMER" "$NO_LEDGER_MAIN_HOME" --yes
assert 'a later main@sha run applies every block after the durable candidate baseline' "$(
  [ "$CODE" -eq 0 ] \
    && [ "$(cat "$NO_LEDGER_MAIN_CONSUMER/execution.log" 2>/dev/null || true)" = $'pending-first\npending-second' ] \
    && if python3 - "$NO_LEDGER_MAIN_LEDGER" <<'PY'
import json
import sys

ledger = json.load(open(sys.argv[1]))
raise SystemExit(0 if len(ledger["appliedBlocks"]) == 2 else 1)
PY
then echo 0; else echo 1; fi
)"

cat >> "$MAIN_HARNESS/CHANGELOG.md" <<'EOF'

## [Unversioned]

## Migration

```bash migration
printf 'must-not-run\n' >> execution.log
```
EOF
run_migrate "$MAIN_HARNESS" "$MAIN_CONSUMER" "$MAIN_HOME" --dry-run
assert 'an unparsable release label is excluded and explicitly reported' "$(contains "$OUT" 'Unversioned' && contains "$OUT" 'Excluded' && echo 0 || echo 1)"

LEDGER=$(find_ledger "$HOME_DIR")
if [ -n "$LEDGER" ]; then
  BEFORE_MALFORMED=$(cat "$CONSUMER/execution.log" 2>/dev/null || true)
  printf '{malformed\n' > "$LEDGER"
  run_migrate "$HARNESS" "$CONSUMER" "$HOME_DIR" --yes
  assert 'a malformed ledger fails loudly' "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
  assert 'a malformed ledger applies nothing' "$([ "$(cat "$CONSUMER/execution.log" 2>/dev/null || true)" = "$BEFORE_MALFORMED" ] && echo 0 || echo 1)"
else
  assert 'a malformed ledger fails loudly' 1
  assert 'a malformed ledger applies nothing' 1
fi

printf 'Story 3 — fail-fast execution and applied-prefix durability\n'
FAIL_HARNESS=$(make_harness failure)
FAIL_CONSUMER=$(make_consumer failure)
FAIL_HOME=$(make_home failure v0.99.17)
cat > "$FAIL_HARNESS/CHANGELOG.md" <<'EOF'
# Changelog
## [1.2.0]
## Migration
```bash migration
printf 'prefix\n' >> execution.log
```
```bash migration
false
printf 'failed-tail\n' >> execution.log
```
```bash migration
printf 'unreached\n' >> execution.log
```
EOF
run_migrate "$FAIL_HARNESS" "$FAIL_CONSUMER" "$FAIL_HOME" --yes
assert 'a fail-early/succeed-late block returns non-zero' "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
assert 'failure halts at the applied prefix' "$([ "$(cat "$FAIL_CONSUMER/execution.log" 2>/dev/null || true)" = 'prefix' ] && echo 0 || echo 1)"
assert 'the failure report names release and block position' "$(contains "$OUT" '1.2.0' && { contains "$OUT" 'block 2' || contains "$OUT" 'position 2'; } && echo 0 || echo 1)"

for failure_body in 'printf "%s\n" "$UNSET_MIGRATION_VALUE"' 'false | true'; do
  STRICT_HARNESS=$(make_harness "strict-$TOTAL")
  STRICT_CONSUMER=$(make_consumer "strict-$TOTAL")
  STRICT_HOME=$(make_home "strict-$TOTAL" v0.99.17)
  {
    printf '# Changelog\n## [1.2.0]\n## Migration\n```bash migration\n'
    printf '%s\n' "$failure_body"
    printf '```\n'
  } > "$STRICT_HARNESS/CHANGELOG.md"
  run_migrate "$STRICT_HARNESS" "$STRICT_CONSUMER" "$STRICT_HOME" --yes
  assert "strict shell semantics reject: $failure_body" "$([ "$CODE" -ne 0 ] && echo 0 || echo 1)"
done

printf 'Story 4/5 — approval and non-interactive reachability\n'
APPROVAL_HARNESS=$(make_harness approval)
APPROVAL_CONSUMER=$(make_consumer approval)
APPROVAL_HOME=$(make_home approval v0.99.17)
cat > "$APPROVAL_HARNESS/CHANGELOG.md" <<'EOF'
# Changelog
## [1.2.0]
## Migration
```bash migration
printf 'one\n' >> execution.log
```
```bash migration
printf 'two\n' >> execution.log
```
EOF
run_migrate "$APPROVAL_HARNESS" "$APPROVAL_CONSUMER" "$APPROVAL_HOME"
assert 'without a TTY no pending block executes' "$([ ! -e "$APPROVAL_CONSUMER/execution.log" ] && echo 0 || echo 1)"
assert 'without a TTY the runner explains how to apply pending blocks later' "$(contains "$OUT" '--yes' && contains "$OUT" 'pending' && echo 0 || echo 1)"
set_version "$APPROVAL_HOME" v1.2.0
run_migrate "$APPROVAL_HARNESS" "$APPROVAL_CONSUMER" "$APPROVAL_HOME" --yes
assert 'pending blocks remain reachable after the caller advances its version' "$([ "$(cat "$APPROVAL_CONSUMER/execution.log" 2>/dev/null || true)" = $'one\ntwo' ] && echo 0 || echo 1)"

DRY_HARNESS=$(make_harness dry)
DRY_CONSUMER=$(make_consumer dry)
DRY_HOME=$(make_home dry v0.99.17)
cp "$APPROVAL_HARNESS/CHANGELOG.md" "$DRY_HARNESS/CHANGELOG.md"
run_migrate "$DRY_HARNESS" "$DRY_CONSUMER" "$DRY_HOME" --dry-run
assert 'preview-only executes nothing' "$([ ! -e "$DRY_CONSUMER/execution.log" ] && echo 0 || echo 1)"
assert 'preview-only records nothing as applied' "$([ -z "$(find_ledger "$DRY_HOME")" ] && echo 0 || echo 1)"
run_migrate "$DRY_HARNESS" "$DRY_CONSUMER" "$DRY_HOME" --yes
assert 'automatic approval applies all pending blocks without a terminal' "$([ "$CODE" -eq 0 ] && [ "$(cat "$DRY_CONSUMER/execution.log" 2>/dev/null || true)" = $'one\ntwo' ] && echo 0 || echo 1)"
assert 'the closing summary distinguishes all four outcome classes' "$(contains "$OUT" 'applied' && contains "$OUT" 'skipped' && contains "$OUT" 'failed' && contains "$OUT" 'already-applied' && echo 0 || echo 1)"

if command -v script >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
  TTY_HARNESS=$(make_harness tty)
  TTY_CONSUMER=$(make_consumer tty)
  TTY_HOME=$(make_home tty v0.99.17)
  cp "$APPROVAL_HARNESS/CHANGELOG.md" "$TTY_HARNESS/CHANGELOG.md"
  run_tty_migrate "$TTY_HARNESS" "$TTY_CONSUMER" "$TTY_HOME" $'bogus\nn\nall\n'
  TTY_OUT=$OUT
  TTY_CODE=$CODE
  assert 'interactive preview offers yes, no, all, and stop per block' "$(contains "$TTY_OUT" 'yes' && contains "$TTY_OUT" 'no' && contains "$TTY_OUT" 'all' && contains "$TTY_OUT" 'stop' && echo 0 || echo 1)"
  assert 'an unrecognized response does not execute and causes a re-prompt' "$(contains "$TTY_OUT" 'Unrecognized response' && [ "$TTY_CODE" -eq 0 ] && echo 0 || echo 1)"
  TTY_BEFORE_RERUN=$(cat "$TTY_CONSUMER/execution.log" 2>/dev/null || true)
  assert 'skip leaves only the accepted later block executed in the first run' "$([ "$TTY_BEFORE_RERUN" = 'two' ] && echo 0 || echo 1)"
  run_migrate "$TTY_HARNESS" "$TTY_CONSUMER" "$TTY_HOME" --yes
  assert 'a skipped block is offered on the next run while accepted blocks stay applied' "$([ "$(sort "$TTY_CONSUMER/execution.log" 2>/dev/null || true)" = $'one\ntwo' ] && echo 0 || echo 1)"
  EOF_HARNESS=$(make_harness tty-eof)
  EOF_CONSUMER=$(make_consumer tty-eof)
  EOF_HOME=$(make_home tty-eof v0.99.17)
  cp "$APPROVAL_HARNESS/CHANGELOG.md" "$EOF_HARNESS/CHANGELOG.md"
  run_tty_migrate "$EOF_HARNESS" "$EOF_CONSUMER" "$EOF_HOME" ''
  EOF_PROMPTS=$(printf '%s\n' "$OUT" | rg -ic 'accept|run .*migration' || true)
  case "$EOF_PROMPTS" in
    ''|*[!0-9]*) EOF_PROMPTS=0 ;;
  esac
  assert 'exhausted scripted-TTY input fails closed without executing the pending Story 6 block' "$([ "$CODE" -ne 0 ] && [ "$CODE" -ne 124 ] && [ ! -e "$EOF_CONSUMER/execution.log" ] && echo 0 || echo 1)"
  assert 'exhausted scripted-TTY input cannot repeat approval warnings indefinitely' "$([ "$EOF_PROMPTS" -le 1 ] && echo 0 || echo 1)"
else
  # This is an infrastructure error, not a skipped acceptance criterion.
  assert 'interactive preview offers yes, no, all, and stop per block' 1
  assert 'an unrecognized response does not execute and causes a re-prompt' 1
  assert 'skip leaves only the accepted later block executed in the first run' 1
  assert 'a skipped block is offered on the next run while accepted blocks stay applied' 1
  assert 'exhausted scripted-TTY input fails closed without executing the pending Story 6 block' 1
  assert 'exhausted scripted-TTY input cannot repeat approval warnings indefinitely' 1
fi

printf 'Story 6 — queued-block safety contract\n'
CONFIG_READ_FAILURE_HARNESS=$(make_harness config-read-failure)
CONFIG_READ_FAILURE_CONSUMER=$(make_consumer config-read-failure)
CONFIG_READ_FAILURE_HOME=$(make_home config-read-failure v0.99.17)
cp "$APPROVAL_HARNESS/CHANGELOG.md" "$CONFIG_READ_FAILURE_HARNESS/CHANGELOG.md"
fail_current_version_read "$CONFIG_READ_FAILURE_HARNESS"
run_migrate "$CONFIG_READ_FAILURE_HARNESS" "$CONFIG_READ_FAILURE_CONSUMER" "$CONFIG_READ_FAILURE_HOME" --yes
assert 'a failed installed-version config read fails loudly before selecting migrations' "$(
  [ "$CODE" -ne 0 ] \
    && contains "$OUT" 'installed-version config read' \
    && [ ! -e "$CONFIG_READ_FAILURE_CONSUMER/execution.log" ] \
    && echo 0 || echo 1
)"

QUEUED=$(python3 - "$REPO_ROOT/CHANGELOG.md" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text()
match = re.search(r"(?ms)^## \[0\.99\.20\].*?(?=^## \[)", text)
print(match.group(0) if match else "")
PY
)
assert 'queued blocks do not invoke harness binaries through consumer-relative ./bin paths' "$(! printf '%s\n' "$QUEUED" | rg -q '(?m)^\s*\./bin/' && echo 0 || echo 1)"
assert 'queued blocks do not force-remove worktrees or branches' "$(! printf '%s\n' "$QUEUED" | rg -q 'git (worktree remove --force|branch -D)' && echo 0 || echo 1)"
assert 'queued blocks do not stop or restart a daemon unattended' "$(! printf '%s\n' "$QUEUED" | rg -q '(kill .*daemon|kill "?\$pid|conduct-ts daemon restart)' && echo 0 || echo 1)"
assert 'the configuration append guard matches the key written by the block' "$(printf '%s\n' "$QUEUED" | rg -qF "grep -qF '# attribution_judge_cutover:" && echo 0 || echo 1)"

printf 'Summary: %s passed, %s failed, %s executed\n' "$PASS" "$FAIL" "$TOTAL"
[ "$FAIL" -eq 0 ]
