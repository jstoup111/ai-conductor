#!/usr/bin/env bash
set -euo pipefail

# Keep the provider-facing closed vocabularies and anchor reference grammars in
# the four rubric SKILL.md contracts equal to the engine's single source of
# truth — by EXECUTING that source, never by reading it.
#
# The engine side of every comparison comes from a probe that imports the
# domain module and observes `parseBuildReviewFindingAnchor` accepting and
# rejecting discriminating specimens. Enforcement truth is behavior: a grammar
# change anywhere in the implementation — helper body, regex constant, imported
# pattern, or call-site routing — either changes what the parser accepts (drift
# is reported against the SKILL.md contract) or leaves acceptance intact (no
# drift exists to report). There is no textual extraction to fool one
# indirection deeper.
#
# Fail-closed properties, each pinned by a fixture below:
# - a field whose parser accepts garbage is UNENFORCED (stale contract, or a
#   passthrough parser) and fails the guard;
# - a field whose acceptance matches no known grammar is UNCLASSIFIABLE and
#   fails the guard;
# - a parser that rejects the fully-documented specimen anchor (renamed field,
#   new required field, rerouted read) fails the guard as BASELINE-REJECTED;
# - an unreadable or unimportable domain source fails the guard.
#
# The probe's specimen anchors are test INPUT, not a parallel declaration of
# enforcement: when the engine grows a new required anchor field, the baseline
# is rejected and this guard fails until the specimen table and the SKILL.md
# contract are updated together.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
failures=0

probe_script=$(mktemp --suffix=.mts)
trap 'rm -rf "$probe_script" "${fixture_dir:-}"' EXIT
cat >"$probe_script" <<'PROBE'
/* Behavioral reference-grammar probe. argv[2] = domain module path.
 * Emits, per rubric:
 *   "<rubric> vocab <member>"        — every string leaf of the exported
 *                                      BUILD_REVIEW_FINDING_VOCABULARIES entry
 *   "<rubric> <field>=<grammar>"     — enforced grammar, classified by behavior
 *   "<rubric> !baseline-rejected"    — no specimen anchor is accepted at all
 *   "<rubric> <field>!unenforced"    — the field accepts garbage
 *   "<rubric> <field>!unclassifiable" — acceptance matches no known grammar
 */
const domainPath = process.argv[2];
const mod = await import(domainPath);
const parseAnchor = mod.parseBuildReviewFindingAnchor as (
  value: unknown, references?: unknown, contractVersion?: string,
) => unknown;
if (typeof parseAnchor !== 'function') {
  console.error(`probe: ${domainPath} does not export parseBuildReviewFindingAnchor`);
  process.exit(1);
}
const vocabularies = (mod.BUILD_REVIEW_FINDING_VOCABULARIES ?? {}) as Record<string, unknown>;

const OBJ = Object.freeze({
  path: 'src/probe.ts',
  contentHash: `sha256:${'a'.repeat(64)}`,
  display: 'probe region',
});
const PATH = 'src/probe.ts';
const TASK = '11';
const TASK_WORDY = 'rem-scope-2';
const TITLED = 'Task 11: probe outcome';
const GARBAGE = '::: not a reference :::';

// Reference fields under test, plus the non-reference specimens the parser
// needs alongside them. Classification members are read from the module's own
// exported vocabulary when present, so the probe follows the engine.
function member(rubric: string, field: string, fallback: string): string {
  const anchorFields = (vocabularies[rubric] as { anchorFields?: Record<string, readonly string[]> } | undefined)?.anchorFields;
  return anchorFields?.[field]?.[0] ?? fallback;
}
const RUBRICS: Record<string, { referenceFields: string[]; fixed: Record<string, string> }> = {
  testQuality: {
    referenceFields: ['locus'],
    fixed: {},
  },
  scope: {
    referenceFields: ['path'],
    fixed: { relation: member('scope', 'relation', 'not-authorized-by-plan') },
  },
  rootCause: {
    referenceFields: ['locus'],
    fixed: { statedDefect: 'probe defect', relation: member('rootCause', 'relation', 'symptom-only-fix') },
  },
  completeness: {
    referenceFields: ['planTask', 'missingSurface'],
    fixed: { missingOutcome: 'probe outcome', missingKind: member('completeness', 'missingKind', 'missing-deliverable') },
  },
};
const SPECIMENS: Record<string, unknown> = { OBJ, PATH, TASK, TASK_WORDY, TITLED, GARBAGE };
const BASELINE_CANDIDATES = ['OBJ', 'PATH', 'TASK'];

function vocabLeaves(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const entry of value) vocabLeaves(entry, out);
  else if (value && typeof value === 'object') for (const entry of Object.values(value)) vocabLeaves(entry, out);
}

for (const [rubric, shape] of Object.entries(RUBRICS)) {
  const leaves = new Set<string>();
  vocabLeaves(vocabularies[rubric], leaves);
  for (const leaf of [...leaves].sort()) console.log(`${rubric} vocab ${leaf}`);

  const accepts = (assignment: Record<string, unknown>): boolean => {
    const anchor: Record<string, unknown> = { rubric, ...shape.fixed, ...assignment };
    try {
      return Boolean(parseAnchor(anchor, undefined, 'v3'));
    } catch {
      return false;
    }
  };

  // Find an accepted baseline assignment for every reference field.
  let baseline: Record<string, unknown> | undefined;
  const search = (fields: string[], acc: Record<string, unknown>): void => {
    if (baseline) return;
    if (fields.length === 0) {
      if (accepts(acc)) baseline = { ...acc };
      return;
    }
    const [head, ...rest] = fields;
    for (const name of BASELINE_CANDIDATES) search(rest, { ...acc, [head]: SPECIMENS[name] });
  };
  search(shape.referenceFields, {});
  if (!baseline) {
    console.log(`${rubric} !baseline-rejected`);
    continue;
  }

  for (const field of shape.referenceFields) {
    const test = (name: string): boolean => accepts({ ...baseline, [field]: SPECIMENS[name] });
    if (test('GARBAGE')) {
      console.log(`${rubric} ${field}!unenforced`);
      continue;
    }
    if (test('OBJ')) console.log(`${rubric} ${field}=content-region`);
    else if (test('PATH')) console.log(`${rubric} ${field}=path`);
    else if (test('TASK') && test('TASK_WORDY') && test('TITLED')) console.log(`${rubric} ${field}=plan-task`);
    else console.log(`${rubric} ${field}!unclassifiable`);
  }
}
PROBE

# One probe execution per domain file, cached; tsx resolves the real domain's
# imports from src/conductor, and the self-contained fixtures import nothing.
declare -A probe_cache
probe_domain() {
  local domain_file=$1
  if [ -z "${probe_cache[$domain_file]:-}" ]; then
    local output
    if ! output=$( (cd "$HARNESS_DIR/src/conductor" && node --import tsx "$probe_script" "$domain_file") 2>/dev/null ); then
      return 1
    fi
    probe_cache[$domain_file]=$output
  fi
  printf '%s\n' "${probe_cache[$domain_file]}"
}

extract_documented_vocabulary() {
  local skill_file=$1
  sed -n '/^\*\*Closed vocabulary:\*\*/,/^$/p' "$skill_file" \
    | grep -oE '`[^`]+`' \
    | tr -d '`' \
    | sort -u
}

extract_documented_reference_grammars() {
  local skill_file=$1

  grep '^\*\*Reference grammar:\*\*' "$skill_file" \
    | grep -oE '`anchor\.[A-Za-z][A-Za-z0-9]*` is a `[a-z-]+` reference' \
    | sed -E 's/`anchor\.([A-Za-z][A-Za-z0-9]*)` is a `([a-z-]+)` reference/\1=\2/' \
    | sort -u
}

check_vocabulary_drift() {
  local domain_file=$1
  local harness_dir=$2
  local rubric skill_file engine_vocabulary documented_vocabulary probe_output

  if [ ! -r "$domain_file" ]; then
    echo "could not read build-review reference grammar source: ${domain_file}" >&2
    return 1
  fi
  if ! probe_output=$(probe_domain "$domain_file"); then
    echo "could not execute build-review anchor parser from ${domain_file}" >&2
    return 1
  fi

  for rubric in testQuality; do
    skill_file="$harness_dir/skills/build-review-test-quality/SKILL.md"
    if [ ! -f "$skill_file" ]; then
      echo "missing vocabulary source for ${rubric}: ${skill_file}" >&2
      return 1
    fi

    engine_vocabulary=$(awk -v rubric="$rubric" '$1 == rubric && $2 == "vocab" { print $3 }' <<<"$probe_output" | sort -u)
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

check_reference_grammar_drift() {
  local domain_file=$1
  local harness_dir=$2
  local rubric skill_file engine_grammars documented_grammars field grammar probe_output failure_lines

  if [ ! -r "$domain_file" ]; then
    echo "could not read build-review reference grammar source: ${domain_file}" >&2
    return 1
  fi
  if ! probe_output=$(probe_domain "$domain_file"); then
    echo "could not execute build-review anchor parser from ${domain_file}" >&2
    return 1
  fi

  for rubric in testQuality; do
    skill_file="$harness_dir/skills/build-review-test-quality/SKILL.md"
    if [ ! -r "$skill_file" ]; then
      echo "could not read build-review ${rubric} reference grammar contract: ${skill_file}" >&2
      return 1
    fi

    if grep -qE "^${rubric} !baseline-rejected$" <<<"$probe_output"; then
      echo "build-review ${rubric} reference grammar drift: the parser rejected the fully-documented specimen anchor — update the anchor contract and the probe specimens together" >&2
      return 1
    fi
    failure_lines=$(awk -v rubric="$rubric" '$1 == rubric && $2 ~ /!/ { print $2 }' <<<"$probe_output")
    if [ -n "$failure_lines" ]; then
      while IFS='!' read -r field reason; do
        [ -n "$field" ] || continue
        if [ "$reason" = 'unenforced' ]; then
          echo "build-review ${rubric} reference grammar drift: anchor.${field} accepts arbitrary input — the parser no longer enforces a reference grammar for it" >&2
        else
          echo "build-review ${rubric} reference grammar drift: anchor.${field} acceptance matches no known reference grammar" >&2
        fi
      done <<<"$failure_lines"
      return 1
    fi

    engine_grammars=$(awk -v rubric="$rubric" '$1 == rubric && $2 ~ /=/ { print $2 }' <<<"$probe_output" | sort -u)
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

fixture_dir=$(mktemp -d)
fixture_domain="$fixture_dir/build-review-domain.ts"
fixture_harness="$fixture_dir/harness"
mkdir -p "$fixture_harness/skills"

# Self-contained executable fixture: the REAL grammar regexes and titled
# normalization, with none of the engine's imports, so every scenario below
# exercises the probe against genuine accept/reject behavior.
cat >"$fixture_domain" <<'EOF'
export const BUILD_REVIEW_FINDING_VOCABULARIES = Object.freeze({
  testQuality: Object.freeze({
    concernKinds: Object.freeze(['test-insensitive']),
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

const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';
const CANONICAL_PATH_REFERENCE = /^(?!\/)(?!.*(?:^|\/)\.?(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9.][A-Za-z0-9._/@+-]*(?:\/[A-Za-z0-9.][A-Za-z0-9._/@+-]*)*$/;
const CANONICAL_PLAN_TASK_REFERENCE = new RegExp(`^${TASK_ID_PATTERN}$`);
const TITLED_PLAN_TASK_REFERENCE = new RegExp(`^Task\\s+(${TASK_ID_PATTERN}):\\s+.+$`);

function parseContentRegionReference(value: unknown): unknown {
  const source = value as Record<string, unknown> | null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  return typeof source.path === 'string' && CANONICAL_PATH_REFERENCE.test(source.path) &&
    typeof source.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(source.contentHash) &&
    typeof source.display === 'string' && source.display.length > 0
    ? source
    : undefined;
}
function parseBuildReviewCanonicalPathReference(value: unknown): unknown {
  return typeof value === 'string' && CANONICAL_PATH_REFERENCE.test(value) ? value : undefined;
}
function parseBuildReviewCanonicalPlanTaskReference(value: unknown): unknown {
  if (typeof value !== 'string') return undefined;
  return value.match(TITLED_PLAN_TASK_REFERENCE)?.[1] ??
    (CANONICAL_PLAN_TASK_REFERENCE.test(value) ? value : undefined);
}
function verifiedReference(value: unknown, parser: (candidate: unknown) => unknown): unknown { return parser(value); }

export function parseBuildReviewFindingAnchor(value: Record<string, unknown>): unknown {
  const source = value;
  switch (source.rubric) {
    case 'testQuality':
      return parseContentRegionReference(source.locus);
    case 'scope':
      return verifiedReference(source.path, parseBuildReviewCanonicalPathReference);
    case 'rootCause':
      return parseContentRegionReference(source.locus);
    case 'completeness': {
      const planTask = verifiedReference(source.planTask, parseBuildReviewCanonicalPlanTaskReference);
      return verifiedReference(source.missingSurface, parseBuildReviewCanonicalPathReference) && planTask;
    }
  }
}
EOF

for rubric in test-quality scope root-cause completeness; do
  mkdir -p "$fixture_harness/skills/build-review-$rubric"
done

printf '%s\n' '**Closed vocabulary:** `test-insensitive`' \
  >"$fixture_harness/skills/build-review-test-quality/SKILL.md"
printf '\n%s\n' '**Reference grammar:** `anchor.locus` is a `content-region` reference.' \
  >>"$fixture_harness/skills/build-review-test-quality/SKILL.md"
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

# The aligned fixture must pass both checks before any drift scenario runs.
if ! check_vocabulary_drift "$fixture_domain" "$fixture_harness" >/dev/null; then
  echo 'rubric vocabulary guard unexpectedly rejected the aligned executable fixture' >&2
  failures=1
elif ! check_reference_grammar_drift "$fixture_domain" "$fixture_harness"; then
  echo 'rubric reference-grammar guard unexpectedly rejected the aligned executable fixture' >&2
  failures=1
else
  echo 'rubric guards accept the aligned executable fixture'
fi

run_drift_fixture() {
  local label=$1 domain=$2 harness=$3 expected=$4
  local fixture_output
  if fixture_output=$(check_reference_grammar_drift "$domain" "$harness" 2>&1); then
    echo "known gap: reference-grammar guard accepts ${label}" >&2
    failures=1
  elif grep -Fq "$expected" <<<"$fixture_output"; then
    echo "rubric reference-grammar guard rejects ${label}"
  else
    echo "rubric reference-grammar guard rejected ${label} without the required diagnostic" >&2
    echo "$fixture_output" >&2
    failures=1
  fi
}

fixture_missing_domain="$fixture_dir/missing-build-review-domain.ts"
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

# A domain source that cannot be executed must fail closed, never pass on an
# empty probe result.
fixture_broken="$fixture_dir/build-review-domain-broken.ts"
printf '%s\n' 'export const BUILD_REVIEW_FINDING_VOCABULARIES = {' >"$fixture_broken"
if fixture_output=$(check_reference_grammar_drift "$fixture_broken" "$fixture_harness" 2>&1); then
  echo 'known gap: reference-grammar guard accepts an unexecutable parser source' >&2
  failures=1
elif grep -Fq "could not execute build-review anchor parser from $fixture_broken" <<<"$fixture_output"; then
  echo 'rubric reference-grammar guard fails closed on an unexecutable parser source'
else
  echo 'rubric reference-grammar guard rejected unexecutable parser source without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

if ! check_vocabulary_drift "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$HARNESS_DIR"; then
  failures=1
fi

if ! check_reference_grammar_drift "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$HARNESS_DIR"; then
  failures=1
fi

exit "$failures"
