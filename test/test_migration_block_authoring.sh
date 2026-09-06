#!/usr/bin/env bash
set -euo pipefail

# Covers: task:2
# Acceptance coverage for the migration-block authoring contract. The checker
# operates solely on supplied changelog fixtures; it never runs a migration.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="$SCRIPT_DIR/check_migration_block_authoring.sh"
FENCES="$SCRIPT_DIR/../bin/lib/migration_fences.py"

PASS=0
FAIL=0
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

assert_fixture() {
  local name=$1 expected=$2 expected_text=$3 expected_runtime=${4:-} fixture output runtime_output exit_code
  fixture="$TMP_ROOT/$name.md"
  cat > "$fixture"
  case "$name" in
    trailing-info-whitespace-is-checked)
      python3 - "$fixture" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.write_bytes(path.read_bytes().replace(b"bash migration<SPACES>", b"bash migration   ").replace(b"<WIDER>", b"````   "))
PY
      ;;
    trailing-info-tab-is-checked)
      python3 - "$fixture" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.write_bytes(path.read_bytes().replace(b"bash migration<TAB>", b"bash migration\t"))
PY
      ;;
  esac
  set +e
  output=$(bash "$CHECKER" "$fixture" 2>&1)
  exit_code=$?
  set -e
  runtime_output=$(python3 - "$FENCES" "$fixture" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]).parent))
from migration_fences import runnable_migration_fences

print("".join(fence.script for fence in runnable_migration_fences(Path(sys.argv[2]).read_text())))
PY
)
  if [ "$exit_code" -eq "$expected" ] && [[ "$output" == *"$expected_text"* ]] \
    && { [ -z "$expected_runtime" ] || [[ "$runtime_output" == *"$expected_runtime"* ]]; }; then
    printf 'PASS %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (exit=%s, output=%s)\n' "$name" "$exit_code" "$output"
    FAIL=$((FAIL + 1))
  fi
}

assert_fixture trailing-info-whitespace-is-checked 1 ':8: harness-path clause' './bin/install --update' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration<SPACES>
./bin/install --update
<WIDER>
EOF

assert_fixture trailing-info-tab-is-checked 1 ':8: harness-path clause' './bin/install --update' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration<TAB>
./bin/install --update
```
EOF

assert_fixture spaced-info-is-checked 1 ':8: harness-path clause' './bin/install --update' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```   bash migration
./bin/install --update
```
EOF

assert_fixture consecutive-migration-headings-are-all-checked 1 ':14: daemon-lifecycle clause' 'conduct-ts daemon restart' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
echo "first block is benign"
```

### Migration

```bash migration
conduct-ts daemon restart
```
EOF

assert_fixture outer-examples-stay-inert-and-later-candidate-is-checked 1 ':22: destructive-git clause' 'git branch -D example' <<'EOF'
# Changelog

## [1.2.3]

````markdown
## Migration
```bash migration
./bin/not-runnable
```
````

~~~~markdown
## Migration
```bash migration
./bin/still-not-runnable
```
~~~~

## Migration

```bash migration
git branch -D example
````
EOF

assert_fixture unversioned-archive-remains-exempt 0 'PASS migration block authoring contract' './bin/install --update' <<'EOF'
# Changelog

## [Unversioned]

## Migration

```bash migration
./bin/install --update
```
EOF

assert_fixture unterminated-candidate-is-rejected 1 ':7: attribution clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
./bin/install --update
EOF

assert_no_runtime_fixture() {
  local name=$1 fixture runtime_output
  fixture="$TMP_ROOT/$name.md"
  cat > "$fixture"
  runtime_output=$(python3 - "$FENCES" "$fixture" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]).parent))
from migration_fences import runnable_migration_fences

print("".join(fence.script for fence in runnable_migration_fences(Path(sys.argv[2]).read_text())))
PY
)
  if [ -z "$runtime_output" ]; then
    printf 'PASS %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (runtime output=%s)\n' "$name" "$runtime_output"
    FAIL=$((FAIL + 1))
  fi
}

assert_no_runtime_fixture wider-openers-and-indented-openers-are-not-runnable <<'EOF'
# Changelog

## [1.2.3]

## Migration

````bash migration
./bin/not-runnable
````

 ```bash migration
./bin/not-runnable
 ```
EOF

assert_fixture relative-harness-path 1 ':8: harness-path clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
./bin/install --update
```
EOF

assert_fixture consumer-root-conductor-source 1 ':8: harness-path clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
cd "$(git rev-parse --show-toplevel)/src/conductor"
```
EOF

assert_fixture consumer-root-hook-source 1 ':8: harness-path clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
cp "$PROJECT_ROOT/.claude/harness/hooks/claude/post-commit-derive-feedback.sh" "$PROJECT_ROOT/.git/hooks/post-commit"
```
EOF

assert_fixture quoted-consumer-root-conductor-source 1 ':8: harness-path clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
cd "${PROJECT_ROOT}"/src/conductor
```
EOF

assert_fixture quoted-consumer-root-hook-source 1 ':8: harness-path clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
cp "${PROJECT_ROOT}"/.claude/harness/hooks/claude/post-commit-derive-feedback.sh "$PROJECT_ROOT/.git/hooks/post-commit"
```
EOF

assert_fixture quoted-command-substitution-conductor-source 1 ':8: harness-path clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
cd "$(git rev-parse --show-toplevel)"/src/conductor
```
EOF

assert_fixture quoted-command-substitution-hook-source 1 ':8: harness-path clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
cp "$(git rev-parse --show-toplevel)"/.claude/harness/hooks/claude/post-commit-derive-feedback.sh "$PROJECT_ROOT/.git/hooks/post-commit"
```
EOF

assert_fixture forced-removal 1 ':8: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
git worktree remove --force .worktrees/example
```
EOF

assert_fixture indented-loop-body-forced-removal 1 ':9: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
for wt in .worktrees/*; do
  git worktree remove --force "$wt"
done
```
EOF

assert_fixture short-forced-worktree-removal 1 ':8: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
git worktree remove -f .worktrees/example
```
EOF

assert_fixture repeated-short-forced-worktree-removal 1 ':8: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
git worktree remove -ff .worktrees/example
```
EOF

assert_fixture escaped-unquoted-quotes-before-forced-worktree-removal 1 ':8: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
printf \"message\"; git worktree remove -ff .worktrees/example
```
EOF

assert_fixture safe-string-forced-worktree-removal 0 'PASS migration block authoring contract' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
printf '%s\n' 'git worktree remove -ff .worktrees/example'
```
EOF

assert_fixture escaped-safe-string-forced-worktree-removal 0 'PASS migration block authoring contract' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
printf '%s\n' "safe \"; git worktree remove -ff .worktrees/example"
```
EOF

assert_fixture compound-forced-worktree-removal 1 ':8: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
true; git worktree remove -ff .worktrees/example
```
EOF

assert_fixture forced-branch-removal 1 ':8: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
git branch -D example
```
EOF

assert_fixture compound-forced-branch-removal 1 ':8: destructive-git clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
false || git branch -D example
```
EOF

assert_fixture unattended-daemon-restart 1 ':8: daemon-lifecycle clause' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
conduct-ts daemon restart
```
EOF

assert_fixture unattributable-block 1 ':3: attribution clause' <<'EOF'
# Changelog

```bash migration
echo "orphaned"
```
EOF

assert_fixture conforming-block 0 'PASS migration block authoring contract' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
"${HARNESS_DIR:?HARNESS_DIR must be set by bin/migrate}/bin/install" --update
echo "Restart the daemon yourself if it needs new configuration."
```
EOF

assert_fixture conforming-harness-hook-source 0 'PASS migration block authoring contract' <<'EOF'
# Changelog

## [1.2.3]

## Migration

```bash migration
cp "${HARNESS_DIR:?}/hooks/claude/post-commit-derive-feedback.sh" "$PROJECT_ROOT/.git/hooks/post-commit"
```
EOF

CRLF_FIXTURE="$TMP_ROOT/crlf-info.md"
printf '# Changelog\r\n\r\n## [1.2.3]\r\n\r\n## Migration\r\n\r\n```bash migration\r\n./bin/install --update\r\n```\r\n' > "$CRLF_FIXTURE"
set +e
CRLF_OUTPUT=$(bash "$CHECKER" "$CRLF_FIXTURE" 2>&1)
CRLF_EXIT=$?
set -e
CRLF_RUNTIME=$(python3 - "$FENCES" "$CRLF_FIXTURE" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]).parent))
from migration_fences import runnable_migration_fences

print("".join(fence.script for fence in runnable_migration_fences(Path(sys.argv[2]).read_text())))
PY
)
if [ "$CRLF_EXIT" -eq 1 ] && [[ "$CRLF_OUTPUT" == *':8: harness-path clause'* ]] && [[ "$CRLF_RUNTIME" == *'./bin/install --update'* ]]; then
  printf 'PASS CRLF candidate is runtime-recognized and checked\n'
  PASS=$((PASS + 1))
else
  printf 'FAIL CRLF candidate is runtime-recognized and checked (exit=%s, output=%s)\n' "$CRLF_EXIT" "$CRLF_OUTPUT"
  FAIL=$((FAIL + 1))
fi

HELPER_FIXTURE="$TMP_ROOT/helper-failure.md"
printf '# Changelog\n' > "$HELPER_FIXTURE"
set +e
UNAVAILABLE_OUTPUT=$(MIGRATION_FENCES_HELPER="$TMP_ROOT/missing-helper.py" bash "$CHECKER" "$HELPER_FIXTURE" 2>&1)
UNAVAILABLE_EXIT=$?
set -e
if [ "$UNAVAILABLE_EXIT" -ne 0 ] && [[ "$UNAVAILABLE_OUTPUT" == *'recognizer unavailable or failed'* ]] && [[ "$UNAVAILABLE_OUTPUT" != *'PASS migration block authoring contract'* ]]; then
  printf 'PASS unavailable recognizer fails closed\n'
  PASS=$((PASS + 1))
else
  printf 'FAIL unavailable recognizer fails closed (exit=%s, output=%s)\n' "$UNAVAILABLE_EXIT" "$UNAVAILABLE_OUTPUT"
  FAIL=$((FAIL + 1))
fi

INVALID_HELPER="$TMP_ROOT/invalid-helper.py"
cat > "$INVALID_HELPER" <<'PY'
import sys
sys.stdout.buffer.write(b"8\0unknown\0")
PY
set +e
INVALID_OUTPUT=$(MIGRATION_FENCES_HELPER="$INVALID_HELPER" bash "$CHECKER" "$HELPER_FIXTURE" 2>&1)
INVALID_EXIT=$?
set -e
if [ "$INVALID_EXIT" -ne 0 ] && [[ "$INVALID_OUTPUT" == *'invalid truncated migration fence recognizer output'* ]] && [[ "$INVALID_OUTPUT" != *'PASS migration block authoring contract'* ]]; then
  printf 'PASS truncated recognizer records fail closed\n'
  PASS=$((PASS + 1))
else
  printf 'FAIL invalid recognizer records fail closed (exit=%s, output=%s)\n' "$INVALID_EXIT" "$INVALID_OUTPUT"
  FAIL=$((FAIL + 1))
fi

UNKNOWN_HELPER="$TMP_ROOT/unknown-helper.py"
cat > "$UNKNOWN_HELPER" <<'PY'
import sys
sys.stdout.buffer.write(b"8\0unknown\0" + b"1\0" + b"1\0script\0")
PY
set +e
UNKNOWN_OUTPUT=$(MIGRATION_FENCES_HELPER="$UNKNOWN_HELPER" bash "$CHECKER" "$HELPER_FIXTURE" 2>&1)
UNKNOWN_EXIT=$?
set -e
if [ "$UNKNOWN_EXIT" -ne 0 ] && [[ "$UNKNOWN_OUTPUT" == *'invalid migration fence recognizer record'* ]] && [[ "$UNKNOWN_OUTPUT" != *'PASS migration block authoring contract'* ]]; then
  printf 'PASS unknown recognizer records fail closed\n'
  PASS=$((PASS + 1))
else
  printf 'FAIL unknown recognizer records fail closed (exit=%s, output=%s)\n' "$UNKNOWN_EXIT" "$UNKNOWN_OUTPUT"
  FAIL=$((FAIL + 1))
fi

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
