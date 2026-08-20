#!/usr/bin/env bash
set -euo pipefail

# Keep the provider-facing closed vocabularies in the four rubric SKILL.md
# contracts equal to the engine's single source of truth. Each comparison is
# set equality: the unified diff exposes both an undocumented engine member
# and a documented member no longer accepted at the trust boundary.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
failures=0

# `plan-task` is enforced by this helper, not by its call-site name. Pin its
# source region so a grammar-only helper edit cannot leave the bindings and
# provider contracts apparently aligned.
readonly EXPECTED_PLAN_TASK_GRAMMAR_IMPLEMENTATION_SHA256='9815c1d3ca5c9a91380df830b667686c90188003241cc870eb57ffb07fcb5b3f'

extract_plan_task_grammar_implementation() {
  local domain_file=$1
  local domain_dir parser_import parser_file helper canonical_reference titled_reference task_id_pattern

  domain_dir=$(dirname "$domain_file")
  parser_import=$(sed -nE "s|^import \{[^}]*TASK_ID_PATTERN[^}]*\} from '([^']+)';$|\1|p" "$domain_file")
  if [ "$(printf '%s\n' "$parser_import" | sed '/^$/d' | wc -l | tr -d ' ')" -ne 1 ] ||
      [[ "$parser_import" != ./* ]] || [[ "$parser_import" == *'/'*'/'* ]]; then
    return 1
  fi
  parser_file="$domain_dir/${parser_import%.js}.ts"

  if [ ! -r "$parser_file" ]; then
    return 1
  fi

  helper=$(sed -n '/^export function parseBuildReviewCanonicalPlanTaskReference/,/^}/p' "$domain_file")
  canonical_reference=$(grep -Fx 'const CANONICAL_PLAN_TASK_REFERENCE = new RegExp(`^${TASK_ID_PATTERN}$`);' "$domain_file")
  titled_reference=$(grep -Fx 'const TITLED_PLAN_TASK_REFERENCE = new RegExp(`^Task\\s+(${TASK_ID_PATTERN}):\\s+.+$`);' "$domain_file")
  task_id_pattern=$(grep -Fx "export const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';" "$parser_file")

  if [ "$(grep -c '^export function parseBuildReviewCanonicalPlanTaskReference' "$domain_file")" -ne 1 ] ||
      [ -z "$helper" ] ||
      [ "$(printf '%s\n' "$canonical_reference" | wc -l | tr -d ' ')" -ne 1 ] ||
      [ "$(printf '%s\n' "$titled_reference" | wc -l | tr -d ' ')" -ne 1 ] ||
      [ "$(printf '%s\n' "$task_id_pattern" | wc -l | tr -d ' ')" -ne 1 ]; then
    return 1
  fi

  printf '%s\n%s\n%s\n%s\n' \
    "$helper" "$canonical_reference" "$titled_reference" "$task_id_pattern"
}

extract_plan_task_grammar_implementation_digest() {
  extract_plan_task_grammar_implementation "$1" | sha256sum | awk '{ print $1 }'
}

check_reference_grammar_implementation_drift() {
  local domain_file=$1
  local implementation_digest

  if [ ! -r "$domain_file" ]; then
    echo "could not read build-review reference grammar source: ${domain_file}" >&2
    return 1
  fi

  if ! implementation_digest=$(extract_plan_task_grammar_implementation_digest "$domain_file"); then
    echo 'could not extract complete build-review plan-task grammar implementation sources' >&2
    return 1
  fi
  if [ -z "$implementation_digest" ] ||
      [ "$implementation_digest" != "$EXPECTED_PLAN_TASK_GRAMMAR_IMPLEMENTATION_SHA256" ]; then
    echo 'build-review plan-task grammar implementation drift: update the parser grammar and SKILL.md contracts together' >&2
    return 1
  fi
}

extract_current_engine_vocabulary() {
  local domain_file=$1
  local rubric=$2
  awk -v rubric="$rubric" '
    /^export const BUILD_REVIEW_FINDING_VOCABULARIES = Object\.freeze\(\{$/ { in_vocabularies = 1; next }
    in_vocabularies && $0 ~ "^  " rubric ": Object\\.freeze\\(\\{" { in_rubric = 1; next }
    in_rubric && /^  \}\),$/ { exit }
    in_rubric { print }
  ' "$domain_file" \
    | grep -oE "'[^']+'" \
    | sed "s/^'//; s/'$//" \
    | sort -u
}

extract_current_engine_reference_grammars() {
  local domain_file=$1
  local rubric=$2

  awk -v rubric="$rubric" '
    /^export function parseBuildReviewFindingAnchor\(/ { in_parser = 1; next }
    !in_parser { next }
    $0 ~ "case '\''" rubric "'\'':" { in_rubric = 1; next }
    in_rubric && /^[[:space:]]*case '\''/ { exit }
    !in_rubric { next }

    {
      # v3 content-region references use a ternary whose other arm preserves
      # the pre-v3 path grammar.  The skill contracts describe v3, so consume
      # only the v3 arm and never mistake the legacy fallback for current
      # grammar.
      if ($0 ~ /contractVersion === '\''v3'\''/) {
        v3_arm = 1;
        next;
      }
      if ($0 ~ /if \(contractVersion !== '\''v3'\''\)/) {
        skipping_legacy_block = $0 !~ /}/;
        next;
      }
      if (skipping_legacy_block) {
        if ($0 ~ /}/) skipping_legacy_block = 0;
        next;
      }
      if (v3_arm && $0 ~ /^[[:space:]]*\?/) {
        v3_arm = 0;
        legacy_arm = 1;
      } else if (legacy_arm && $0 ~ /^[[:space:]]*:/) {
        legacy_arm = 0;
        next;
      }

      if (match($0, /parseContentRegionReference\(source\.[A-Za-z][A-Za-z0-9]*/)) {
        field = substr($0, RSTART + length("parseContentRegionReference(source."), RLENGTH - length("parseContentRegionReference(source."));
        print field "=content-region";
        next;
      }
      if (match($0, /verifiedReference\(source\.[A-Za-z][A-Za-z0-9]*/)) {
        field = substr($0, RSTART + length("verifiedReference(source."), RLENGTH - length("verifiedReference(source."));
      } else if ($0 ~ /verifiedReference\(/) {
        awaiting_verified_field = 1;
      } else if (awaiting_verified_field && match($0, /source\.[A-Za-z][A-Za-z0-9]*/)) {
        field = substr($0, RSTART + length("source."), RLENGTH - length("source."));
        awaiting_verified_field = 0;
      }
      if (field != "" && /parseBuildReviewCanonicalPlanTaskReference/) {
        print field "=plan-task";
        field = "";
      } else if (field != "" && /parseBuildReviewCanonicalPathReference/) {
        print field "=path";
        field = "";
      }
    }
  ' "$domain_file" | sort -u
}

check_vocabulary_drift() {
  local domain_file=$1
  local harness_dir=$2
  local rubric skill_file engine_vocabulary documented_vocabulary

  for rubric in tautology scope rootCause completeness; do
    skill_file="$harness_dir/skills/build-review-${rubric//rootCause/root-cause}/SKILL.md"
    if [ ! -f "$domain_file" ] || [ ! -f "$skill_file" ]; then
      echo "missing vocabulary source for ${rubric}: ${domain_file} or ${skill_file}" >&2
      return 1
    fi

    engine_vocabulary=$(extract_current_engine_vocabulary "$domain_file" "$rubric")
    documented_vocabulary=$(extract_documented_vocabulary "$skill_file")
    if [ -z "$engine_vocabulary" ] || [ -z "$documented_vocabulary" ]; then
      echo "could not extract closed vocabulary for ${rubric}" >&2
      return 1
    fi

    if ! diff -u <(printf '%s\n' "$engine_vocabulary") <(printf '%s\n' "$documented_vocabulary"); then
      echo "build-review ${rubric} vocabulary drift: update the engine and SKILL.md together" >&2
      return 1
    fi
  done
}

extract_documented_reference_grammars() {
  local skill_file=$1

  grep '^\*\*Reference grammar:\*\*' "$skill_file" \
    | grep -oE '`anchor\.[A-Za-z][A-Za-z0-9]*` is a `[a-z-]+` reference' \
    | sed -E 's/`anchor\.([A-Za-z][A-Za-z0-9]*)` is a `([a-z-]+)` reference/\1=\2/' \
    | sort -u
}

check_reference_grammar_drift() {
  local domain_file=$1
  local harness_dir=$2
  local rubric skill_file engine_grammars documented_grammars field grammar

  if [ ! -r "$domain_file" ]; then
    echo "could not read build-review reference grammar source: ${domain_file}" >&2
    return 1
  fi

  for rubric in tautology scope rootCause completeness; do
    skill_file="$harness_dir/skills/build-review-${rubric//rootCause/root-cause}/SKILL.md"
    if [ ! -r "$skill_file" ]; then
      echo "could not read build-review ${rubric} reference grammar contract: ${skill_file}" >&2
      return 1
    fi

    if ! engine_grammars=$(extract_current_engine_reference_grammars "$domain_file" "$rubric"); then
      echo "could not extract build-review ${rubric} reference grammar bindings from ${domain_file}" >&2
      return 1
    fi
    if [ -z "$engine_grammars" ]; then
      echo "could not extract build-review ${rubric} reference grammar bindings from ${domain_file}" >&2
      return 1
    fi

    documented_grammars=$(extract_documented_reference_grammars "$skill_file")
    while IFS='=' read -r field grammar; do
      [ -n "$field" ] || continue
      if ! grep -Fxq "${field}=${grammar}" <<<"$documented_grammars"; then
        echo "build-review ${rubric} reference grammar drift: anchor.${field} requires ${grammar}, but SKILL.md does not state that grammar" >&2
        return 1
      fi
    done <<<"$engine_grammars"

    while IFS='=' read -r field grammar; do
      [ -n "$field" ] || continue
      if ! grep -Fxq "${field}=${grammar}" <<<"$engine_grammars"; then
        echo "build-review ${rubric} reference grammar drift: anchor.${field} states stale ${grammar}, which the engine no longer enforces" >&2
        return 1
      fi
    done <<<"$documented_grammars"
  done
}

extract_documented_vocabulary() {
  local skill_file=$1
  sed -n '/^\*\*Closed vocabulary:\*\*/,/^$/p' "$skill_file" \
    | grep -oE '`[^`]+`' \
    | tr -d '`' \
    | sort -u
}

fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
fixture_domain="$fixture_dir/src/conductor/src/engine/build-review-domain.ts"
fixture_harness="$fixture_dir/harness"
mkdir -p "$(dirname "$fixture_domain")" "$fixture_harness/skills"

# Task 14 fixture: the parser accepts `anchor.planTask` as a path despite both
# the manually maintained binding and the SKILL.md contract still naming it a
# plan-task. The guard must observe the parser, not the redundant declaration.
cat >"$fixture_domain" <<'EOF'
export const BUILD_REVIEW_FINDING_VOCABULARIES = Object.freeze({
  tautology: Object.freeze({
    concernKinds: Object.freeze(['assertion-insensitive-to-production']),
  }),
  scope: Object.freeze({
    concernKinds: Object.freeze(['out-of-plan-change']),
  }),
  rootCause: Object.freeze({
    concernKinds: Object.freeze(['root-cause-unaddressed']),
  }),
  completeness: Object.freeze({
    concernKinds: Object.freeze(['missing-deliverable']),
  }),
});

const CANONICAL_PLAN_TASK_REFERENCE = /^Task [1-9][0-9]*$/;

export const BUILD_REVIEW_FINDING_REFERENCE_BINDINGS = Object.freeze({
  tautology: Object.freeze({ changedTest: 'content-region' }),
  scope: Object.freeze({ path: 'path' }),
  rootCause: Object.freeze({ locus: 'content-region' }),
  completeness: Object.freeze({ planTask: 'plan-task', missingSurface: 'path' }),
});

function parseContentRegionReference(value: unknown): unknown { return value; }
function parseBuildReviewCanonicalPathReference(value: unknown): unknown { return value; }
function parseBuildReviewCanonicalPlanTaskReference(value: unknown): unknown { return value; }
function verifiedReference(value: unknown, parser: (candidate: unknown) => unknown): unknown { return parser(value); }

export function parseBuildReviewFindingAnchor(value: Record<string, unknown>): unknown {
  const source = value;
  switch (source.rubric) {
    case 'tautology':
      return parseContentRegionReference(source.changedTest);
    case 'scope':
      return verifiedReference(source.path, parseBuildReviewCanonicalPathReference);
    case 'rootCause':
      return parseContentRegionReference(source.locus);
    case 'completeness':
      // Deliberately parser-only drift: the binding above remains plan-task.
      const planTask = verifiedReference(source.planTask, parseBuildReviewCanonicalPathReference);
      return verifiedReference(source.missingSurface, parseBuildReviewCanonicalPathReference) && planTask;
  }
}
EOF

for rubric in tautology scope root-cause completeness; do
  mkdir -p "$fixture_harness/skills/build-review-$rubric"
done

printf '%s\n' '**Closed vocabulary:** `assertion-insensitive-to-production`' \
  >"$fixture_harness/skills/build-review-tautology/SKILL.md"
printf '\n%s\n' '**Reference grammar:** `anchor.changedTest` is a `content-region` reference.' \
  >>"$fixture_harness/skills/build-review-tautology/SKILL.md"
printf '%s\n' '**Closed vocabulary:** `out-of-plan-change`' \
  >"$fixture_harness/skills/build-review-scope/SKILL.md"
printf '\n%s\n' '**Reference grammar:** `anchor.path` is a `path` reference.' \
  >>"$fixture_harness/skills/build-review-scope/SKILL.md"
printf '%s\n' '**Closed vocabulary:** `root-cause-unaddressed`' \
  >"$fixture_harness/skills/build-review-root-cause/SKILL.md"
printf '\n%s\n' '**Reference grammar:** `anchor.locus` is a `content-region` reference.' \
  >>"$fixture_harness/skills/build-review-root-cause/SKILL.md"
printf '%s\n' '**Closed vocabulary:** `missing-deliverable`' \
  >"$fixture_harness/skills/build-review-completeness/SKILL.md"
printf '\n%s\n' '**Reference grammar:** `anchor.planTask` is a `plan-task` reference; `anchor.missingSurface` is a `path` reference.' \
  >>"$fixture_harness/skills/build-review-completeness/SKILL.md"

if ! grep -q "planTask: 'plan-task'" "$fixture_domain" \
    || ! grep -q 'parseBuildReviewCanonicalPathReference);' "$fixture_domain"; then
  echo 'rubric reference-grammar fixture is malformed' >&2
  failures=1
elif ! check_vocabulary_drift "$fixture_domain" "$fixture_harness"; then
  echo 'rubric vocabulary guard unexpectedly rejected the reference-grammar fixture' >&2
  failures=1
elif fixture_output=$(check_reference_grammar_drift "$fixture_domain" "$fixture_harness" 2>&1); then
  echo 'known gap: reference-grammar guard accepts a parser-only grammar change' >&2
  failures=1
elif grep -Fq 'build-review completeness reference grammar drift: anchor.planTask requires path, but SKILL.md does not state that grammar' <<<"$fixture_output"; then
  echo 'rubric reference-grammar guard rejects the parser-only grammar fixture'
else
  echo 'rubric reference-grammar guard rejected the fixture without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

# The legacy grammar appears first in this fixture.  A declaration-driven (or
# order-insensitive) scan accepts the stale content-region contract, whereas
# the parser accepts a path for v3 and must make the guard fail.
fixture_v3_domain="$fixture_dir/src/conductor/src/engine/build-review-domain-v3-grammar.ts"
fixture_v3_harness="$fixture_dir/harness-v3-grammar"
cp "$fixture_domain" "$fixture_v3_domain"
cp -R "$fixture_harness" "$fixture_v3_harness"
sed -i "/const source = value;/a\\  const contractVersion = 'v3';" "$fixture_v3_domain"
sed -i "/case 'completeness':/a\\      if (contractVersion !== 'v3') { return parseContentRegionReference(source.planTask); }" "$fixture_v3_domain"
sed -i 's/`anchor.planTask` is a `plan-task` reference/`anchor.planTask` is a `content-region` reference/' \
  "$fixture_v3_harness/skills/build-review-completeness/SKILL.md"

if ! grep -q "if (contractVersion !== 'v3') { return parseContentRegionReference(source.planTask); }" "$fixture_v3_domain" \
    || ! grep -q '`anchor.planTask` is a `content-region` reference' "$fixture_v3_harness/skills/build-review-completeness/SKILL.md"; then
  echo 'rubric v3 parser-precedence fixture is malformed' >&2
  failures=1
elif ! check_vocabulary_drift "$fixture_v3_domain" "$fixture_v3_harness"; then
  echo 'rubric vocabulary guard unexpectedly rejected the v3 parser-precedence fixture' >&2
  failures=1
elif fixture_output=$(check_reference_grammar_drift "$fixture_v3_domain" "$fixture_v3_harness" 2>&1); then
  echo 'known gap: reference-grammar guard accepts a legacy-first parser grammar' >&2
  failures=1
elif grep -Fq 'build-review completeness reference grammar drift: anchor.planTask requires path, but SKILL.md does not state that grammar' <<<"$fixture_output"; then
  echo 'rubric reference-grammar guard rejects the legacy-first parser grammar fixture'
else
  echo 'rubric reference-grammar guard rejected the legacy-first fixture without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

# Remediation Task root-cause-3 fixture: the parser reads `anchor.changedTest`
# for the root-cause locus while the binding and contract remain `anchor.locus`.
# This exercises parser-only reference-field drift independently of a grammar
# substitution, because the manually maintained declaration is deliberately
# left untouched.
fixture_field_domain="$fixture_dir/src/conductor/src/engine/build-review-domain-reference-field.ts"
cp "$fixture_domain" "$fixture_field_domain"
sed -i 's/parseContentRegionReference(source\.locus)/parseContentRegionReference(source.changedTest)/' "$fixture_field_domain"

if ! grep -q "rootCause: Object.freeze({ locus: 'content-region' })" "$fixture_field_domain" \
    || ! grep -q 'parseContentRegionReference(source.changedTest)' "$fixture_field_domain"; then
  echo 'rubric reference-field fixture is malformed' >&2
  failures=1
elif ! check_vocabulary_drift "$fixture_field_domain" "$fixture_harness"; then
  echo 'rubric vocabulary guard unexpectedly rejected the reference-field fixture' >&2
  failures=1
elif fixture_output=$(check_reference_grammar_drift "$fixture_field_domain" "$fixture_harness" 2>&1); then
  echo 'known gap: reference-grammar guard accepts a parser-only reference-field change' >&2
  failures=1
elif grep -Fq 'build-review rootCause reference grammar drift: anchor.changedTest requires content-region, but SKILL.md does not state that grammar' <<<"$fixture_output"; then
  echo 'rubric reference-grammar guard rejects the parser-only reference-field fixture'
else
  echo 'rubric reference-grammar guard rejected the reference-field fixture without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

# Remediation Task root-cause-4 fixture: a parser branch that no longer routes
# the declared root-cause field through a recognized canonical grammar is an
# incomplete source extraction. A non-empty binding declaration must never
# mask that missing parser evidence.
fixture_incomplete_domain="$fixture_dir/src/conductor/src/engine/build-review-domain-incomplete-parser.ts"
cp "$fixture_domain" "$fixture_incomplete_domain"
sed -i 's/return parseContentRegionReference(source\.locus);/return source.locus;/' "$fixture_incomplete_domain"

if ! grep -q "rootCause: Object.freeze({ locus: 'content-region' })" "$fixture_incomplete_domain" \
    || ! grep -q 'return source.locus;' "$fixture_incomplete_domain"; then
  echo 'rubric incomplete-parser fixture is malformed' >&2
  failures=1
elif ! check_vocabulary_drift "$fixture_incomplete_domain" "$fixture_harness"; then
  echo 'rubric vocabulary guard unexpectedly rejected the incomplete-parser fixture' >&2
  failures=1
elif fixture_output=$(check_reference_grammar_drift "$fixture_incomplete_domain" "$fixture_harness" 2>&1); then
  echo 'known gap: reference-grammar guard accepts incomplete parser extraction' >&2
  failures=1
elif grep -Fq 'could not extract build-review rootCause reference grammar bindings from' <<<"$fixture_output"; then
  echo 'rubric reference-grammar guard fails closed on incomplete parser extraction'
else
  echo 'rubric reference-grammar guard rejected incomplete parser extraction without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

# The parser branch and reference binding remain byte-identical here; only the
# plan-task helper body changes. The grammar guard must pin the implementation
# that enforces a declared `plan-task` reference rather than infer its grammar
# from the helper name at the call site.
fixture_plan_task_grammar_domain="$fixture_dir/src/conductor/src/engine/build-review-domain-plan-task-grammar.ts"
cp "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$fixture_plan_task_grammar_domain"
cp "$HARNESS_DIR/src/conductor/src/engine/plan-task-parse.ts" "$(dirname "$fixture_plan_task_grammar_domain")/plan-task-parse.ts"
sed -i '/^export function parseBuildReviewCanonicalPlanTaskReference/,/^}/c\export function parseBuildReviewCanonicalPlanTaskReference(value: unknown): string | undefined { return parseBuildReviewCanonicalPathReference(value); }' \
  "$fixture_plan_task_grammar_domain"

if ! grep -Fq 'return parseBuildReviewCanonicalPathReference(value);' "$fixture_plan_task_grammar_domain"; then
  echo 'rubric plan-task grammar implementation fixture is malformed' >&2
  failures=1
elif fixture_output=$(check_reference_grammar_implementation_drift "$fixture_plan_task_grammar_domain" 2>&1); then
  echo 'known gap: reference-grammar guard accepts a parser-helper-only grammar change' >&2
  failures=1
elif grep -Fq 'build-review plan-task grammar implementation drift: update the parser grammar and SKILL.md contracts together' <<<"$fixture_output"; then
  echo 'rubric reference-grammar guard rejects parser-helper-only grammar drift'
else
  echo 'rubric reference-grammar guard rejected parser-helper-only grammar drift without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

# Remediation Task rem-root-cause-4 fixture: each grammar input lives outside
# the parser helper body whose digest is pinned above.  The parser binding and
# SKILL contracts remain unchanged, so the implementation guard itself must
# notice any constant-level drift.  These deliberately fail until the guard
# covers CANONICAL_PLAN_TASK_REFERENCE, TITLED_PLAN_TASK_REFERENCE, and the
# imported TASK_ID_PATTERN source as well as the helper body.
fixture_plan_task_constants_dir="$fixture_dir/plan-task-constants"
fixture_plan_task_constants_domain="$fixture_plan_task_constants_dir/build-review-domain.ts"
fixture_plan_task_constants_parser="$fixture_plan_task_constants_dir/plan-task-parse-baseline.ts"
mkdir -p "$fixture_plan_task_constants_dir"
cp "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$fixture_plan_task_constants_domain"
cp "$HARNESS_DIR/src/conductor/src/engine/plan-task-parse.ts" "$fixture_plan_task_constants_parser"

for grammar_constant in CANONICAL_PLAN_TASK_REFERENCE TITLED_PLAN_TASK_REFERENCE TASK_ID_PATTERN; do
  fixture_constant_domain="$fixture_plan_task_constants_dir/build-review-domain-${grammar_constant}.ts"
  fixture_constant_parser="$fixture_plan_task_constants_dir/plan-task-parse.ts"
  cp "$fixture_plan_task_constants_domain" "$fixture_constant_domain"
  cp "$fixture_plan_task_constants_parser" "$fixture_constant_parser"

  case "$grammar_constant" in
    CANONICAL_PLAN_TASK_REFERENCE)
      sed -i '/^const CANONICAL_PLAN_TASK_REFERENCE =/c\const CANONICAL_PLAN_TASK_REFERENCE = /^task-[A-Za-z0-9._-]+$/;' \
        "$fixture_constant_domain"
      ;;
    TITLED_PLAN_TASK_REFERENCE)
      sed -i 's/^const TITLED_PLAN_TASK_REFERENCE =.*/const TITLED_PLAN_TASK_REFERENCE = new RegExp(`^Plan\\s+(${TASK_ID_PATTERN}):\\s+.+$`);/' \
        "$fixture_constant_domain"
      ;;
    TASK_ID_PATTERN)
      sed -i "s/^export const TASK_ID_PATTERN =.*/export const TASK_ID_PATTERN = '[0-9]+';/" \
        "$fixture_constant_parser"
      ;;
  esac

  if ! check_reference_grammar_drift "$fixture_constant_domain" "$HARNESS_DIR"; then
    echo "rubric ${grammar_constant} grammar fixture unexpectedly changed parser bindings or SKILL contracts" >&2
    failures=1
  elif fixture_output=$(check_reference_grammar_implementation_drift "$fixture_constant_domain" 2>&1); then
    echo "known gap: reference-grammar guard accepts ${grammar_constant} grammar drift outside the parser helper body" >&2
    failures=1
  elif grep -Fq 'build-review plan-task grammar implementation drift: update the parser grammar and SKILL.md contracts together' <<<"$fixture_output"; then
    echo "rubric reference-grammar guard rejects ${grammar_constant} grammar drift"
  else
    echo "rubric reference-grammar guard rejected ${grammar_constant} grammar drift without the required diagnostic" >&2
    echo "$fixture_output" >&2
    failures=1
  fi
done

fixture_missing_domain="$fixture_dir/src/conductor/src/engine/missing-build-review-domain.ts"
if fixture_output=$(check_reference_grammar_drift "$fixture_missing_domain" "$fixture_harness" 2>&1); then
  echo 'known gap: reference-grammar guard accepts an unreadable parser source' >&2
  failures=1
elif grep -Fq "could not read build-review reference grammar source: $fixture_missing_domain" <<<"$fixture_output"; then
  echo 'rubric reference-grammar guard fails closed on an unreadable parser source'
else
  echo 'rubric reference-grammar guard rejected unreadable parser source without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

if ! check_vocabulary_drift "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$HARNESS_DIR"; then
  failures=1
fi

if ! check_reference_grammar_drift "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$HARNESS_DIR"; then
  failures=1
fi

if ! check_reference_grammar_implementation_drift "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts"; then
  failures=1
fi

exit "$failures"
