// Covers: task:5
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = join(__dirname, '..', '..');
const REPOSITORY_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const CI_WORKFLOW = join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml');

type WorkflowJob = Record<string, unknown>;

function jobBlock(workflow: string, job: string): string | undefined {
  const match = new RegExp(`^  ${job}:\\n`, 'm').exec(workflow);
  if (!match || match.index === undefined) return undefined;

  const remainder = workflow.slice(match.index + match[0].length);
  const nextJob = remainder.search(/^  [a-zA-Z0-9_-]+:/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

/** Returns the independently repairable missing pieces of docs-corpus CI wiring. */
export function docsCorpusWiringGaps(workflowText: string): string[] {
  const gaps: string[] = [];
  const docsCorpus = jobBlock(workflowText, 'docs-corpus');
  const ciGate = jobBlock(workflowText, 'ci-gate');

  if (!docsCorpus) {
    gaps.push('job');
  } else {
    if (!/^    if: needs\.changes\.outputs\.docs_only == 'true'$/m.test(docsCorpus)) {
      gaps.push('docs-only-condition');
    }
    if (!/      - run: npm test -- test\/corpus\/\n        working-directory: src\/conductor/.test(docsCorpus)) {
      gaps.push('tier-selection');
    }
  }

  if (!ciGate || !/^    needs: \[[^\]]*\bdocs-corpus\b[^\]]*\]$/m.test(ciGate)) {
    gaps.push('ci-gate-needs');
  }
  if (
    !ciGate
    || !/^          DOCS_CORPUS: \$\{\{ needs\.docs-corpus\.result \}\}$/m.test(ciGate)
    || !/for r in [^\n]*"\$DOCS_CORPUS"[^\n]*; do/.test(ciGate)
  ) {
    gaps.push('ci-gate-result');
  }

  return gaps;
}

function wiredWorkflow(workflow: string): string {
  if (jobBlock(workflow, 'docs-corpus')) return workflow;

  const docsCorpus = `  docs-corpus:\n    needs: changes\n    if: needs.changes.outputs.docs_only == 'true'\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test -- test/corpus/\n        working-directory: src/conductor\n\n`;
  return workflow
    .replace('  ci-gate:\n', `${docsCorpus}  ci-gate:\n`)
    .replace('needs: [changes, integrity, shellcheck, lint, typecheck, conductor, conductor-e2e, links]', 'needs: [changes, integrity, shellcheck, lint, typecheck, conductor, conductor-e2e, links, docs-corpus]')
    .replace('          LINKS: ${{ needs.links.result }}', '          LINKS: ${{ needs.links.result }}\n          DOCS_CORPUS: ${{ needs.docs-corpus.result }}')
    .replace('"$CONDUCTOR_E2E" "$LINKS"; do', '"$CONDUCTOR_E2E" "$LINKS" "$DOCS_CORPUS"; do');
}

function workflowJob(value: unknown, label: string): WorkflowJob {
  expect(value, `${label} must be a mapping`).toBeTypeOf('object');
  expect(value, `${label} must not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as WorkflowJob;
}

function globMatches(pattern: string, path: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${expression}$`).test(path);
}

describe('structural: docs-corpus CI wiring', () => {
  const workflow = readFileSync(CI_WORKFLOW, 'utf8');

  it('has complete docs-corpus wiring in the real workflow', () => {
    expect(docsCorpusWiringGaps(workflow)).toEqual([]);
  });

  it.each([
    ['job', (source: string) => source.replace(/^  docs-corpus:[\s\S]*?(?=^  ci-gate:)/m, '')],
    ['docs-only-condition', (source: string) => source.replace("if: needs.changes.outputs.docs_only == 'true'", 'if: always()')],
    ['tier-selection', (source: string) => source.replace('npm test -- test/corpus/', 'npm test')],
    ['ci-gate-needs', (source: string) => source.replace(', docs-corpus]', ']')],
    ['ci-gate-result', (source: string) => source.replace('"$CONDUCTOR_E2E" "$LINKS" "$DOCS_CORPUS"; do', '"$CONDUCTOR_E2E" "$LINKS"; do')],
  ] as const)('reports only the %s mutation', (gap, mutate) => {
    expect(docsCorpusWiringGaps(mutate(wiredWorkflow(workflow)))).toEqual([gap]);
  });

  it('keeps the live-corpus tier nonempty and covered by the default Vitest selection', () => {
    const tierFiles = readdirSync(join(CONDUCTOR_ROOT, 'test', 'corpus'))
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => `test/corpus/${file}`);
    expect(tierFiles, 'live-corpus tier is empty').not.toEqual([]);

    const config = readFileSync(join(CONDUCTOR_ROOT, 'vitest.config.ts'), 'utf8');
    const include = [...config.matchAll(/include:\s*\[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]));
    const exclude = [...config.matchAll(/exclude:\s*\[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]));

    for (const file of tierFiles) {
      expect(include.some((pattern) => globMatches(pattern, file)), `${file} is not included by default Vitest`).toBe(true);
      expect(exclude.some((pattern) => globMatches(pattern, file)), `${file} is excluded by default Vitest`).toBe(false);
    }
  });

  it('fails ci-gate when the docs-corpus result fails or is cancelled', () => {
    const parsed = workflowJob(loadYaml(wiredWorkflow(workflow)), 'CI workflow');
    const jobs = workflowJob(parsed.jobs, 'CI workflow jobs');
    const ciGate = workflowJob(jobs['ci-gate'], 'ci-gate job');
    const steps = ciGate.steps as Array<Record<string, unknown>>;
    const script = String(steps.find((step) => step.run)?.run ?? '');
    const baseEnv = {
      ...process.env,
      CHANGES: 'success', INTEGRITY: 'skipped', SHELLCHECK: 'success', LINT: 'skipped',
      TYPECHECK: 'success', CONDUCTOR: 'skipped', CONDUCTOR_E2E: 'success', LINKS: 'success',
      DOCS_CORPUS: 'success',
    };

    expect(spawnSync('bash', ['-c', script], { encoding: 'utf8', env: baseEnv }).status).toBe(0);
    expect(spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...baseEnv, DOCS_CORPUS: 'failure' } }).status).toBe(1);
    expect(spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...baseEnv, DOCS_CORPUS: 'cancelled' } }).status).toBe(1);
  });

  it('keeps conductor docs-only gating and its full-suite step unchanged', () => {
    const conductor = jobBlock(workflow, 'conductor');
    expect(conductor).toContain("    if: needs.changes.outputs.docs_only != 'true'");
    expect(conductor).toContain('- run: npm test -- --shard=${{ matrix.shard }}/4 --reporter=./test/reporters/ci-progress-reporter.ts\n        working-directory: src/conductor');
  });
});
