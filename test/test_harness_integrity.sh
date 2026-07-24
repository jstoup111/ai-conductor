#!/usr/bin/env bash
set -euo pipefail

# test_harness_integrity.sh — Validates harness structural integrity.
# Checks bash syntax, SKILL.md frontmatter, agent/template references,
# cross-skill references, and HARNESS.md model table completeness.
#
# Usage: ./test/test_harness_integrity.sh
#
# Run before every commit in this repo.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
WARN=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2  # 0 = pass, non-zero = fail
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

warn_check() {
  local desc=$1
  local result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${YELLOW}WARN${NC} ${desc}"
    WARN=$((WARN + 1))
  fi
}

# ── 1. Bash syntax ──────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}1. Bash syntax${NC}"

for script in "${HARNESS_DIR}"/bin/*; do
  [ -f "$script" ] || continue
  name=$(basename "$script")
  # Only check files with bash shebang
  if head -1 "$script" | grep -q "bash"; then
    bash -n "$script" 2>/dev/null
    assert "${name}" $?
  fi
done

# Also check hook scripts
for script in "${HARNESS_DIR}"/hooks/claude/*.sh; do
  [ -f "$script" ] || continue
  name="hooks/claude/$(basename "$script")"
  bash -n "$script" 2>/dev/null
  assert "${name}" $?
done

# Check test scripts
for script in "${HARNESS_DIR}"/test/*.sh; do
  [ -f "$script" ] || continue
  name="test/$(basename "$script")"
  bash -n "$script" 2>/dev/null
  assert "${name}" $?
done

# Check .github/scripts scripts
for script in "${HARNESS_DIR}"/.github/scripts/*.sh; do
  [ -f "$script" ] || continue
  name=".github/scripts/$(basename "$script")"
  bash -n "$script" 2>/dev/null
  assert "${name}" $?
done

# ── 2. SKILL.md frontmatter ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}2. SKILL.md frontmatter${NC}"

REQUIRED_FIELDS=("name" "description" "enforcement" "phase")

for skill_file in "${HARNESS_DIR}"/skills/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  skill_name=$(basename "$(dirname "$skill_file")")

  # Check for frontmatter delimiters
  if ! head -1 "$skill_file" | grep -q "^---$"; then
    assert "${skill_name} — has frontmatter" 1
    continue
  fi

  # Extract frontmatter (between first and second ---)
  frontmatter=$(sed -n '2,/^---$/p' "$skill_file" | head -n -1)

  missing=()
  for field in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$frontmatter" | grep -q "^${field}:"; then
      missing+=("$field")
    fi
  done

  if [ ${#missing[@]} -eq 0 ]; then
    assert "${skill_name}" 0
  else
    assert "${skill_name} — missing: ${missing[*]}" 1
  fi
done

# ── 3. Agent references ─────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}3. Agent references${NC}"

agent_refs=$(grep -roh 'agents/[a-z_-]*\.md' "${HARNESS_DIR}"/skills/ "${HARNESS_DIR}"/HARNESS.md 2>/dev/null | sort -u || true)
if [ -z "$agent_refs" ]; then
  assert "no agent references found" 0
else
  for ref in $agent_refs; do
    if [ -f "${HARNESS_DIR}/${ref}" ]; then
      assert "$ref exists" 0
    else
      assert "$ref — referenced but missing" 1
    fi
  done
fi

# ── 4. Cross-skill references ───────────────────────────────────────────────

echo ""
echo -e "${BOLD}4. Cross-skill references${NC}"

# Known skill names from directory listing
known_skills=()
for d in "${HARNESS_DIR}"/skills/*/; do
  [ -d "$d" ] || continue
  known_skills+=("$(basename "$d")")
done

# Find /skill-name patterns in SKILL.md files and validate
# Extract references like /stories, /conduct, /plan etc.
skill_refs=$(grep -rohE '`/[a-z][-a-z]*`' "${HARNESS_DIR}"/skills/*/SKILL.md 2>/dev/null \
  | sed 's/`//g; s/^\///' | sort -u || true)

for ref in $skill_refs; do
  found=false
  for known in "${known_skills[@]}"; do
    if [ "$ref" = "$known" ]; then
      found=true
      break
    fi
  done
  if [ "$found" = true ]; then
    assert "/${ref} → skills/${ref}/" 0
  else
    # Some refs are commands not skills (e.g., /quit) — warn, don't fail
    warn_check "/${ref} — not a skill directory (may be a command)" 1
  fi
done

# ── 5. HARNESS.md model table ────────────────────────────────────────────────

echo ""
echo -e "${BOLD}5. HARNESS.md model table${NC}"

for skill_name in "${known_skills[@]}"; do
  if grep -qE "\| ${skill_name}[ (|]" "${HARNESS_DIR}/HARNESS.md" 2>/dev/null; then
    assert "${skill_name} in model table" 0
  else
    warn_check "${skill_name} — not in HARNESS.md model selection table" 1
  fi
done

# ── 5a. Model-table drift gate ───────────────────────────────────────────────
# bin/generate-model-table --check validates that HARNESS.md's generated
# model-selection table region matches what the TypeScript generator would
# produce. The tool runs the TS source directly via the local tsx binary
# (src/conductor/node_modules/.bin/tsx), so it's only runnable when
# src/conductor/node_modules has been installed. When absent, this is a
# warn (skip), not a suite-aborting failure — CI/dev environments without
# an npm install in src/conductor/ should still be able to run the rest of
# the suite.
#
# Exit codes (see bin/generate-model-table / generate-model-table.ts):
#   0 - no drift (PASS)
#   1 - drift detected (FAIL, remediation text on stderr/stdout)
#   2 - environment error, e.g. missing tsx binary (FAIL, env error message)

echo ""
echo -e "${BOLD}5a. Model-table drift gate${NC}"

conductor_node_modules="${HARNESS_DIR}/src/conductor/node_modules"
if [ ! -d "$conductor_node_modules" ]; then
  warn_check "src/conductor/node_modules absent — skipping model-table drift check" 1
else
  set +e
  model_table_output=$("${HARNESS_DIR}/bin/generate-model-table" --check 2>&1)
  model_table_exit=$?
  set -e

  case "$model_table_exit" in
    0)
      assert "bin/generate-model-table --check — HARNESS.md model table matches source (no drift)" 0
      ;;
    1)
      echo -e "  ${RED}FAIL${NC} bin/generate-model-table --check — drift detected in HARNESS.md model table"
      echo "$model_table_output" | sed 's/^/    /'
      assert "bin/generate-model-table --check — drift detected in HARNESS.md model table (remediation: run 'bin/generate-model-table' to regenerate)" 1
      ;;
    2)
      echo -e "  ${RED}FAIL${NC} bin/generate-model-table --check — environment error"
      echo "$model_table_output" | sed 's/^/    /'
      assert "bin/generate-model-table --check — environment error (exit 2)" 1
      ;;
    *)
      echo -e "  ${RED}FAIL${NC} bin/generate-model-table --check — unexpected exit code ${model_table_exit}"
      echo "$model_table_output" | sed 's/^/    /'
      assert "bin/generate-model-table --check — unexpected exit code ${model_table_exit}" 1
      ;;
  esac
fi

# ── 5b. SKILL.md pin agreement ──────────────────────────────────────────────
# Consumes `bin/generate-model-table --pins` JSON and compares each
# skills/*/SKILL.md `model:` pin against the engine-expected value. Exempt
# skills (PIN_EXEMPT_SKILLS) pass without comparison; skills with no `model:`
# line are skipped silently (inheriting from session/engine is legal).
# Degrades to WARN (not FAIL) when src/conductor/node_modules is absent, since
# the generator can't run without a local npm install — this is an
# environment-availability skip, not a real integrity failure.

echo ""
echo -e "${BOLD}5b. SKILL.md pin agreement${NC}"

if [ ! -d "${HARNESS_DIR}/src/conductor/node_modules" ]; then
  warn_check "model-table checks skipped — run npm install in src/conductor" 1
elif ! command -v jq >/dev/null 2>&1; then
  warn_check "model-table pin check skipped — jq not installed" 1
else
  if [ -n "${HARNESS_INTEGRITY_TEST_PINS_JSON:-}" ]; then
    pins_json=$HARNESS_INTEGRITY_TEST_PINS_JSON
    pins_exit=0
  else
    set +e
    pins_json=$("${HARNESS_DIR}/bin/generate-model-table" --pins 2>/dev/null)
    pins_exit=$?
    set -e
  fi
  pin_skills_dir="${HARNESS_INTEGRITY_TEST_SKILLS_DIR:-${HARNESS_DIR}/skills}"

  if [ "$pins_exit" -ne 0 ] || ! echo "$pins_json" | jq -e . >/dev/null 2>&1; then
    assert "bin/generate-model-table --pins produced parseable JSON" 1
  else
    for skill_file in "${pin_skills_dir}"/*/SKILL.md; do
      [ -f "$skill_file" ] || continue
      skill_name=$(basename "$(dirname "$skill_file")")

      frontmatter=$(sed -n '2,/^---$/p' "$skill_file" | head -n -1)
      pinned=$({ echo "$frontmatter" | grep -E '^model:' || true; } | head -1 | sed -E 's/^model:[[:space:]]*//' | tr -d '[:space:]')

      if [ -z "$pinned" ]; then
        continue
      fi

      entry=$(echo "$pins_json" | jq -c --arg s "$skill_name" '.[$s] // empty')

      if [ -z "$entry" ]; then
        assert "${skill_name} — pinned '${pinned}' but not present in --pins output (unmapped)" 1
        continue
      fi

      is_exempt=$(echo "$entry" | jq -r '.exempt // false')
      if [ "$is_exempt" = "true" ]; then
        assert "${skill_name} — exempt from pin check" 0
        continue
      fi

      expected=$(echo "$entry" | jq -r '.expected // empty')
      if [ "$pinned" = "$expected" ]; then
        assert "${skill_name} — pin '${pinned}' agrees with expected '${expected}'" 0
      else
        assert "${skill_name} — pin/expected disagreement: pinned='${pinned}' expected='${expected}'" 1
      fi
    done
  fi
fi

# ── 5c. Docs-guard generated-hook drift gate ─────────────────────────────────
# bin/generate-docs-guard-hook --check validates that the committed
# hooks/claude/docs-guard.sh artifact matches what the TypeScript source
# (src/conductor/src/engine/session-hook-assets.ts, via
# src/conductor/src/tools/generate-docs-guard-hook.ts) would produce. Mirrors
# check 5a's exit-code contract and node_modules-absent warn/skip behavior.
#
# Exit codes (see bin/generate-docs-guard-hook / generate-docs-guard-hook.ts):
#   0 - no drift (PASS)
#   1 - drift detected (FAIL, remediation text on stderr/stdout)
#   2 - environment error, e.g. missing tsx binary (FAIL, env error message)

echo ""
echo -e "${BOLD}5c. Docs-guard generated-hook drift gate${NC}"

if [ ! -d "$conductor_node_modules" ]; then
  warn_check "src/conductor/node_modules absent — skipping docs-guard hook drift check" 1
else
  set +e
  docs_guard_hook_output=$("${HARNESS_DIR}/bin/generate-docs-guard-hook" --check 2>&1)
  docs_guard_hook_exit=$?
  set -e

  case "$docs_guard_hook_exit" in
    0)
      assert "bin/generate-docs-guard-hook --check — hooks/claude/docs-guard.sh matches source (no drift)" 0
      ;;
    1)
      echo -e "  ${RED}FAIL${NC} bin/generate-docs-guard-hook --check — drift detected in hooks/claude/docs-guard.sh"
      echo "$docs_guard_hook_output" | sed 's/^/    /'
      assert "bin/generate-docs-guard-hook --check — drift detected in hooks/claude/docs-guard.sh (remediation: run 'bin/generate-docs-guard-hook' to regenerate)" 1
      ;;
    2)
      echo -e "  ${RED}FAIL${NC} bin/generate-docs-guard-hook --check — environment error"
      echo "$docs_guard_hook_output" | sed 's/^/    /'
      assert "bin/generate-docs-guard-hook --check — environment error (exit 2)" 1
      ;;
    *)
      echo -e "  ${RED}FAIL${NC} bin/generate-docs-guard-hook --check — unexpected exit code ${docs_guard_hook_exit}"
      echo "$docs_guard_hook_output" | sed 's/^/    /'
      assert "bin/generate-docs-guard-hook --check — unexpected exit code ${docs_guard_hook_exit}" 1
      ;;
  esac

  # Fixture sub-test: prove --check CAN detect drift. Back up the committed
  # artifact, corrupt the working copy in place, run --check (expect exit 1),
  # then restore byte-for-byte — via trap so a failed assertion still restores.
  docs_guard_hook_path="${HARNESS_DIR}/hooks/claude/docs-guard.sh"
  docs_guard_hook_backup="$(mktemp)"
  cp "$docs_guard_hook_path" "$docs_guard_hook_backup"

  _restore_docs_guard_hook() {
    cp "$docs_guard_hook_backup" "$docs_guard_hook_path"
    rm -f "$docs_guard_hook_backup"
  }
  trap _restore_docs_guard_hook EXIT

  printf '\n# deliberately corrupted for drift-detection fixture test\n' >> "$docs_guard_hook_path"

  set +e
  docs_guard_hook_fixture_output=$("${HARNESS_DIR}/bin/generate-docs-guard-hook" --check 2>&1)
  docs_guard_hook_fixture_exit=$?
  set -e

  _restore_docs_guard_hook
  trap - EXIT

  assert "bin/generate-docs-guard-hook --check — fixture: corrupted hook correctly detected as drift (exit 1)" \
    "$([ "$docs_guard_hook_fixture_exit" -eq 1 ] && echo 0 || echo 1)"
fi

# ── 6. Template references ──────────────────────────────────────────────────

echo ""
echo -e "${BOLD}6. Template references${NC}"

template_refs=$(grep -roh 'templates/[a-z_.-]*\.template' "${HARNESS_DIR}"/skills/ "${HARNESS_DIR}"/HARNESS.md 2>/dev/null | sort -u || true)
if [ -z "$template_refs" ]; then
  assert "no template references to check" 0
else
  for ref in $template_refs; do
    if [ -f "${HARNESS_DIR}/${ref}" ]; then
      assert "$ref exists" 0
    else
      assert "$ref — referenced but missing" 1
    fi
  done
fi

# ── 7. SKILL.md section numbering ───────────────────────────────────────────

echo ""
echo -e "${BOLD}7. SKILL.md section numbering${NC}"

for skill_file in "${HARNESS_DIR}"/skills/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  skill_name=$(basename "$(dirname "$skill_file")")

  # Extract full section identifiers (### 1. ### 2.5 ### 3a. ### 7b. etc.)
  # Keep the full identifier including sub-section markers (.5, a, b) to avoid
  # false duplication between e.g. ### 2. and ### 2.5 or ### 3. and ### 3a.
  sections=$(grep -oE '^### [0-9]+[a-z]?[.0-9]*' "$skill_file" 2>/dev/null \
    | sed 's/### //' | sort || true)

  if [ -z "$sections" ]; then
    assert "${skill_name} — no numbered sections (ok)" 0
    continue
  fi

  # Check for exact duplicates (same full identifier appearing twice)
  dupes=$(echo "$sections" | sort | uniq -d)
  if [ -n "$dupes" ]; then
    assert "${skill_name} — duplicate sections: ${dupes}" 1
  else
    assert "${skill_name} — no duplicate sections" 0
  fi
done

# ── 8. FR-3 invariant — no harness-side memory retrieval logic ─────────────
# adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration / FR-3: recall is performed by the LLM reading the store and
# judging relevance. The harness must contain NO embedding, cosine-similarity,
# vector-search, or relevance/rank-scoring logic for the memory subsystem.
# Patterns are stored in a variable so this file's own text is not matched.

echo ""
echo -e "${BOLD}8. FR-3 invariant — no harness-side memory retrieval logic${NC}"

_fr3_pat='embed\(|cosineSimilarity|vectorSearch|relevanceScore[^A-Za-z]|rankScore[^A-Za-z]'
# Use { grep ... || true; } so grep's "no match" exit-1 is swallowed before
# reaching wc -l — required because the script runs with set -o pipefail.
_fr3_hits=$({ grep -rEn "${_fr3_pat}" \
  "${HARNESS_DIR}/src/conductor/src" \
  "${HARNESS_DIR}/bin" \
  "${HARNESS_DIR}/hooks" \
  "${HARNESS_DIR}/skills" \
  --exclude-dir=engineer \
  2>/dev/null || true; } | wc -l)
assert "no harness-side memory retrieval logic in implementation dirs (FR-3)" \
  "$([ "${_fr3_hits}" -eq 0 ] && echo 0 || echo 1)"

# ── 9. Release artifacts (VERSION, CHANGELOG, tag consistency) ──────────────

echo ""
echo -e "${BOLD}9. Release artifacts${NC}"

# 9a. VERSION file exists and is valid semver
version_file="${HARNESS_DIR}/VERSION"
if [ ! -f "$version_file" ]; then
  assert "VERSION file exists" 1
else
  version=$(tr -d '[:space:]' < "$version_file")
  if echo "$version" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    assert "VERSION is valid semver (${version})" 0
  else
    assert "VERSION is valid semver — got '${version}'" 1
  fi
fi

# 9b. CHANGELOG.md exists and has an [Unreleased] section
changelog="${HARNESS_DIR}/CHANGELOG.md"
if [ ! -f "$changelog" ]; then
  assert "CHANGELOG.md exists" 1
else
  assert "CHANGELOG.md exists" 0
  if grep -q '^## \[Unreleased\]' "$changelog"; then
    assert "CHANGELOG.md has [Unreleased] section" 0
  else
    assert "CHANGELOG.md has [Unreleased] section" 1
  fi
fi

# 9d. skills/pipeline/SKILL.md must keep the "user-requested exit"
# contract: when the user asks to exit during a pipeline run, the skill
# must write `.pipeline/halt-user-input-required` before exiting.
# Without this contract, the conductor's build gate can't tell the
# difference between a successful pipeline exit and a user-requested
# halt — the original false-completion bug fixed in 0.99.14. This
# check fires if the contract section is removed or the marker name
# diverges from artifacts.ts.
pipeline_skill="${HARNESS_DIR}/skills/pipeline/SKILL.md"
if [ -f "$pipeline_skill" ]; then
  if grep -q -i "user-requested exit during a run" "$pipeline_skill" \
    && grep -q "halt-user-input-required" "$pipeline_skill"; then
    assert "skills/pipeline/SKILL.md preserves user-requested-exit halt-marker contract" 0
  else
    assert "skills/pipeline/SKILL.md preserves user-requested-exit halt-marker contract" 1
  fi
fi

# 9e. skills/stories/SKILL.md must document stamping the canonical approval
# token. The engineer land gate (land-spec.ts) and the daemon backlog both
# REQUIRE stories to declare "Status: Accepted" — a no-status stories file is
# silently skipped forever by the daemon. This check ties the skill instruction
# to the code gate so the two can't drift (stories-approval-contract fix).
stories_skill="${HARNESS_DIR}/skills/stories/SKILL.md"
if [ -f "$stories_skill" ]; then
  if grep -qE 'Status[^A-Za-z]*Accepted' "$stories_skill"; then
    assert "skills/stories/SKILL.md stamps canonical 'Status: Accepted' marker" 0
  else
    assert "skills/stories/SKILL.md stamps canonical 'Status: Accepted' marker" 1
  fi
fi

# 9f. skills/architecture-review/SKILL.md (Medium/Large tier) must run
# `conduct-ts overlap-scan` over the `## Wiring Surface` candidate paths
# before `/plan`, and must state it is advisory. Without this wiring, the
# Task 7 overlap-scan subcommand exists but is never invoked at DECIDE
# time, so authors stay blind to unmerged dependent work (the bug this
# plan fixes). This check ties the skill instruction to the CLI subcommand.
arch_review_skill="${HARNESS_DIR}/skills/architecture-review/SKILL.md"
if [ -f "$arch_review_skill" ]; then
  if grep -q "conduct-ts overlap-scan" "$arch_review_skill" \
    && grep -q "Wiring Surface" "$arch_review_skill" \
    && grep -qi "advisory" "$arch_review_skill" \
    && grep -q "/plan" "$arch_review_skill"; then
    assert "skills/architecture-review/SKILL.md wires advisory overlap-scan over Wiring Surface before /plan" 0
  else
    assert "skills/architecture-review/SKILL.md wires advisory overlap-scan over Wiring Surface before /plan" 1
  fi
fi

# 9c. Every vX.Y.Z tag has a matching ## [X.Y.Z] section in CHANGELOG.md.
# Only run when we're inside the harness repo's own git dir AND CHANGELOG.md
# exists (skips cleanly in shallow clones).
if [ -d "${HARNESS_DIR}/.git" ] && [ -f "$changelog" ]; then
  tags=$(git -C "$HARNESS_DIR" tag -l 'v*.*.*' 2>/dev/null || true)
  if [ -z "$tags" ]; then
    assert "no vX.Y.Z tags yet — nothing to cross-check" 0
  else
    for tag in $tags; do
      ver="${tag#v}"
      if grep -qE "^## \[${ver}\]" "$changelog"; then
        assert "${tag} has CHANGELOG entry" 0
      else
        assert "${tag} missing CHANGELOG entry [${ver}]" 1
      fi
    done
  fi
fi

# ── 10. Writer-audit for task-status.json single authority ──────────────────
# Task #302 enforces that ONLY the engine (src/conductor/src/engine/) writes to
# `.pipeline/task-status.json`. This is the single source of truth for task
# completion state. Any writes from hooks, skills, or bin/ scripts are violations
# of the completion derivation authority model.
#
# The check greps for task-status.json references that appear to be WRITES
# (writeFile calls, file redirection patterns, etc.) and ensures they are only
# found in the engine code. References that are clearly READ-ONLY (comments,
# error messages, docs) are filtered out to avoid false positives.
#
# This check is expected to:
#  - RED (fail): if any unauthorized writers are found in hooks/, skills/, or bin/
#  - GREEN (pass): once Task 15 removes the old post-commit hook and no other
#    unauthorized writers exist

echo ""
echo -e "${BOLD}10. Writer-audit for task-status.json single authority${NC}"

# Grep for task-status.json references in hooks and bin, excluding engine code.
# Only flag actual write operations (writeFile, .write, etc.), not documentation
# or read-only operations.
_writer_audit_hits=$(grep -rn "task-status" \
  "${HARNESS_DIR}/hooks" \
  "${HARNESS_DIR}/bin" \
  --include="*.sh" --include="*.ts" --include="*.js" \
  2>/dev/null || true)

# Filter to keep only lines that look like write operations
_writer_audit_violations=""
if [ -n "$_writer_audit_hits" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue

    # Extract the file path and the code line
    filepath=$(echo "$line" | cut -d: -f1)
    content=$(echo "$line" | cut -d: -f3-)

    # Skip read-only patterns: comments, console logs, error messages, documentation
    if echo "$content" | grep -qE '^\s*(//|#|\*|\/\*|console|error|log|readFile)'; then
      continue
    fi

    # Skip string literals that are clearly just documenting task-status
    if echo "$content" | grep -qE '("|'"'"').*task-status.*\.("|'"'"')'; then
      continue
    fi

    # Now check for write operations: writeFile, .write, fs.write, appendFile
    if echo "$content" | grep -qE 'writeFile|\.write|fs\.write|fs\.appendFile|>> |> '; then
      _writer_audit_violations="${_writer_audit_violations}${line}
"
    fi
  done <<< "$_writer_audit_hits"
fi

if [ -z "$_writer_audit_violations" ]; then
  assert "task-status.json — only engine writes (no unauthorized writers)" 0
else
  assert "task-status.json — unauthorized writers detected" 1
  echo "$_writer_audit_violations" | while read -r violation; do
    [ -z "$violation" ] && continue
    echo -e "    ${RED}Violation:${NC} ${violation}"
  done
fi

# ── Pipeline SKILL.md — no imperative CLI stamping text ────────────────────────
# skills/pipeline/SKILL.md documents session-hook machinery for task
# start/done stamping (adr-2026-07-10-session-hook-task-stamping.md); it must
# never instruct the orchestrator to imperatively run the CLI as a per-task
# step. Mentions of `conduct-ts task start/done` as operator/recovery
# machinery (descriptive, not imperative) are fine.
_pipeline_skill="${HARNESS_DIR}/skills/pipeline/SKILL.md"
if [ -f "$_pipeline_skill" ]; then
  _imperative_cli_hits=$(grep -nE '(^|[^\`])Run `conduct-ts task (start|done)' "$_pipeline_skill" || true)
  if [ -z "$_imperative_cli_hits" ]; then
    assert "pipeline SKILL.md — no imperative 'Run \`conduct-ts task start/done\`' text" 0
  else
    assert "pipeline SKILL.md — imperative CLI stamping text found (should describe session hooks instead)" 1
    echo "$_imperative_cli_hits" | while read -r hit; do
      [ -z "$hit" ] && continue
      echo -e "    ${RED}Violation:${NC} ${hit}"
    done
  fi
else
  assert "pipeline SKILL.md exists" 1
fi

# ── 11. Issue-template YAML validity and blank-issues guard ─────────────────
# Validates that all issue templates in .github/ISSUE_TEMPLATE/ contain valid YAML
# and that blank_issues_enabled is not set to false (which would prevent users from
# creating custom issues).
#
# Parsing strategy:
#  1. Try python3 with pyyaml if available
#  2. Fall back to node js-yaml from src/conductor/node_modules
#  3. Warn (not fail) if neither parser is available

echo ""
echo -e "${BOLD}11. Issue-template YAML validity and blank-issues guard${NC}"

issue_templates_dir="${HARNESS_DIR}/.github/ISSUE_TEMPLATE"

# If directory doesn't exist, that's fine — templates are optional
if [ ! -d "$issue_templates_dir" ]; then
  assert "no .github/ISSUE_TEMPLATE directory — skipping" 0
else
  # Check all .yml and .yaml files in the directory
  for template in "$issue_templates_dir"/*.{yml,yaml}; do
    # Skip if no matches (glob didn't expand)
    if [ ! -f "$template" ]; then
      continue
    fi

    template_name=$(basename "$template")

    # Try python3 first
    if command -v python3 >/dev/null 2>&1; then
      set +e
      python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$template" 2>/dev/null
      py_exit=$?
      set -e

      if [ "$py_exit" -eq 0 ]; then
        assert "${template_name} — valid YAML (python3)" 0
      else
        assert "${template_name} — invalid YAML (python3 parse failed)" 1
        continue
      fi
    # Fall back to node js-yaml
    elif [ -f "${HARNESS_DIR}/src/conductor/node_modules/.bin/ts-node" ] || [ -d "${HARNESS_DIR}/src/conductor/node_modules/js-yaml" ]; then
      set +e
      node -e "const yaml = require('js-yaml'); yaml.load(require('fs').readFileSync('$template', 'utf8'));" 2>/dev/null
      node_exit=$?
      set -e

      if [ "$node_exit" -eq 0 ]; then
        assert "${template_name} — valid YAML (node)" 0
      else
        assert "${template_name} — invalid YAML (node parse failed)" 1
        continue
      fi
    else
      # No YAML parser available — warn but don't fail
      warn_check "${template_name} — skipped (no YAML parser available)" 1
      continue
    fi
  done

  # Check config.yml for blank_issues_enabled: false
  config_file="${issue_templates_dir}/config.yml"
  if [ -f "$config_file" ]; then
    # Use the same parser priority as above
    if command -v python3 >/dev/null 2>&1; then
      set +e
      if python3 -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); print(d.get('blank_issues_enabled', True))" "$config_file" 2>/dev/null | grep -q "False"; then
        assert "config.yml — blank_issues_enabled must not be false" 1
      else
        assert "config.yml — blank_issues_enabled is not set to false" 0
      fi
      set -e
    elif [ -f "${HARNESS_DIR}/src/conductor/node_modules/.bin/ts-node" ] || [ -d "${HARNESS_DIR}/src/conductor/node_modules/js-yaml" ]; then
      set +e
      if node -e "const yaml = require('js-yaml'); const d = yaml.load(require('fs').readFileSync('$config_file', 'utf8')); process.exit((d.blank_issues_enabled === false) ? 0 : 1);" 2>/dev/null; then
        assert "config.yml — blank_issues_enabled must not be false" 1
      else
        assert "config.yml — blank_issues_enabled is not set to false" 0
      fi
      set -e
    else
      warn_check "config.yml — blank_issues_enabled check skipped (no YAML parser available)" 1
    fi
  fi
fi

# ── Intake Owner markers (owner-gate) ────────────────────────────────────────
# Every intake doc must carry an Owner: marker. This is a supplementary local
# belt only, not the enforcement mechanism: authoring now stamps Owner: from
# machine identity at write time (born owned), and an un-owned arrival at the
# daemon no longer dead-letters silently — decideSpecGate default-builds it
# under the daemon's own owner (unowned-defaulted) with a loud escalation.
# This check just catches a hand-authored doc that slipped through unstamped.
echo ""
echo "Checking intake Owner markers..."
missing_owner=0
for f in .docs/intake/*.md; do
  [ -e "$f" ] || continue
  grep -qE '^Owner:[[:space:]]*[^[:space:]]+' "$f" || { missing_owner=1; echo "    missing Owner: $f"; }
done
assert ".docs/intake/*.md all carry an Owner: marker" "$missing_owner"

# ── 12. /plan wires the overlap-scan subcommand ──────────────────────────────
# skills/plan/SKILL.md must contain a step invoking `conduct-ts overlap-scan`
# over the plan's authoritative Files set before the plan is committed, and
# must state the result is advisory (never blocks).
echo ""
echo -e "${BOLD}12. /plan overlap-scan step${NC}"
plan_skill="${HARNESS_DIR}/skills/plan/SKILL.md"
if [ -f "$plan_skill" ]; then
  grep -q "conduct-ts overlap-scan" "$plan_skill"
  assert "skills/plan/SKILL.md — invokes conduct-ts overlap-scan" $?

  grep -qi "advisory" "$plan_skill"
  assert "skills/plan/SKILL.md — overlap-scan step states result is advisory" $?
else
  assert "skills/plan/SKILL.md exists" 1
fi

# ── 13. ci-detect-docs-only.sh predicate suite ──────────────────────────────
# Runs test/test_ci_detect_docs_only.sh, which covers
# .github/scripts/ci-detect-docs-only.sh (the docs-only CI gating predicate).
# Guarded here so the predicate's behavior is checked on every non-doc PR —
# integrity is exactly the job that runs for any change touching
# .github/scripts/.
echo ""
echo -e "${BOLD}13. ci-detect-docs-only.sh predicate suite${NC}"

docs_only_test="${HARNESS_DIR}/test/test_ci_detect_docs_only.sh"
if [ -f "$docs_only_test" ]; then
  set +e
  docs_only_output=$(bash "$docs_only_test" 2>&1)
  docs_only_exit=$?
  set -e

  if [ "$docs_only_exit" -eq 0 ]; then
    assert "test/test_ci_detect_docs_only.sh — all assertions pass" 0
  else
    echo "$docs_only_output" | sed 's/^/    /'
    assert "test/test_ci_detect_docs_only.sh — assertions failed" 1
  fi
else
  assert "test/test_ci_detect_docs_only.sh exists" 1
fi

# ── 14. README/docs relocation acceptance checks ────────────────────────────
# Runs the three durable acceptance checks produced by Tasks 11-13 of
# .docs/plans/condense-readme-relocate-docs.md: docs-link-check.sh (no broken
# relative links/anchors across README.md + docs/*.md), readme-shape-check.sh
# (README.md stays a condensed front-door), and
# docs-content-preservation-check.sh (relocated content isn't silently
# dropped). Without this wiring, step 1's `bash -n` only proves these scripts
# are syntactically valid, not that they actually pass — wire them in as real
# invoked checks, same pattern as step 13's ci-detect-docs-only.sh.
echo ""
echo -e "${BOLD}14. README/docs relocation acceptance checks${NC}"

for docs_check in docs-link-check.sh readme-shape-check.sh docs-content-preservation-check.sh; do
  docs_check_path="${HARNESS_DIR}/test/${docs_check}"
  if [ -f "$docs_check_path" ]; then
    set +e
    docs_check_output=$(bash "$docs_check_path" 2>&1)
    docs_check_exit=$?
    set -e

    if [ "$docs_check_exit" -eq 0 ]; then
      assert "test/${docs_check} — passes" 0
    else
      echo "$docs_check_output" | sed 's/^/    /'
      assert "test/${docs_check} — failed" 1
    fi
  else
    assert "test/${docs_check} exists" 1
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}  ${YELLOW}${WARN} warnings${NC}  (${TOTAL} total)"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo -e "${RED}Validation FAILED — fix issues before committing.${NC}"
  exit 1
fi

exit 0
