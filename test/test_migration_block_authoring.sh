#!/usr/bin/env bash
set -euo pipefail

# Acceptance coverage for the migration-block authoring contract. The checker
# operates solely on supplied changelog fixtures; it never runs a migration.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="$SCRIPT_DIR/check_migration_block_authoring.sh"

PASS=0
FAIL=0
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

assert_fixture() {
  local name=$1 expected=$2 expected_text=$3 fixture output exit_code
  fixture="$TMP_ROOT/$name.md"
  cat > "$fixture"
  set +e
  output=$(bash "$CHECKER" "$fixture" 2>&1)
  exit_code=$?
  set -e
  if [ "$exit_code" -eq "$expected" ] && [[ "$output" == *"$expected_text"* ]]; then
    printf 'PASS %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (exit=%s, output=%s)\n' "$name" "$exit_code" "$output"
    FAIL=$((FAIL + 1))
  fi
}

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

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
