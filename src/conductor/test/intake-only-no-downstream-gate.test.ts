// Task 7 (FR-6): prove the pipeline does NOT gate on criteria downstream of
// intake. Operator directive: "No failures — enforce requirements at intake
// ONLY." Zero new downstream failure modes for missing priority/size/links.
//
// This is a verify-only assertion suite over the state left by Tasks 1-6 —
// it makes no production code changes. It asserts three independent facts:
//
//   1. dependency-claim.ts is untouched and its ClaimOutcome union has
//      exactly the members { claim, empty, all-blocked } — no
//      criteria/label-shaped outcome variant exists to gate a claim.
//   2. github-issues.ts's poll() enqueues an issue that is missing
//      size:/priority: labels with no blocking flag and no withheld
//      enqueue — captured exactly like a fully-labelled issue.
//   3. Neither ci.yml nor any daemon/pipeline gate source references
//      size:/priority:/linking labels as a pass/fail condition.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGithubIssuesAdapter, type GhRunner } from '../src/engine/engineer/intake/github-issues.js';
import { createLedger } from '../src/engine/engineer/intake/ledger.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo root: src/conductor/test/ -> ../../../ (src/conductor -> repo root)
const REPO_ROOT = join(__dirname, '..', '..', '..');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/** Resolve a safe local ref for `main` without fetching. Returns null if none exists. */
function resolveMainRef(): string | null {
  const candidates = ['origin/main', 'main'];
  for (const ref of candidates) {
    try {
      git(['rev-parse', '--verify', ref]);
      return ref;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const DEPENDENCY_CLAIM_PATH = 'src/conductor/src/engine/engineer/intake/dependency-claim.ts';
const GITHUB_ISSUES_PATH = 'src/conductor/src/engine/engineer/intake/github-issues.ts';
const CI_YML_PATH = '.github/workflows/ci.yml';

describe('intake-only enforcement: no downstream criteria gate (Task 7, FR-6)', () => {
  describe('1. dependency-claim.ts is untouched by criteria gating', () => {
    it('is byte-identical to main (when a safe main ref is resolvable)', () => {
      const ref = resolveMainRef();
      if (ref === null) {
        // No safe local ref for main without fetching — fall back to the
        // structural assertion below, which is the load-bearing one anyway.
        return;
      }
      const diff = git(['diff', ref, '--', DEPENDENCY_CLAIM_PATH]);
      expect(diff).toBe('');
    });

    it('exports a ClaimOutcome union with exactly the members claim | empty | all-blocked', () => {
      const src = readFileSync(join(REPO_ROOT, DEPENDENCY_CLAIM_PATH), 'utf8');

      // Locate the exported ClaimOutcome type declaration.
      const match = src.match(/export type ClaimOutcome =([\s\S]*?);\n/);
      expect(match).not.toBeNull();
      const body = match![1];

      // Extract every `kind: '<literal>'` discriminant mentioned in the union.
      const kinds = [...body.matchAll(/kind:\s*'([^']+)'/g)].map((m) => m[1]);
      expect(kinds.sort()).toEqual(['all-blocked', 'claim', 'empty'].sort());

      // No criteria/label-shaped outcome variant exists anywhere in the file.
      expect(src).not.toMatch(/needs-criteria/);
      expect(src).not.toMatch(/kind:\s*'blocked-by-criteria'/);
      expect(src).not.toMatch(/kind:\s*'missing-labels?'/);
    });
  });

  describe('2. github-issues.ts poll() enqueues issues missing size:/priority: labels', () => {
    it('captures an issue with no labels at all exactly like a fully-labelled one', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'intake-only-gate-'));
      try {
        const gh: GhRunner = async (args) => {
          if (args[0] === 'issue' && args[1] === 'list') {
            return {
              stdout: JSON.stringify([
                {
                  number: 42,
                  title: 'Missing all criteria labels',
                  body: 'No size:, no priority:, no linked PR — must still be captured.',
                  labels: [], // deliberately empty: no size:*, priority:*, or link labels
                },
              ]),
            };
          }
          return { stdout: '' };
        };
        const registry = { list: async () => [{ name: 'o/a', path: dir, ghRepo: 'o/a' }] };
        const ledger = createLedger(join(dir, 'ledger.json'));
        const adapter = createGithubIssuesAdapter({ gh, registry, ledger });

        const envelopes = await adapter.poll();

        // The criteria-incomplete issue was enqueued — not withheld, not
        // flagged as blocked, and status is the ordinary 'pending' used for
        // every freshly captured envelope (no special "needs-criteria" status).
        expect(envelopes).toHaveLength(1);
        const env = envelopes[0];
        expect(env.sourceRef).toBe('o/a#42');
        expect(env.status).toBe('pending');
        // No blocking/withholding flag of any kind on the envelope shape.
        expect(env).not.toHaveProperty('blocked');
        expect(env).not.toHaveProperty('withheld');
        expect(env).not.toHaveProperty('needsCriteria');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('enqueues a criteria-incomplete issue (missing size:/priority: labels) identically to a fully-labelled issue', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'intake-only-gate-cmp-'));
      try {
        const makeGh = (labels: Array<{ name: string }>): GhRunner => async (args) => {
          if (args[0] === 'issue' && args[1] === 'list') {
            return {
              stdout: JSON.stringify([
                { number: 7, title: 'Same issue text', body: 'body', labels },
              ]),
            };
          }
          return { stdout: '' };
        };

        const registryFor = (path: string) => ({ list: async () => [{ name: 'o/a', path, ghRepo: 'o/a' }] });

        // Fully-labelled issue.
        const dirLabelled = join(dir, 'labelled');
        const dirUnlabelled = join(dir, 'unlabelled');
        await import('node:fs/promises').then((fs) => Promise.all([
          fs.mkdir(dirLabelled, { recursive: true }),
          fs.mkdir(dirUnlabelled, { recursive: true }),
        ]));

        const labelledAdapter = createGithubIssuesAdapter({
          gh: makeGh([{ name: 'size:m' }, { name: 'priority:p1' }]),
          registry: registryFor(dirLabelled),
          ledger: createLedger(join(dirLabelled, 'ledger.json')),
        });
        const unlabelledAdapter = createGithubIssuesAdapter({
          gh: makeGh([]),
          registry: registryFor(dirUnlabelled),
          ledger: createLedger(join(dirUnlabelled, 'ledger.json')),
        });

        const [labelledOut, unlabelledOut] = await Promise.all([
          labelledAdapter.poll(),
          unlabelledAdapter.poll(),
        ]);

        expect(labelledOut).toHaveLength(1);
        expect(unlabelledOut).toHaveLength(1);
        // Same status, same shape — labels play no role in the capture decision.
        expect(unlabelledOut[0].status).toBe(labelledOut[0].status);
        expect(Object.keys(unlabelledOut[0]).sort()).toEqual(Object.keys(labelledOut[0]).sort());
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('3. no daemon/pipeline gate references size:/priority:/linking labels as pass/fail', () => {
    const LABEL_GATE_PATTERN = /\b(size|priority):[\w-]*.{0,80}(fail|block|gate|require|must|reject)/i;

    it('.github/workflows/ci.yml does not gate on size:/priority:/linking labels', () => {
      const text = readFileSync(join(REPO_ROOT, CI_YML_PATH), 'utf8');
      // No direct mention of the label prefixes at all in CI config.
      expect(text).not.toMatch(/\bsize:\s*['"]?[\w-]/i);
      expect(text).not.toMatch(/\bpriority:\s*['"]?[\w-]/i);
      expect(text).not.toMatch(LABEL_GATE_PATTERN);
    });

    it('daemon/pipeline gate sources under src/conductor/src do not gate on size:/priority: labels', () => {
      const gateDir = join(REPO_ROOT, 'src/conductor/src');
      const offenders: string[] = [];

      function walk(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
            const text = readFileSync(full, 'utf8');
            if (LABEL_GATE_PATTERN.test(text)) {
              offenders.push(full);
            }
          }
        }
      }
      walk(gateDir);

      expect(offenders).toEqual([]);
    });
  });
});
