#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$REPO_ROOT/test/run_shell_tests.sh"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/run-shell-tests.XXXXXX")"

cleanup() {
  rm -rf -- "$FIXTURE_ROOT"
}
trap cleanup EXIT

PASS=0
FAIL=0

assert() {
  local description=$1 result=$2
  if [ "$result" -eq 0 ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description" >&2
    FAIL=$((FAIL + 1))
  fi
}

hash_tree() {
  find "$1" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
}

TEST_DIR="$FIXTURE_ROOT/test"
RUN_TMPDIR="$FIXTURE_ROOT/runner-tmp"
PLANTED_HOME="$FIXTURE_ROOT/planted-home"
COUNTER_FILE="$FIXTURE_ROOT/counter"
PATHS_FILE="$FIXTURE_ROOT/sandbox-paths"
MANIFEST="$FIXTURE_ROOT/manifest"

mkdir -p "$TEST_DIR" "$RUN_TMPDIR" "$PLANTED_HOME/.config"
printf '[user]\n\tname = Planted User\n' > "$PLANTED_HOME/.gitconfig"
printf 'unchanged\n' > "$PLANTED_HOME/.config/fixture"
HOME_HASH_BEFORE="$(hash_tree "$PLANTED_HOME")"

for name in first second third; do
  cat > "$TEST_DIR/${name}.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$(basename "$0")" >> "$COUNTER_FILE"
SCRIPT
  chmod +x "$TEST_DIR/${name}.sh"
done

cat > "$TEST_DIR/paths.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
for directory in "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"; do
  mkdir -p "$directory"
  : > "$directory/marker"
  printf '%s\n' "$directory" | tee -a "$PATHS_FILE"
done
SCRIPT
chmod +x "$TEST_DIR/paths.sh"

cat > "$TEST_DIR/git-config.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
git config --global fixture.key value
test "$(git config --global --get fixture.key)" = value
SCRIPT
chmod +x "$TEST_DIR/git-config.sh"

cat > "$TEST_DIR/not-run.sh" <<'SCRIPT'
#!/usr/bin/env bash
exit 99
SCRIPT
chmod +x "$TEST_DIR/not-run.sh"

cat > "$MANIFEST" <<'MANIFEST'
first.sh shell-runner
second.sh shell-runner
third.sh shell-runner
paths.sh shell-runner
git-config.sh shell-runner
not-run.sh integrity must not be run by the shell runner
MANIFEST

set +e
OUTPUT="$(HOME="$PLANTED_HOME" TMPDIR="$RUN_TMPDIR" COUNTER_FILE="$COUNTER_FILE" PATHS_FILE="$PATHS_FILE" \
  bash "$RUNNER" --manifest "$MANIFEST" --test-dir "$TEST_DIR" 2>&1)"
RUN_EXIT=$?
set -e

assert 'runner exits successfully for passing shell-runner fixtures' "$([ "$RUN_EXIT" -eq 0 ] && echo 0 || echo 1)"

for name in first second third; do
  count=$(grep -Fxc "$name.sh" "$COUNTER_FILE" 2>/dev/null || true)
  count=${count:-0}
  assert "runner executes $name exactly once" \
    "$([ "$count" -eq 1 ] && echo 0 || echo 1)"
done

for name in first second third paths git-config; do
  assert "runner reports $name as passing" \
    "$(grep -Fqx "PASS $name.sh" <<<"$OUTPUT" && echo 0 || echo 1)"
done
assert 'runner does not execute non-shell-runner entries' \
  "$(grep -Fq 'not-run.sh' <<<"$OUTPUT" && echo 1 || echo 0)"

if [ -f "$PATHS_FILE" ]; then
  while IFS= read -r sandbox_path; do
    case "$sandbox_path" in
      "$RUN_TMPDIR"/*) result=0 ;;
      *) result=1 ;;
    esac
    assert "sandbox path is under the supplied TMPDIR: $sandbox_path" "$result"
  done < "$PATHS_FILE"
fi

assert 'sandbox fixture reported all isolated directories' \
  "$([ -f "$PATHS_FILE" ] && [ "$(wc -l < "$PATHS_FILE")" -eq 5 ] && echo 0 || echo 1)"
assert 'planted invoking HOME remains unchanged' \
  "$([ "$HOME_HASH_BEFORE" = "$(hash_tree "$PLANTED_HOME")" ] && echo 0 || echo 1)"
assert 'planted invoking git config remains byte-for-byte unchanged' \
  "$(cmp -s "$PLANTED_HOME/.gitconfig" <(printf '[user]\n\tname = Planted User\n') && echo 0 || echo 1)"
assert 'runner removes all sandbox directories after successful execution' \
  "$([ -z "$(find "$RUN_TMPDIR" -mindepth 1 -print -quit)" ] && echo 0 || echo 1)"

cat > "$TEST_DIR/broken.sh" <<'SCRIPT'
#!/usr/bin/env bash
exit 7
SCRIPT
chmod +x "$TEST_DIR/broken.sh"
printf 'broken.sh shell-runner\n' > "$MANIFEST"

set +e
HOME="$PLANTED_HOME" TMPDIR="$RUN_TMPDIR" bash "$RUNNER" --manifest "$MANIFEST" --test-dir "$TEST_DIR" >/dev/null 2>&1
FAILED_RUN_EXIT=$?
set -e

assert 'runner preserves a failing script exit status' \
  "$([ "$FAILED_RUN_EXIT" -ne 0 ] && echo 0 || echo 1)"
assert 'runner removes all sandbox directories after failing execution' \
  "$([ -z "$(find "$RUN_TMPDIR" -mindepth 1 -print -quit)" ] && echo 0 || echo 1)"

TEST5_COUNTER="$FIXTURE_ROOT/task5-counter"
cat > "$TEST_DIR/task5-pass-first.sh" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$(basename "$0")" >> "$TEST5_COUNTER"
SCRIPT
cat > "$TEST_DIR/task5-fail.sh" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$(basename "$0")" >> "$TEST5_COUNTER"
exit 3
SCRIPT
cat > "$TEST_DIR/task5-pass-last.sh" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$(basename "$0")" >> "$TEST5_COUNTER"
SCRIPT
chmod +x "$TEST_DIR/task5-pass-first.sh" "$TEST_DIR/task5-fail.sh" "$TEST_DIR/task5-pass-last.sh"
cat > "$MANIFEST" <<'MANIFEST'
task5-pass-first.sh shell-runner
task5-fail.sh shell-runner
task5-pass-last.sh shell-runner
MANIFEST

set +e
OUTPUT="$(TMPDIR="$RUN_TMPDIR" TEST5_COUNTER="$TEST5_COUNTER" bash "$RUNNER" --manifest "$MANIFEST" --test-dir "$TEST_DIR" 2>&1)"
TASK5_FAILURE_EXIT=$?
set -e

assert 'runner continues after a failing script and exits non-zero' \
  "$([ "$TASK5_FAILURE_EXIT" -ne 0 ] && [ "$(wc -l < "$TEST5_COUNTER")" -eq 3 ] && echo 0 || echo 1)"
assert 'runner reports the failing script exit code' \
  "$(grep -Fqx 'FAIL task5-fail.sh (exit 3)' <<<"$OUTPUT" && echo 0 || echo 1)"
for name in task5-pass-first task5-pass-last; do
  assert "runner reports $name as passing after failure accounting" \
    "$(grep -Fqx "PASS $name.sh" <<<"$OUTPUT" && echo 0 || echo 1)"
done
assert 'runner removes sandboxes without masking the aggregate failure' \
  "$([ -z "$(find "$RUN_TMPDIR" -mindepth 1 -print -quit)" ] && echo 0 || echo 1)"

cat > "$TEST_DIR/timeout.sh" <<'SCRIPT'
#!/usr/bin/env bash
sleep 30
SCRIPT
chmod +x "$TEST_DIR/timeout.sh"
printf 'timeout.sh shell-runner\n' > "$MANIFEST"

TIMEOUT_START=$SECONDS
set +e
OUTPUT="$(TMPDIR="$RUN_TMPDIR" bash "$RUNNER" --manifest "$MANIFEST" --test-dir "$TEST_DIR" --timeout 2 2>&1)"
TIMEOUT_EXIT=$?
set -e
TIMEOUT_ELAPSED=$((SECONDS - TIMEOUT_START))

assert 'runner reports a timed out script' \
  "$(grep -Fqx 'TIMEOUT timeout.sh after 2s' <<<"$OUTPUT" && echo 0 || echo 1)"
assert 'runner exits non-zero and bounds a timed out script' \
  "$([ "$TIMEOUT_EXIT" -ne 0 ] && [ "$TIMEOUT_ELAPSED" -lt 20 ] && echo 0 || echo 1)"

cat > "$TEST_DIR/credentials.sh" <<'SCRIPT'
#!/usr/bin/env bash
for credential in GH_TOKEN GITHUB_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY OPENAI_API_KEY CODEX_HOME; do
  if [ -v "$credential" ]; then
    printf 'set %s\n' "$credential"
  else
    printf 'unset %s\n' "$credential"
  fi
done
SCRIPT
chmod +x "$TEST_DIR/credentials.sh"
printf 'credentials.sh shell-runner\n' > "$MANIFEST"

OUTPUT="$(TMPDIR="$RUN_TMPDIR" GH_TOKEN=gh GITHUB_TOKEN=github CLAUDE_CODE_OAUTH_TOKEN=claude \
  ANTHROPIC_API_KEY=anthropic OPENAI_API_KEY=openai CODEX_HOME=codex \
  bash "$RUNNER" --manifest "$MANIFEST" --test-dir "$TEST_DIR" 2>&1)"
for credential in GH_TOKEN GITHUB_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY OPENAI_API_KEY CODEX_HOME; do
  assert "runner withholds $credential" \
    "$(grep -Fqx "unset $credential" <<<"$OUTPUT" && echo 0 || echo 1)"
done

printf 'not-run.sh integrity must not be run by the shell runner\n' > "$MANIFEST"
set +e
OUTPUT="$(TMPDIR="$RUN_TMPDIR" bash "$RUNNER" --manifest "$MANIFEST" --test-dir "$TEST_DIR" 2>&1)"
EMPTY_MANIFEST_EXIT=$?
set -e
assert 'runner refuses a manifest without shell-runner entries' \
  "$([ "$EMPTY_MANIFEST_EXIT" -ne 0 ] && grep -Fqx "EMPTY MANIFEST: $MANIFEST" <<<"$OUTPUT" && ! grep -Fq 'PASS ' <<<"$OUTPUT" && echo 0 || echo 1)"

MISSING_MANIFEST="$FIXTURE_ROOT/missing-manifest"
set +e
OUTPUT="$(TMPDIR="$RUN_TMPDIR" bash "$RUNNER" --manifest "$MISSING_MANIFEST" --test-dir "$TEST_DIR" 2>&1)"
MISSING_MANIFEST_EXIT=$?
set -e
assert 'runner refuses an unreadable manifest before scripts run' \
  "$([ "$MISSING_MANIFEST_EXIT" -ne 0 ] && grep -Fqx "UNREADABLE MANIFEST: $MISSING_MANIFEST" <<<"$OUTPUT" && ! grep -Fq 'PASS ' <<<"$OUTPUT" && echo 0 || echo 1)"

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
