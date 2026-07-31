#!/usr/bin/env bash
set -uo pipefail

# Acceptance specs for the GitHub Pages boundary in
# .docs/stories/browsable-documentation-site.md (Stories 1, 5-9).
# Covers: FR-1, FR-5, FR-6, FR-7, FR-8, FR-9
#
# The real opt-in probe is the production entry point. Every ordinary test
# below replaces gh and curl at the process boundary with deterministic fakes.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SMOKE_SCRIPT="$SCRIPT_DIR/docs_pages.smoke.test.sh"

PASS=0
FAIL=0
TOTAL=0

record() {
  local description=$1
  local result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    printf '  PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf '  FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  fi
}

FAKE_ROOT="$(mktemp -d)"
FAKE_BIN="$FAKE_ROOT/bin"
MODE_FILE="$FAKE_ROOT/mode"
CALLS_FILE="$FAKE_ROOT/calls"
mkdir -p "$FAKE_BIN"
: > "$CALLS_FILE"

ORIGINAL_PATH=$PATH
trap 'export PATH="$ORIGINAL_PATH"; rm -rf "$FAKE_ROOT"' EXIT

cat > "$FAKE_BIN/gh" <<'BASH'
#!/usr/bin/env bash
set -uo pipefail
mode="$(cat "$DOCS_PAGES_FAKE_MODE_FILE")"
printf 'gh %s\n' "$*" >> "$DOCS_PAGES_FAKE_CALLS_FILE"

jq_filter=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "--jq" ]; then
    jq_filter=$argument
    break
  fi
  previous=$argument
done

branch=main
path=/docs
status=built
if [ "$mode" = "source-wrong" ]; then branch=preview; fi
if [ "$mode" = "deployment-failed" ]; then status=errored; fi

case "$jq_filter" in
  *source.branch*) printf '%s\n' "$branch" ;;
  *source.path*) printf '%s\n' "$path" ;;
  *status*|*state*) printf '%s\n' "$status" ;;
  *html_url*) printf '%s\n' 'https://jstoup111.github.io/ai-conductor/' ;;
  *)
    if [ "$mode" = "deployment-missing" ] && [[ "$*" == *build* || "$*" == *deployment* ]]; then
      printf '[]\n'
    elif [ "$mode" = "deployment-spaced" ]; then
      printf '{\n  "status" : "%s",\n  "state" : "%s",\n  "source" : { "branch" : "%s", "path" : "%s" }\n}\n' \
        "$status" "$status" "$branch" "$path"
    else
      printf '{"status":"%s","state":"%s","source":{"branch":"%s","path":"%s"},"html_url":"https://jstoup111.github.io/ai-conductor/"}\n' \
        "$status" "$status" "$branch" "$path"
    fi
    ;;
esac
BASH
chmod +x "$FAKE_BIN/gh"

cat > "$FAKE_BIN/curl" <<'BASH'
#!/usr/bin/env bash
set -uo pipefail
mode="$(cat "$DOCS_PAGES_FAKE_MODE_FILE")"
printf 'curl %s\n' "$*" >> "$DOCS_PAGES_FAKE_CALLS_FILE"

url="${!#}"
output_file=""
write_out=""
fail_on_http=0
previous=""
for argument in "$@"; do
  if [ "$previous" = "output" ]; then output_file=$argument; previous=""; continue; fi
  if [ "$previous" = "write" ]; then write_out=$argument; previous=""; continue; fi
  case "$argument" in
    -o|--output) previous=output ;;
    -w|--write-out) previous=write ;;
    -*f*) fail_on_http=1 ;;
  esac
done

status=200
if [ "$mode" = "root-non-200" ]; then status=404; fi

if [[ "$url" == */ai-conductor/ || "$url" == */ai-conductor ]]; then
  if [ "$mode" = "missing-identity" ]; then
    body='<html><title>Generic site</title><body>Nothing to see</body></html>'
  else
    body='<html><title>AI Conductor Documentation</title><body>Quickstart Guides Reference Explanation Runbooks Contributing</body></html>'
  fi
else
  if [ "$mode" = "topic-mismatch" ]; then
    body='<html><body>stale hosted topic</body></html>'
  else
    body="$(cat "$DOCS_PAGES_FAKE_REPO_ROOT/docs/quickstart.md")"
  fi
fi

if [ -n "$output_file" ]; then
  printf '%s' "$body" > "$output_file"
else
  printf '%s' "$body"
fi

if [ -n "$write_out" ]; then
  printf '%s' "${write_out//\%\{http_code\}/$status}"
fi

if [ "$status" -ge 400 ] && [ "$fail_on_http" -eq 1 ]; then
  exit 22
fi
BASH
chmod +x "$FAKE_BIN/curl"

export PATH="$FAKE_BIN:$PATH"
export DOCS_PAGES_FAKE_MODE_FILE="$MODE_FILE"
export DOCS_PAGES_FAKE_CALLS_FILE="$CALLS_FILE"
export DOCS_PAGES_FAKE_REPO_ROOT="$REPO_ROOT"

run_probe() {
  local mode=$1
  printf '%s\n' "$mode" > "$MODE_FILE"
  : > "$CALLS_FILE"
  bash "$SMOKE_SCRIPT" 2>&1
}

expect_probe_failure() {
  local mode=$1
  local description=$2
  local expected_pattern=$3
  local output
  local status

  output="$(run_probe "$mode")"
  status=$?

  if [ "$status" -ne 0 ] && printf '%s' "$output" | grep -Eqi "$expected_pattern"; then
    record "$description" 0
  else
    printf '%s\n' "$output"
    record "$description" 1
  fi
}

printf '\n=== Stories 1, 5, 6, and 8: successful publication evidence ===\n'

SUCCESS_OUTPUT="$(run_probe success)"
SUCCESS_STATUS=$?
record "a successful default-branch deployment exposes the landing page and merged topic" \
  "$([ "$SUCCESS_STATUS" -eq 0 ] && echo 0 || echo 1)"
if [ "$SUCCESS_STATUS" -ne 0 ]; then
  printf '%s\n' "$SUCCESS_OUTPUT"
fi
record "the probe obtains deployment evidence through the fake GitHub boundary" \
  "$(grep -q '^gh ' "$CALLS_FILE" && echo 0 || echo 1)"
record "the probe obtains hosted content through the fake HTTP boundary" \
  "$(grep -q '^curl ' "$CALLS_FILE" && echo 0 || echo 1)"

SPACED_OUTPUT="$(run_probe deployment-spaced)"
SPACED_STATUS=$?
record "a whitespace-formatted successful deployment is accepted" \
  "$( [ "$SPACED_STATUS" -eq 0 ] && echo 0 || echo 1 )"
if [ "$SPACED_STATUS" -ne 0 ]; then
  printf '%s\n' "$SPACED_OUTPUT"
fi

printf '\n=== Stories 1 and 9: failed delivery stays visible ===\n'

expect_probe_failure root-non-200 \
  "a non-success public root is rejected" \
  'HTTP|root|404'
expect_probe_failure missing-identity \
  "a generic root without AI Conductor identity or taxonomy is rejected" \
  'identity|title|taxonomy|AI Conductor'
expect_probe_failure deployment-failed \
  "a failed Pages deployment is reported as failed" \
  'deployment|build|failed|errored'
expect_probe_failure deployment-missing \
  "a missing default-branch deployment event is reported" \
  'deployment|build|missing|not found'

printf '\n=== Stories 5 and 7: hosted prose and source provenance ===\n'

expect_probe_failure topic-mismatch \
  "hosted prose that differs from merged Markdown is rejected" \
  'topic|content|marker|mismatch'
expect_probe_failure source-wrong \
  "a non-default publication source is rejected" \
  'source|branch|main|default'

INTEGRITY_TEST="$REPO_ROOT/test/test_harness_integrity.sh"
record "integrity executes the deterministic fake-adapter smoke suite" \
  "$( [ -f "$INTEGRITY_TEST" ] && \
    grep -Fq 'docs_pages_smoke_test="${HARNESS_DIR}/test/test_docs_pages_smoke.sh"' "$INTEGRITY_TEST" && \
    grep -Fq 'docs_pages_smoke_output=$(bash "$docs_pages_smoke_test" 2>&1)' "$INTEGRITY_TEST" && echo 0 || echo 1 )"

printf '\n=== Summary: %s/%s assertions passed ===\n' "$PASS" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
