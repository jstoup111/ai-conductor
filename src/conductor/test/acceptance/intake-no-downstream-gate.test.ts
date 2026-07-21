// ─────────────────────────────────────────────────────────────────────────────
// RED* acceptance spec for "The pipeline does NOT gate on criteria"
// (Story 6, FR-6, NEGATIVE PATH — load-bearing, Verify-only per plan Task 7;
// #695 intake-only-enforcement).
//
// Stories: .docs/stories/intake-only-enforcement.md (Story 6).
// Plan:    .docs/plans/intake-only-enforcement.md (Task 7 — "Verify-only: yes",
//          depends on Tasks 1, 3, 4, 6).
//
// *Exception to this feature's usual pre-implementation RED convention,
// documented explicitly (writing-system-tests skill, "Correctness gate" /
// §verify-claims): unlike Stories 1-3, Story 6 asserts the ABSENCE of a
// downstream failure mode that this feature must never introduce. Task 7 adds
// NO new production code of its own — it is Verify-only and depends on Tasks
// 1/3/4/6 already having landed. Driven against TODAY's untouched
// `dependency-claim.ts`, `github-issues.ts poll()`, and `.github/workflows/ci.yml`
// (none of which Tasks 1-4/6 are allowed to modify per the operator directive),
// every assertion in this file is expected to PASS right now — confirmed by
// running it below — and must KEEP passing after Tasks 1/3/4/6 land. That is
// the correct signal for a regression guard: it establishes the invariant
// BEFORE implementation touches anything nearby, so any future PR that adds a
// criteria gate to the claim path, poll(), or ci.yml breaks this spec
// immediately. (Verified via `git diff origin/main -- .../dependency-claim.ts`
// = empty and a direct run of this file, both confirmed while authoring this
// spec.) This file therefore does NOT need to fail for RED to be established
// for the feature as a whole — Stories 1-3's specs (intake-form-label-sync,
// intake-file-completeness, intake-backfill-sweep) each fail on a genuinely
// missing module, which is what satisfies the `failed >= 1` acceptance-specs
// RED gate for this batch.
//
// Seams faked vs real:
//   - REAL, no fakes: this file drives the ACTUAL `poll()` from
//     `github-issues.ts` (not a reimplementation) against a minimal in-memory
//     registry + ledger + `gh` fake (the injected system-boundary seam that
//     `poll()` itself already requires — see its `GithubIssuesDeps` contract),
//     reads the ACTUAL `dependency-claim.ts` source + git history, and reads
//     the ACTUAL `.github/workflows/ci.yml` plus every gate module under
//     `src/engine/*gate*.ts` / `src/engine/owner-gate/`.
//   - FAKED: only the `gh` runner and the intake `registry`/`ledger`
//     (poll()'s own injected boundaries) — no internal infrastructure beyond
//     what poll() already requires an injected fake for.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGithubIssuesAdapter } from '../../src/engine/engineer/intake/github-issues.js';

const execFileP = promisify(execFileCb);

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/conductor/test/acceptance -> repo root is 4 levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const CLAIM_PATH_REL = 'src/conductor/src/engine/engineer/intake/dependency-claim.ts';
const CI_YML_REL = '.github/workflows/ci.yml';

describe('Story 6 — the pipeline does NOT gate on priority/size/linking (intake-only enforcement)', () => {
  describe('poll() enqueues a criteria-incomplete issue with no blocking flag', () => {
    it('an issue with zero labels (no size, no priority, no links) is enqueued exactly as any other issue', async () => {
      const ledgerStore = new Map<string, { status: string }>();
      const fakeLedger = {
        async known(source: string, ref: string) {
          return ledgerStore.has(`${source}\0${ref}`);
        },
        async record({ source, sourceRef }: { source: string; sourceRef: string }) {
          ledgerStore.set(`${source}\0${sourceRef}`, { status: 'pending' });
        },
        async get(source: string, ref: string) {
          const v = ledgerStore.get(`${source}\0${ref}`);
          return v ? { ...v, attempts: 0 } : undefined;
        },
        async transition() {},
        async reopen() {},
      };

      const gh = async (args: string[]) => {
        if (args[0] === 'issue' && args[1] === 'list') {
          return {
            stdout: JSON.stringify([
              {
                number: 700,
                title: 'Criteria-incomplete issue',
                body: 'No size, no priority, no links — must still enqueue.',
                labels: [], // <-- deliberately zero labels: no size:, no priority:
              },
            ]),
          };
        }
        return { stdout: '{}' };
      };

      const registry = {
        async list() {
          return [{ name: 'app', path: '.', ghRepo: 'acme/app' }];
        },
      };

      const adapter = createGithubIssuesAdapter({
        gh: gh as any,
        registry,
        ledger: fakeLedger as any,
        now: () => '2026-07-20T00:00:00.000Z',
        newId: () => 'fixed-id',
      });

      const envelopes = await adapter.poll();

      expect(envelopes).toHaveLength(1);
      const envelope = envelopes[0] as any;
      expect(envelope.sourceRef).toBe('acme/app#700');
      expect(envelope.status).toBe('pending');
      // No blocking-triage field of any kind — poll() must not withhold or flag
      // enqueue for missing criteria.
      expect(envelope).not.toHaveProperty('needsCriteria');
      expect(envelope).not.toHaveProperty('blockedOnCriteria');
      expect(envelope).not.toHaveProperty('criteriaComplete');
    });
  });

  describe('dependency-claim.ts stays byte-identical to main; ClaimOutcome union gains no member', () => {
    it('git diff against main for dependency-claim.ts is empty', async () => {
      let diffOutput: string;
      try {
        const { stdout } = await execFileP('git', ['diff', 'origin/main', '--', CLAIM_PATH_REL], {
          cwd: REPO_ROOT,
        });
        diffOutput = stdout;
      } catch {
        // origin/main may be unavailable in some environments — fall back to local main.
        const { stdout } = await execFileP('git', ['diff', 'main', '--', CLAIM_PATH_REL], {
          cwd: REPO_ROOT,
        });
        diffOutput = stdout;
      }
      expect(diffOutput.trim(), 'dependency-claim.ts must be byte-identical to main').toBe('');
    });

    it('the ClaimOutcome union has exactly claim | empty | all-blocked — no needs-criteria variant', async () => {
      const source = await readFile(join(REPO_ROOT, CLAIM_PATH_REL), 'utf-8');
      const unionMatch = source.match(/export type ClaimOutcome =([\s\S]*?);\n\n/);
      expect(unionMatch, 'ClaimOutcome union declaration must be present').toBeTruthy();
      const unionBody = unionMatch![1];
      expect(unionBody).toContain(`kind: 'claim'`);
      expect(unionBody).toContain(`kind: 'empty'`);
      expect(unionBody).toContain(`kind: 'all-blocked'`);
      expect(unionBody).not.toContain('needs-criteria');
      expect(unionBody).not.toMatch(/kind:\s*'criteria/);
    });
  });

  describe('no daemon/pipeline gate or CI config references size:/priority:/linking as pass/fail', () => {
    it('.github/workflows/ci.yml never references size:/priority: labels or blocked_by linking as a check', async () => {
      const ciYml = await readFile(join(REPO_ROOT, CI_YML_REL), 'utf-8');
      expect(ciYml).not.toMatch(/size:\s*[SML]/);
      expect(ciYml).not.toMatch(/priority:\s*(critical|high|medium|low)/);
      expect(ciYml).not.toMatch(/blocked_by/);
    });

    it('no gate module under src/engine/*gate* (or owner-gate/) references size:/priority: labels as a pass/fail condition', async () => {
      const engineDir = join(REPO_ROOT, 'src/conductor/src/engine');
      const gateFiles: string[] = [];

      async function collectGateFiles(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (/gate/i.test(entry.name)) await collectGateFiles(full);
            continue;
          }
          if (entry.isFile() && /gate/i.test(entry.name) && entry.name.endsWith('.ts')) {
            gateFiles.push(full);
          }
        }
      }
      await collectGateFiles(engineDir);

      expect(gateFiles.length, 'expected at least one gate module to exist for this check to be meaningful').toBeGreaterThan(0);

      for (const file of gateFiles) {
        const content = await readFile(file, 'utf-8');
        expect(content, `${file} must not gate on a size: label`).not.toMatch(/['"`]size:\s*[SML]['"`]/);
        expect(content, `${file} must not gate on a priority: label`).not.toMatch(
          /['"`]priority:\s*(critical|high|medium|low)['"`]/,
        );
      }
    });

    it('intake-label-sync.yml errors never fail a build/dispatch/CI run (the Action, if present, carries no dependency into ci.yml)', async () => {
      const ciYml = await readFile(join(REPO_ROOT, CI_YML_REL), 'utf-8');
      // The label-sync Action (Task 3) must be isolated: ci.yml must never
      // `needs:` or otherwise depend on an intake-label-sync job.
      expect(ciYml).not.toMatch(/intake-label-sync/);
    });
  });
});
