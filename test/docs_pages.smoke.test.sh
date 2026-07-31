#!/usr/bin/env bash
set -uo pipefail

# Opt-in GitHub Pages smoke probe. Run manually after a default-branch
# deployment; ordinary tests replace gh and curl with deterministic fakes.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPOSITORY='jstoup111/ai-conductor'
PUBLIC_ROOT='https://jstoup111.github.io/ai-conductor/'
QUICKSTART_SOURCE="$REPO_ROOT/docs/quickstart.md"
TEMP_ROOT="$(mktemp -d)"
ROOT_BODY="$TEMP_ROOT/root.html"
QUICKSTART_BODY="$TEMP_ROOT/quickstart.html"
FAIL=0

trap 'rm -rf "$TEMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  FAIL=1
}

expect_exact() {
  local actual=$1
  local expected=$2
  local contract=$3

  if [ "$actual" != "$expected" ]; then
    fail "$contract: expected '$expected', got '$actual'"
  fi
}

check_pages_source() {
  local branch path

  branch="$(gh api "repos/$REPOSITORY/pages" --jq '.source.branch' 2>&1)"
  if [ "$?" -ne 0 ]; then
    fail "Pages source branch check failed: $branch"
    return
  fi
  expect_exact "$branch" 'main' 'Pages source branch check failed'

  path="$(gh api "repos/$REPOSITORY/pages" --jq '.source.path' 2>&1)"
  if [ "$?" -ne 0 ]; then
    fail "Pages source path check failed: $path"
    return
  fi
  expect_exact "$path" '/docs' 'Pages source path check failed'
}

check_landing_page() {
  local curl_output curl_exit root_status marker

  curl_output="$(curl --fail --silent --show-error --output "$ROOT_BODY" --write-out '%{http_code}' "$PUBLIC_ROOT" 2>&1)"
  curl_exit=$?
  root_status="$curl_output"
  if [ "$curl_exit" -ne 0 ] || [ "$root_status" != '200' ]; then
    fail "Public root check failed: expected HTTP 200 (curl exit $curl_exit; response $root_status)"
    return
  fi

  if ! grep -Fq 'AI Conductor Documentation' "$ROOT_BODY"; then
    fail 'Landing identity check failed: expected AI Conductor Documentation title'
  fi

  for marker in Quickstart Guides Reference Explanation Runbooks Contributing; do
    if ! grep -Fq "$marker" "$ROOT_BODY"; then
      fail "Landing taxonomy check failed: missing $marker"
    fi
  done
}

check_quickstart_content() {
  local marker curl_output curl_exit

  marker="$(awk '/^# Quickstart$/ { found = 1; next } found && NF { print; exit }' "$QUICKSTART_SOURCE")"
  if [ -z "$marker" ]; then
    fail 'Quickstart content check failed: source marker is missing'
    return
  fi

  curl_output="$(curl --fail --silent --show-error --output "$QUICKSTART_BODY" 'https://jstoup111.github.io/ai-conductor/quickstart/' 2>&1)"
  curl_exit=$?
  if [ "$curl_exit" -ne 0 ]; then
    fail "Quickstart content check failed: hosted request failed ($curl_output)"
    return
  fi

  if ! grep -Fq "$marker" "$QUICKSTART_BODY"; then
    fail "Quickstart content check failed: source marker mismatch ($marker)"
  fi
}

check_deployment() {
  local deployments status

  deployments="$(gh api "repos/$REPOSITORY/pages/builds" 2>&1)"
  if [ "$?" -ne 0 ]; then
    fail "Pages deployment check failed: $deployments"
    return
  fi
  if [ "$deployments" = '[]' ] || [ -z "$deployments" ]; then
    fail 'Pages deployment check failed: default-branch build is missing'
    return
  fi

  status="$(printf '%s\n' "$deployments" | sed -nE 's/.*"status"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -n 1)"
  if [ -z "$status" ]; then
    status="$(printf '%s\n' "$deployments" | sed -nE 's/.*"state"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' | head -n 1)"
  fi
  case "$status" in
    built|success|completed) ;;
    *) fail "Pages deployment check failed: expected successful build, got $status" ;;
  esac
}

check_pages_source
check_landing_page
check_quickstart_content
check_deployment

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

printf 'PASS: GitHub Pages source, landing, Quickstart, and deployment checks succeeded\n'
