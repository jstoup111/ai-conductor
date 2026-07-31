#!/usr/bin/env bash
set -uo pipefail

# Acceptance specs for the repository-owned half of
# .docs/stories/browsable-documentation-site.md (Stories 1-5, 8, and 9).
# Covers: FR-1, FR-2, FR-3, FR-4, FR-5, FR-8, FR-9
#
# The production entry point is the planned offline navigation checker. These
# specs drive it against both the real repository tree and complete/invalid
# documentation trees; they do not invoke Jekyll, GitHub, or the network.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKER="$SCRIPT_DIR/check_docs_navigation.sh"

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

run_checker() {
  local root=$1
  bash "$CHECKER" "$root" 2>&1
}

write_valid_fixture() {
  local root=$1
  mkdir -p \
    "$root/docs/guides" \
    "$root/docs/reference" \
    "$root/docs/explanation" \
    "$root/docs/runbooks" \
    "$root/docs/contributing"

  cat > "$root/docs/_config.yml" <<'YAML'
title: AI Conductor Documentation
url: https://jstoup111.github.io
baseurl: /ai-conductor
remote_theme: just-the-docs/just-the-docs@v0.12.0
aux_links:
  Repository: https://github.com/jstoup111/ai-conductor
YAML

  cat > "$root/docs/index.md" <<'MARKDOWN'
---
title: AI Conductor Documentation
nav_order: 1
---

# AI Conductor Documentation

Learn how to use and contribute to AI Conductor.

- [Quickstart](quickstart.md)
- [Guides](guides/)
- [Reference](reference/)
- [Explanation](explanation/)
- [Runbooks](runbooks/)
- [Contributing](contributing/)
MARKDOWN

  cat > "$root/docs/quickstart.md" <<'MARKDOWN'
---
title: Quickstart
nav_order: 2
---

# Quickstart
MARKDOWN

  local section
  local order=3
  for section in Guides Reference Explanation Runbooks Contributing; do
    local directory
    directory="$(printf '%s' "$section" | tr '[:upper:]' '[:lower:]')"
    cat > "$root/docs/$directory/index.md" <<MARKDOWN
---
title: $section
nav_order: $order
has_children: true
---

# $section
MARKDOWN
    order=$((order + 1))
  done

  cat > "$root/docs/guides/first-feature.md" <<'MARKDOWN'
---
title: First Feature
parent: Guides
nav_order: 1
---

# First Feature
MARKDOWN
}

expect_checker_failure() {
  local description=$1
  local root=$2
  local expected=$3
  local output
  local status

  output="$(run_checker "$root")"
  status=$?

  if [ "$status" -ne 0 ] && printf '%s' "$output" | grep -qF "$expected"; then
    record "$description" 0
  else
    printf '%s\n' "$output"
    record "$description" 1
  fi
}

FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT

printf '\n=== Stories 1-5: hosted source and navigation hierarchy ===\n'

VALID_ROOT="$FIXTURE_ROOT/valid"
write_valid_fixture "$VALID_ROOT"

VALID_OUTPUT="$(run_checker "$VALID_ROOT")"
VALID_STATUS=$?
record "a complete landing, taxonomy, and topic hierarchy passes" "$([ "$VALID_STATUS" -eq 0 ] && echo 0 || echo 1)"
if [ "$VALID_STATUS" -ne 0 ]; then
  printf '%s\n' "$VALID_OUTPUT"
fi

REAL_OUTPUT="$(run_checker "$REPO_ROOT")"
REAL_STATUS=$?
record "the maintained repository tree has no missing or ambiguous navigation membership" "$([ "$REAL_STATUS" -eq 0 ] && echo 0 || echo 1)"
if [ "$REAL_STATUS" -ne 0 ]; then
  printf '%s\n' "$REAL_OUTPUT"
fi

MISSING_CONFIG="$FIXTURE_ROOT/missing-config"
cp -R "$VALID_ROOT" "$MISSING_CONFIG"
rm "$MISSING_CONFIG/docs/_config.yml"
expect_checker_failure "missing site configuration names docs/_config.yml" "$MISSING_CONFIG" "docs/_config.yml"

MOVING_THEME="$FIXTURE_ROOT/moving-theme"
cp -R "$VALID_ROOT" "$MOVING_THEME"
sed -i 's#just-the-docs/just-the-docs@v0.12.0#just-the-docs/just-the-docs#' "$MOVING_THEME/docs/_config.yml"
expect_checker_failure "an unpinned presentation dependency is rejected" "$MOVING_THEME" "remote_theme"

MISSING_SECTION="$FIXTURE_ROOT/missing-section"
cp -R "$VALID_ROOT" "$MISSING_SECTION"
rm "$MISSING_SECTION/docs/runbooks/index.md"
expect_checker_failure "a missing required section names its hosted index" "$MISSING_SECTION" "docs/runbooks/index.md"

MISSING_METADATA="$FIXTURE_ROOT/missing-metadata"
cp -R "$VALID_ROOT" "$MISSING_METADATA"
sed -i '/^---$/,/^---$/d' "$MISSING_METADATA/docs/guides/first-feature.md"
expect_checker_failure "a topic without navigation metadata names the topic" "$MISSING_METADATA" "docs/guides/first-feature.md"

ORPHAN="$FIXTURE_ROOT/orphan"
cp -R "$VALID_ROOT" "$ORPHAN"
printf '# Unregistered topic\n' > "$ORPHAN/docs/guides/orphan.md"
expect_checker_failure "an orphaned topic fails with its repository path" "$ORPHAN" "docs/guides/orphan.md"

AMBIGUOUS="$FIXTURE_ROOT/ambiguous"
cp -R "$VALID_ROOT" "$AMBIGUOUS"
cat > "$AMBIGUOUS/docs/guides/duplicate.md" <<'MARKDOWN'
---
title: First Feature
parent: Guides
nav_order: 2
---

# Duplicate
MARKDOWN
expect_checker_failure "duplicate sibling membership is rejected by path" "$AMBIGUOUS" "docs/guides/duplicate.md"

BROKEN_TARGET="$FIXTURE_ROOT/broken-target"
cp -R "$VALID_ROOT" "$BROKEN_TARGET"
sed -i 's#(guides/)#(missing-guides/)#' "$BROKEN_TARGET/docs/index.md"
expect_checker_failure "a broken hosted landing target names the landing page" "$BROKEN_TARGET" "docs/index.md"

printf '\n=== Story 8: repository front door retains both hosted and source navigation ===\n'

README_PATH="$REPO_ROOT/README.md"
record "README prominently links the public documentation root" \
  "$(grep -qF 'https://jstoup111.github.io/ai-conductor/' "$README_PATH" && echo 0 || echo 1)"
record "README retains direct in-repository documentation links" \
  "$(grep -qF 'docs/quickstart.md' "$README_PATH" && grep -qF 'docs/reference/' "$README_PATH" && echo 0 || echo 1)"

printf '\n=== Story 5: repository Markdown remains authoritative ===\n'

record "generated site output is not committed as an authoritative source" \
  "$([ ! -e "$REPO_ROOT/docs/_site" ] && [ ! -e "$REPO_ROOT/_site" ] && echo 0 || echo 1)"

printf '\n=== Summary: %s/%s assertions passed ===\n' "$PASS" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
