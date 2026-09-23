#!/usr/bin/env bash
set -euo pipefail

# Keep the provider-facing concern-kind definitions and anchor reference
# grammar in the active rubric SKILL.md contract equal to the engine's single
# source of truth — by executing the built descriptor, never by reading an
# implementation-side vocabulary constant.
#
# Concern kinds come from each built rubric descriptor's
# `output.jsonSchema.properties.findings.items.properties.concernKind.enum`.
# Reference grammar still comes from the parser-behavior probe below.
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
cat >"$probe_script" <<'PROBE'
/* Behavioral reference-grammar probe. argv[2] = domain module path.
 * Emits, per rubric:
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
const OBJ = Object.freeze({
  path: 'src/probe.ts',
  contentHash: `sha256:${'a'.repeat(64)}`,
  display: 'probe region',
});
const PATH = 'src/probe.ts';
const GARBAGE = '::: not a reference :::';

const RUBRICS: Record<string, { referenceFields: string[]; fixed: Record<string, string> }> = {
  testQuality: {
    referenceFields: ['locus'],
    fixed: {},
  },
  security: {
    referenceFields: ['locus'],
    fixed: {},
  },
};
const SPECIMENS: Record<string, unknown> = { OBJ, PATH, GARBAGE };
const BASELINE_CANDIDATES = ['OBJ', 'PATH', 'TASK'];

for (const [rubric, shape] of Object.entries(RUBRICS)) {
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

schema_probe_script=$(mktemp --suffix=.mts)
trap 'rm -rf "$probe_script" "$schema_probe_script" "${fixture_dir:-}"' EXIT
cat >"$schema_probe_script" <<'PROBE'
/* Descriptor-schema vocabulary probe. argv[2] is a built contract module.
 * It deliberately reads the native-schema source used for provider dispatch,
 * rather than a helper vocabulary or parser implementation.
 */
const contractPath = process.argv[2];
const mod = await import(contractPath);
const descriptorFor = mod.getBuildReviewRubricDescriptor as ((rubric: string) => unknown) | undefined;
if (typeof descriptorFor !== 'function') {
  console.error(`probe: ${contractPath} does not export getBuildReviewRubricDescriptor`);
  process.exit(1);
}

const testOverride = process.env.BUILD_REVIEW_RUBRIC_VOCAB_TEST_OVERRIDE;
if (testOverride !== undefined && process.env.BUILD_REVIEW_RUBRIC_VOCAB_TEST_MODE !== '1') {
  console.error('probe: BUILD_REVIEW_RUBRIC_VOCAB_TEST_OVERRIDE is test-only; set BUILD_REVIEW_RUBRIC_VOCAB_TEST_MODE=1');
  process.exit(1);
}

const overrides = new Map<string, string[]>();
if (testOverride !== undefined) {
  for (const entry of testOverride.split(';')) {
    const [rubric, member] = entry.split(':', 2);
    if (!rubric || !member) {
      console.error(`probe: malformed test vocabulary override ${JSON.stringify(entry)}`);
      process.exit(1);
    }
    overrides.set(rubric, [...(overrides.get(rubric) ?? []), member]);
  }
}

for (const rubric of ['testQuality', 'security']) {
  const descriptor = descriptorFor(rubric) as {
    contract?: { output?: { jsonSchema?: { properties?: { findings?: { items?: { properties?: { concernKind?: { enum?: unknown } } } } } } } };
  };
  const enumeration = descriptor.contract?.output?.jsonSchema?.properties?.findings?.items?.properties?.concernKind?.enum;
  if (!Array.isArray(enumeration) || enumeration.some((member) => typeof member !== 'string')) {
    console.error(`probe: ${rubric} descriptor has no string concernKind enum`);
    process.exit(1);
  }
  for (const member of [...new Set([...enumeration, ...(overrides.get(rubric) ?? [])])].sort()) {
    console.log(`${rubric} enum ${member}`);
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
  awk '
    /^## Judgement$/ { judgement=1; next }
    /^## / { judgement=0 }
    judgement && /^- `[-a-z]+` —/ { line=$0; sub(/^- `/, "", line); sub(/`.*/, "", line); print line }
    judgement && /Raise `[-a-z]+` only/ { line=$0; sub(/.*Raise `/, "", line); sub(/`.*/, "", line); print line }
  ' "$skill_file" | sort -u
}

probe_descriptor_schema() {
  local contract_module=$1
  (cd "$HARNESS_DIR/src/conductor" && node --import tsx "$schema_probe_script" "$contract_module")
}

check_vocabulary_drift() {
  local contract_module=$1
  local harness_dir=$2
  local rubric skill_file descriptor_vocabulary documented_vocabulary probe_output descriptor_only skill_only

  if [ ! -r "$contract_module" ]; then
    echo "build-review vocabulary guard !unenforced: could not read built descriptor module: ${contract_module}" >&2
    return 1
  fi
  if ! probe_output=$(probe_descriptor_schema "$contract_module" 2>&1); then
    echo "build-review vocabulary guard !unenforced: could not import built descriptor module: ${contract_module}" >&2
    echo "$probe_output" >&2
    return 1
  fi

  for rubric in testQuality security; do
    skill_file="$harness_dir/skills/build-review-$(rubric_skill_name "$rubric")/SKILL.md"
    if [ ! -f "$skill_file" ]; then
      echo "missing vocabulary source for ${rubric}: ${skill_file}" >&2
      return 1
    fi

    descriptor_vocabulary=$(awk -v rubric="$rubric" '$1 == rubric && $2 == "enum" { print $3 }' <<<"$probe_output" | sort -u)
    documented_vocabulary=$(extract_documented_vocabulary "$skill_file")
    if [ -z "$descriptor_vocabulary" ]; then
      echo "build-review ${rubric} vocabulary guard !unenforced: descriptor did not expose concernKind.enum" >&2
      return 1
    fi
    if [ -z "$documented_vocabulary" ]; then
      echo "build-review ${rubric} vocabulary guard !unclassifiable: no concern-kind definitions under exact ## Judgement" >&2
      return 1
    fi

    descriptor_only=$(comm -23 <(printf '%s\n' "$descriptor_vocabulary") <(printf '%s\n' "$documented_vocabulary"))
    skill_only=$(comm -13 <(printf '%s\n' "$descriptor_vocabulary") <(printf '%s\n' "$documented_vocabulary"))
    if [ -n "$descriptor_only" ]; then
      echo "build-review ${rubric} vocabulary drift: descriptor enum admits an unpaired member: ${descriptor_only}" >&2
      return 1
    fi
    if [ -n "$skill_only" ]; then
      echo "build-review ${rubric} vocabulary drift: SKILL.md defines an unpaired member: ${skill_only}" >&2
      return 1
    fi
    echo "build-review ${rubric} descriptor enum and SKILL.md judgement kinds are equal"
  done
}

check_reference_grammar_drift() {
  local domain_file=$1
  local rubric engine_grammars probe_output failure_lines

  if [ ! -r "$domain_file" ]; then
    echo "could not read build-review reference grammar source: ${domain_file}" >&2
    return 1
  fi
  if ! probe_output=$(probe_domain "$domain_file"); then
    echo "could not execute build-review anchor parser from ${domain_file}" >&2
    return 1
  fi

  for rubric in testQuality security; do
    if grep -qE "^${rubric} !baseline-rejected$" <<<"$probe_output"; then
      echo "build-review ${rubric} reference grammar drift !baseline-rejected: the parser rejected the fully-documented specimen anchor — update the anchor contract and the probe specimens together" >&2
      return 1
    fi
    failure_lines=$(awk -v rubric="$rubric" '$1 == rubric && $2 ~ /!/ { print $2 }' <<<"$probe_output")
    if [ -n "$failure_lines" ]; then
      while IFS='!' read -r field reason; do
        [ -n "$field" ] || continue
        if [ "$reason" = 'unenforced' ]; then
          echo "build-review ${rubric} reference grammar drift !unenforced: anchor.${field} accepts arbitrary input — the parser no longer enforces a reference grammar for it" >&2
        else
          echo "build-review ${rubric} reference grammar drift !unclassifiable: anchor.${field} acceptance matches no known reference grammar" >&2
        fi
      done <<<"$failure_lines"
      return 1
    fi

    engine_grammars=$(awk -v rubric="$rubric" '$1 == rubric && $2 ~ /=/ { print $2 }' <<<"$probe_output" | sort -u)
    if [ -z "$engine_grammars" ]; then
      echo "could not extract build-review ${rubric} reference grammar bindings from ${domain_file}" >&2
      return 1
    fi
  done
}

rubric_skill_name() {
  case "$1" in
    testQuality) printf '%s' test-quality ;;
    security) printf '%s' security ;;
    *) return 1 ;;
  esac
}

fixture_dir=$(mktemp -d)
fixture_domain="$fixture_dir/build-review-domain.ts"
fixture_harness="$fixture_dir/harness"
mkdir -p "$fixture_harness/skills"

# Self-contained executable fixture: the REAL grammar regexes and titled
# normalization, with none of the engine's imports, so every scenario below
# exercises the probe against genuine accept/reject behavior.
cat >"$fixture_domain" <<'EOF'
const CANONICAL_PATH_REFERENCE = /^(?!\/)(?!.*(?:^|\/)\.?(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9.][A-Za-z0-9._/@+-]*(?:\/[A-Za-z0-9.][A-Za-z0-9._/@+-]*)*$/;

function parseContentRegionReference(value: unknown): unknown {
  const source = value as Record<string, unknown> | null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  return typeof source.path === 'string' && CANONICAL_PATH_REFERENCE.test(source.path) &&
    typeof source.contentHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(source.contentHash) &&
    typeof source.display === 'string' && source.display.length > 0
    ? source
    : undefined;
}
export function parseBuildReviewFindingAnchor(value: Record<string, unknown>): unknown {
  const source = value;
  return source.rubric === 'testQuality' || source.rubric === 'security'
    ? parseContentRegionReference(source.locus)
    : undefined;
}
const concernKinds = {
  testQuality: ['test-insensitive'],
  security: [
    'committed-secret', 'injection', 'broken-access-control', 'path-traversal',
    'unsafe-deserialization', 'cryptographic-failure', 'security-misconfiguration',
    'authentication-failure', 'integrity-failure', 'ssrf',
  ],
};
export function getBuildReviewRubricDescriptor(rubric: keyof typeof concernKinds): unknown {
  return { contract: { output: { jsonSchema: { properties: { findings: { items: { properties: {
    concernKind: { enum: concernKinds[rubric] },
  } } } } } } } };
}
EOF

for rubric in test-quality security; do
  mkdir -p "$fixture_harness/skills/build-review-$rubric"
done

printf '%s\n' '## Judgement' 'Raise `test-insensitive` only when the test is stub-passable.' \
  >"$fixture_harness/skills/build-review-test-quality/SKILL.md"
printf '\n%s\n' '**Reference grammar:** `anchor.locus` is a `content-region` reference.' \
  >>"$fixture_harness/skills/build-review-test-quality/SKILL.md"
printf '%s\n' '## Judgement' \
  '- `committed-secret` — definition' '- `injection` — definition' '- `broken-access-control` — definition' '- `path-traversal` — definition' \
  '- `unsafe-deserialization` — definition' '- `cryptographic-failure` — definition' '- `security-misconfiguration` — definition' \
  '- `authentication-failure` — definition' '- `integrity-failure` — definition' '- `ssrf` — definition' \
  >"$fixture_harness/skills/build-review-security/SKILL.md"
printf '\n%s\n' '**Reference grammar:** `anchor.locus` is a `content-region` reference.' \
  >>"$fixture_harness/skills/build-review-security/SKILL.md"

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

run_vocabulary_drift_fixture() {
  local label=$1 contract_module=$2 harness=$3 expected_rubric=$4 expected_member=$5
  local fixture_output
  if fixture_output=$(check_vocabulary_drift "$contract_module" "$harness" 2>&1); then
    echo "known gap: vocabulary guard accepts ${label}" >&2
    failures=1
  elif grep -Fq "$expected_rubric" <<<"$fixture_output" && grep -Fq "$expected_member" <<<"$fixture_output"; then
    echo "rubric vocabulary guard rejects ${label}"
  else
    echo "rubric vocabulary guard rejected ${label} without the required diagnostic" >&2
    echo "$fixture_output" >&2
    failures=1
  fi
}

fixture_skill_extra_harness="$fixture_dir/harness-skill-extra"
cp -R "$fixture_harness" "$fixture_skill_extra_harness"
cp "$HARNESS_DIR/test/fixtures/build-review-skill-vocab/extra-skill-kind.md" \
  "$fixture_skill_extra_harness/skills/build-review-security/SKILL.md"
run_vocabulary_drift_fixture \
  'a skill-side extra security vocabulary member' "$fixture_domain" "$fixture_skill_extra_harness" security unknown-security-kind

if fixture_output=$(BUILD_REVIEW_RUBRIC_VOCAB_TEST_MODE=1 BUILD_REVIEW_RUBRIC_VOCAB_TEST_OVERRIDE='security:unknown-security-kind' \
  check_vocabulary_drift "$fixture_domain" "$fixture_harness" 2>&1); then
  echo 'known gap: vocabulary guard accepts a descriptor enum extra member' >&2
  failures=1
elif grep -Fq 'descriptor enum admits an unpaired member: unknown-security-kind' <<<"$fixture_output"; then
  echo 'rubric vocabulary guard rejects a descriptor enum extra member'
else
  echo 'rubric vocabulary guard rejected descriptor enum extra member without the required diagnostic' >&2
  echo "$fixture_output" >&2
  failures=1
fi

fixture_renamed_judgement_harness="$fixture_dir/harness-renamed-judgement"
cp -R "$fixture_harness" "$fixture_renamed_judgement_harness"
cp "$HARNESS_DIR/test/fixtures/build-review-skill-vocab/renamed-judgement.md" \
  "$fixture_renamed_judgement_harness/skills/build-review-security/SKILL.md"
if fixture_output=$(check_vocabulary_drift "$fixture_domain" "$fixture_renamed_judgement_harness" 2>&1); then
  echo 'known gap: vocabulary guard accepts a renamed Judgement section' >&2
  failures=1
elif grep -Fq '!unclassifiable' <<<"$fixture_output"; then
  echo 'rubric vocabulary guard rejects a renamed Judgement section as !unclassifiable'
else
  echo 'rubric vocabulary guard rejected renamed Judgement section without !unclassifiable' >&2
  echo "$fixture_output" >&2
  failures=1
fi

fixture_unimportable_contract="$fixture_dir/unimportable-contract.mjs"
printf '%s\n' 'export const malformed = ;' >"$fixture_unimportable_contract"
if fixture_output=$(check_vocabulary_drift "$fixture_unimportable_contract" "$fixture_harness" 2>&1); then
  echo 'known gap: vocabulary guard accepts an unimportable descriptor module' >&2
  failures=1
elif grep -Fq '!unenforced' <<<"$fixture_output"; then
  echo 'rubric vocabulary guard fails closed as !unenforced on an unimportable descriptor module'
else
  echo 'rubric vocabulary guard rejected unimportable descriptor module without !unenforced' >&2
  echo "$fixture_output" >&2
  failures=1
fi

descriptor_module=$(rg -l '^function getBuildReviewRubricDescriptor\(' "$HARNESS_DIR/src/conductor/dist" --glob '*.js' | head -n 1 || true)
if [ -z "$descriptor_module" ]; then
  echo 'build-review vocabulary guard !unenforced: could not locate the built descriptor module' >&2
  failures=1
elif ! check_vocabulary_drift "$descriptor_module" "$HARNESS_DIR"; then
  failures=1
fi

if ! check_reference_grammar_drift "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$HARNESS_DIR"; then
  failures=1
fi

exit "$failures"
