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
