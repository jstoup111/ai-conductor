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
  local output
  local status
  local expected
  local expected_output=0

  shift 2

  output="$(run_checker "$root")"
  status=$?

  for expected in "$@"; do
    if ! printf '%s' "$output" | grep -qF "$expected"; then
      expected_output=1
    fi
  done

  if [ "$status" -ne 0 ] && [ "$expected_output" -eq 0 ]; then
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

MISSING_CONFIG="$FIXTURE_ROOT/missing-config"
cp -R "$VALID_ROOT" "$MISSING_CONFIG"
rm "$MISSING_CONFIG/docs/_config.yml"
expect_checker_failure "missing site configuration names its path and key" "$MISSING_CONFIG" \
  "docs/_config.yml" "remote_theme"

MISSING_THEME="$FIXTURE_ROOT/missing-theme"
cp -R "$VALID_ROOT" "$MISSING_THEME"
sed -i '/^remote_theme:/d' "$MISSING_THEME/docs/_config.yml"
expect_checker_failure "a missing theme names its configuration and key" "$MISSING_THEME" \
  "docs/_config.yml" "remote_theme"

MOVING_THEME="$FIXTURE_ROOT/moving-theme"
cp -R "$VALID_ROOT" "$MOVING_THEME"
sed -i 's#just-the-docs/just-the-docs@v0.12.0#just-the-docs/just-the-docs#' "$MOVING_THEME/docs/_config.yml"
expect_checker_failure "a moving theme reference names its configuration and key" "$MOVING_THEME" \
  "docs/_config.yml" "remote_theme"

WRONG_PIN="$FIXTURE_ROOT/wrong-pin"
cp -R "$VALID_ROOT" "$WRONG_PIN"
sed -i 's#just-the-docs/just-the-docs@v0.12.0#just-the-docs/just-the-docs@v0X12Y0#' "$WRONG_PIN/docs/_config.yml"
expect_checker_failure "a wrong theme pin names its configuration and key" "$WRONG_PIN" \
  "docs/_config.yml" "remote_theme"

printf '\n=== Stories 1-3, 5-7: maintained site source ===\n'

SOURCE_CONFIG="$REPO_ROOT/docs/_config.yml"
SOURCE_LANDING="$REPO_ROOT/docs/index.md"

record "source configuration pins the approved Pages theme and URL" \
  "$( [ -f "$SOURCE_CONFIG" ] && \
    grep -Fxq 'remote_theme: just-the-docs/just-the-docs@v0.12.0' "$SOURCE_CONFIG" && \
    grep -Fxq 'url: https://jstoup111.github.io' "$SOURCE_CONFIG" && \
    grep -Fxq 'baseurl: /ai-conductor' "$SOURCE_CONFIG" && echo 0 || echo 1 )"
record "source configuration identifies AI Conductor and enables navigation" \
  "$( [ -f "$SOURCE_CONFIG" ] && \
    grep -Fxq 'title: AI Conductor Documentation' "$SOURCE_CONFIG" && \
    grep -Fxq 'nav_enabled: true' "$SOURCE_CONFIG" && \
    grep -Fxq 'aux_links:' "$SOURCE_CONFIG" && \
    grep -Fxq '  Repository: https://github.com/jstoup111/ai-conductor' "$SOURCE_CONFIG" && echo 0 || echo 1 )"
record "source landing links every top-level documentation taxonomy" \
  "$( [ -f "$SOURCE_LANDING" ] && \
    grep -Fxq -- '- [Quickstart](quickstart.md)' "$SOURCE_LANDING" && \
    grep -Fxq -- '- [Guides](guides/)' "$SOURCE_LANDING" && \
    grep -Fxq -- '- [Reference](reference/)' "$SOURCE_LANDING" && \
    grep -Fxq -- '- [Explanation](explanation/)' "$SOURCE_LANDING" && \
    grep -Fxq -- '- [Runbooks](runbooks/)' "$SOURCE_LANDING" && \
    grep -Fxq -- '- [Contributing](contributing/)' "$SOURCE_LANDING" && echo 0 || echo 1 )"

source_has_top_level_destination() {
  local path=$1
  local title=$2
  local order=$3
  local has_children=${4:-false}

  [ -f "$REPO_ROOT/docs/$path" ] && \
    grep -Fxq "title: $title" "$REPO_ROOT/docs/$path" && \
    grep -Fxq "nav_order: $order" "$REPO_ROOT/docs/$path" && \
    ! grep -q '^parent:' "$REPO_ROOT/docs/$path" && \
    { [ "$has_children" = false ] || grep -Fxq 'has_children: true' "$REPO_ROOT/docs/$path"; }
}

record "source top-level destinations have unique titles and stable order" \
  "$( source_has_top_level_destination 'quickstart.md' 'Quickstart' 2 && \
    source_has_top_level_destination 'guides/index.md' 'Guides' 3 true && \
    source_has_top_level_destination 'reference/index.md' 'Reference' 4 true && \
    source_has_top_level_destination 'explanation/index.md' 'Explanation' 5 true && \
    source_has_top_level_destination 'runbooks/index.md' 'Runbooks' 6 true && \
    source_has_top_level_destination 'contributing/index.md' 'Contributing' 7 true && echo 0 || echo 1 )"

source_has_guide_destination() {
  local path=$1
  local title=$2
  local order=$3

  [ -f "$REPO_ROOT/docs/guides/$path" ] && \
    grep -Fxq "title: $title" "$REPO_ROOT/docs/guides/$path" && \
    grep -Fxq 'parent: Guides' "$REPO_ROOT/docs/guides/$path" && \
    grep -Fxq "nav_order: $order" "$REPO_ROOT/docs/guides/$path"
}

record "source guides have unique titles, the Guides parent, and stable order" \
  "$( source_has_guide_destination 'first-feature.md' 'Ship your first feature' 1 && \
    source_has_guide_destination 'engineer-loop.md' 'The engineer loop' 2 && \
    source_has_guide_destination 'intake.md' 'Filing intake issues' 3 && \
    source_has_guide_destination 'multiprovider.md' 'Choose and configure the LLM host' 4 && \
    source_has_guide_destination 'running-the-daemon.md' 'Running the daemon' 5 && \
    source_has_guide_destination 'self-hosting.md' 'Self-hosting the harness' 6 && echo 0 || echo 1 )"

source_has_reference_destination() {
  local path=$1
  local title=$2
  local order=$3

  [ -f "$REPO_ROOT/docs/reference/$path" ] && \
    grep -Fxq "title: $title" "$REPO_ROOT/docs/reference/$path" && \
    grep -Fxq 'parent: Reference' "$REPO_ROOT/docs/reference/$path" && \
    grep -Fxq "nav_order: $order" "$REPO_ROOT/docs/reference/$path"
}

record "core reference topics have unique titles, the Reference parent, and stable order" \
  "$( source_has_reference_destination 'artifacts.md' 'Artifacts and state files' 1 && \
    source_has_reference_destination 'cli.md' '`conduct-ts` CLI reference' 2 && \
    source_has_reference_destination 'configuration.md' 'Configuration reference' 3 && \
    source_has_reference_destination 'environment.md' 'Environment variables' 4 && echo 0 || echo 1 )"

record "remaining reference topics have unique titles, the Reference parent, and stable order" \
  "$( source_has_reference_destination 'models.md' 'Model and effort resolution' 5 && \
    source_has_reference_destination 'settings-and-hooks.md' 'Settings and hooks' 6 && \
    source_has_reference_destination 'skills.md' 'Skills' 7 && \
    source_has_reference_destination 'steps.md' 'Steps' 8 && echo 0 || echo 1 )"

source_has_explanation_destination() {
  local path=$1
  local title=$2
  local order=$3

  [ -f "$REPO_ROOT/docs/explanation/$path" ] && \
    grep -Fxq "title: $title" "$REPO_ROOT/docs/explanation/$path" && \
    grep -Fxq 'parent: Explanation' "$REPO_ROOT/docs/explanation/$path" && \
    grep -Fxq "nav_order: $order" "$REPO_ROOT/docs/explanation/$path"
}

record "explanation topics have unique titles, the Explanation parent, and stable order" \
  "$( source_has_explanation_destination 'architecture.md' 'Architecture' 1 && \
    source_has_explanation_destination 'evidence-model.md' 'Evidence model' 2 && \
    source_has_explanation_destination 'gates.md' 'Gates' 3 && \
    source_has_explanation_destination 'sdlc-phases.md' 'SDLC phases' 4 && echo 0 || echo 1 )"

source_has_runbook_destination() {
  local path=$1
  local title=$2
  local order=$3

  [ -f "$REPO_ROOT/docs/runbooks/$path" ] && \
    grep -Fxq "title: $title" "$REPO_ROOT/docs/runbooks/$path" && \
    grep -Fxq 'parent: Runbooks' "$REPO_ROOT/docs/runbooks/$path" && \
    grep -Fxq "nav_order: $order" "$REPO_ROOT/docs/runbooks/$path"
}

record "runbooks have unique titles, the Runbooks parent, and stable order" \
  "$( source_has_runbook_destination 'daemon-recovery.md' 'Daemon recovery' 1 && \
    source_has_runbook_destination 'emergency-stop-a-running-feature.md' 'Emergency stop a running feature' 2 && \
    source_has_runbook_destination 'shipped-record-reconciliation.md' 'Shipped record reconciliation' 3 && \
    source_has_runbook_destination 'stalled-or-stuck-feature.md' 'Stalled or stuck feature' 4 && \
    source_has_runbook_destination 'worktree-and-evidence-recovery.md' 'Worktree and evidence recovery' 5 && echo 0 || echo 1 )"

source_has_contributing_destination() {
  local path=$1
  local title=$2
  local order=$3

  [ -f "$REPO_ROOT/docs/contributing/$path" ] && \
    grep -Fxq "title: $title" "$REPO_ROOT/docs/contributing/$path" && \
    grep -Fxq 'parent: Contributing' "$REPO_ROOT/docs/contributing/$path" && \
    grep -Fxq "nav_order: $order" "$REPO_ROOT/docs/contributing/$path"
}

record "core contributing topics have unique titles, the Contributing parent, and stable order" \
  "$( source_has_contributing_destination 'code-organization.md' 'Code organization' 1 && \
    source_has_contributing_destination 'extending.md' 'Extending the harness' 2 && \
    source_has_contributing_destination 'releases.md' 'Releases' 3 && echo 0 || echo 1 )"

record "remaining contributing topics and Quickstart have unique stable navigation" \
  "$( source_has_contributing_destination 'testing.md' 'Testing' 4 && \
    source_has_contributing_destination 'validation.md' 'Validation' 5 && \
    source_has_top_level_destination 'quickstart.md' 'Quickstart' 2 && echo 0 || echo 1 )"

integrity_runs_full_navigation_contract() {
  local integrity_path="$REPO_ROOT/test/test_harness_integrity.sh"

  [ -f "$integrity_path" ] && \
    grep -Fq 'docs_navigation_test="${HARNESS_DIR}/test/test_docs_navigation.sh"' "$integrity_path" && \
    grep -Fq 'docs_navigation_output=$(bash "$docs_navigation_test" --site-contract 2>&1)' "$integrity_path" && \
    awk '/navigation-contract/ { fixture_contract_line = NR } /REAL_OUTPUT=/ { real_tree_line = NR } /site-contract/ { site_contract_line = NR } END { exit !(fixture_contract_line > 0 && real_tree_line > fixture_contract_line && site_contract_line > real_tree_line) }' "$0"
}

record "integrity runs the fixture-driven navigation test through its real-tree check" \
  "$( integrity_runs_full_navigation_contract && echo 0 || echo 1 )"

if [ "${1:-}" = '--config-contract' ]; then
  printf '\n=== Summary: %s/%s assertions passed ===\n' "$PASS" "$TOTAL"
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
  exit 0
fi

printf '\n=== Stories 1-2: hosted landing and section destinations ===\n'

MISSING_LANDING="$FIXTURE_ROOT/missing-landing"
cp -R "$VALID_ROOT" "$MISSING_LANDING"
rm "$MISSING_LANDING/docs/index.md"
expect_checker_failure "a missing landing page names its hosted path" "$MISSING_LANDING" \
  "docs/index.md"

MISSING_SECTION="$FIXTURE_ROOT/missing-section"
cp -R "$VALID_ROOT" "$MISSING_SECTION"
rm "$MISSING_SECTION/docs/runbooks/index.md"
expect_checker_failure "a missing required section names its hosted index" "$MISSING_SECTION" \
  "docs/runbooks/index.md"

BROKEN_TARGET="$FIXTURE_ROOT/broken-target"
cp -R "$VALID_ROOT" "$BROKEN_TARGET"
sed -i 's#(guides/)#(https://github.com/jstoup111/ai-conductor/blob/main/docs/guides/index.md)#' \
  "$BROKEN_TARGET/docs/index.md"
expect_checker_failure "a non-hosted landing target names the landing page" "$BROKEN_TARGET" \
  "docs/index.md"

if [ "${1:-}" = '--landing-contract' ]; then
  printf '\n=== Summary: %s/%s assertions passed ===\n' "$PASS" "$TOTAL"
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
  exit 0
fi

MISSING_METADATA="$FIXTURE_ROOT/missing-metadata"
cp -R "$VALID_ROOT" "$MISSING_METADATA"
sed -i '/^---$/,/^---$/d' "$MISSING_METADATA/docs/guides/first-feature.md"
expect_checker_failure "missing front matter names the topic" "$MISSING_METADATA" \
  "docs/guides/first-feature.md"

MISSING_TITLE="$FIXTURE_ROOT/missing-title"
cp -R "$VALID_ROOT" "$MISSING_TITLE"
sed -i '/^title: First Feature$/d' "$MISSING_TITLE/docs/guides/first-feature.md"
expect_checker_failure "missing title names the topic" "$MISSING_TITLE" \
  "docs/guides/first-feature.md"

EMPTY_TITLE="$FIXTURE_ROOT/empty-title"
cp -R "$VALID_ROOT" "$EMPTY_TITLE"
sed -i 's/^title: First Feature$/title:/' "$EMPTY_TITLE/docs/guides/first-feature.md"
expect_checker_failure "an empty title names the topic" "$EMPTY_TITLE" \
  "docs/guides/first-feature.md"

MISSING_PARENT="$FIXTURE_ROOT/missing-parent"
cp -R "$VALID_ROOT" "$MISSING_PARENT"
sed -i '/^parent: Guides$/d' "$MISSING_PARENT/docs/guides/first-feature.md"
expect_checker_failure "a nested topic without a parent names the topic" "$MISSING_PARENT" \
  "docs/guides/first-feature.md"

UNKNOWN_PARENT="$FIXTURE_ROOT/unknown-parent"
cp -R "$VALID_ROOT" "$UNKNOWN_PARENT"
sed -i 's/^parent: Guides$/parent: Missing Guide Section/' \
  "$UNKNOWN_PARENT/docs/guides/first-feature.md"
expect_checker_failure "an unknown parent names the topic" "$UNKNOWN_PARENT" \
  "docs/guides/first-feature.md"

ORPHAN="$FIXTURE_ROOT/orphan"
cp -R "$VALID_ROOT" "$ORPHAN"
cat > "$ORPHAN/docs/orphan.md" <<'MARKDOWN'
---
title: Unregistered Topic
nav_order: 99
---

# Unregistered Topic
MARKDOWN
expect_checker_failure "an orphaned topic fails with its repository path" "$ORPHAN" "docs/orphan.md"

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

if [ "${1:-}" = '--navigation-contract' ]; then
  printf '\n=== Summary: %s/%s assertions passed ===\n' "$PASS" "$TOTAL"
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
  exit 0
fi

REAL_OUTPUT="$(run_checker "$REPO_ROOT")"
REAL_STATUS=$?
record "the maintained repository tree has no missing or ambiguous navigation membership" \
  "$([ "$REAL_STATUS" -eq 0 ] && echo 0 || echo 1)"
if [ "$REAL_STATUS" -ne 0 ]; then
  printf '%s\n' "$REAL_OUTPUT"
fi

if [ "${1:-}" = '--site-contract' ]; then
  printf '\n=== Summary: %s/%s assertions passed ===\n' "$PASS" "$TOTAL"
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
  exit 0
fi

printf '\n=== Story 8: repository front door retains both hosted and source navigation ===\n'

README_PATH="$REPO_ROOT/README.md"
README_DOCUMENTATION_SECTION="$(awk '
  /^## Documentation$/ { capture = 1; next }
  capture && /^## / { exit }
  capture { print }
' "$README_PATH")"
record "README Documentation starts with the hosted landing while retaining categorized source links" \
  "$( [ "$(printf '%s\n' "$README_DOCUMENTATION_SECTION" | sed '/^$/d' | head -n 1)" = '[Browse the hosted documentation](https://jstoup111.github.io/ai-conductor/)' ] && \
    printf '%s\n' "$README_DOCUMENTATION_SECTION" | grep -Fxq -- '- [Quickstart](docs/quickstart.md) — prerequisites, install, and your first working run' && \
    printf '%s\n' "$README_DOCUMENTATION_SECTION" | grep -Fxq '**Guides** — task-oriented procedures' && \
    printf '%s\n' "$README_DOCUMENTATION_SECTION" | grep -Fxq '**Reference** — exact interfaces' && \
    printf '%s\n' "$README_DOCUMENTATION_SECTION" | grep -Fxq '**Explanation** — how and why the system is shaped this way' && \
    printf '%s\n' "$README_DOCUMENTATION_SECTION" | grep -Fxq '**Runbooks** — when something breaks' && \
    printf '%s\n' "$README_DOCUMENTATION_SECTION" | grep -Fxq '**Contributing** — modifying the harness itself' && echo 0 || echo 1 )"
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
