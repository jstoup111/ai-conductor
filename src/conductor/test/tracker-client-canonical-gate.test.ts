import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

// Task 14: checked-in grep gate — the canonical `TrackerClient` seam
// (src/engine/tracker-client.ts) must be the ONLY place gh-runner-shaped
// type declarations and the `makeProductionGh` factory are declared.
// Every other module may only *import*, *re-export*, or *call* these —
// never redeclare them. This test is a regression gate: it is expected
// to be GREEN on a fully-migrated tree (tasks 5-13 already removed the
// duplicates); it exists to catch future backsliding.

const REPO_ROOT = path.resolve(__dirname, '..');
const CANONICAL_MODULE = 'src/engine/tracker-client.ts';
const PR_SIDE_EXEMPT = 'src/handoff.ts'; // CommandRunner lives here by design

const RUNNER_TYPE_NAMES = ['ExecRunner', 'BlockerRunner', 'FileIssueGhRunner', 'GhAbstraction'];

function listSourceFiles(): string[] {
  const out = execSync('git ls-files -- "src/**/*.ts"', { cwd: REPO_ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.endsWith('.ts'));
}

describe('canonical tracker-client seam grep gate', () => {
  it('declares no gh-runner-shaped runner types outside tracker-client.ts', () => {
    const files = listSourceFiles().filter(
      (f) => f !== CANONICAL_MODULE && f !== PR_SIDE_EXEMPT,
    );

    const offenders: string[] = [];

    for (const file of files) {
      const contents = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      for (const name of RUNNER_TYPE_NAMES) {
        // Match a declaration of `name` whose signature is the gh-runner
        // shape `=> Promise<{ stdout ... }>` within a bounded window —
        // i.e. an actual redeclaration, not merely a reference/import.
        const declPattern = new RegExp(
          `\\b(?:export\\s+)?(?:type|interface)\\s+${name}\\b[\\s\\S]{0,300}?=>\\s*Promise<\\{\\s*stdout`,
        );
        if (declPattern.test(contents)) {
          offenders.push(`${file}: declares ${name} with gh-runner shape`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('defines makeProductionGh only in tracker-client.ts', () => {
    const files = listSourceFiles().filter((f) => f !== CANONICAL_MODULE);

    const offenders: string[] = [];
    const defPattern =
      /\b(?:export\s+)?(?:function\s+makeProductionGh\s*\(|const\s+makeProductionGh\s*[:=])/;

    for (const file of files) {
      const contents = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      if (defPattern.test(contents)) {
        offenders.push(`${file}: defines makeProductionGh`);
      }
    }

    expect(offenders).toEqual([]);
  });

  // Guards against a second production gh factory reappearing (e.g. the
  // gh-blocker-runner.ts regression fixed by adr-2026-07-22-canonical-tracker-client-seam):
  // any module outside the canonical seam (or the existing PR-side exemptions)
  // that shells out to `gh` directly via execFile/execa bypasses the
  // AI_CONDUCTOR_NO_REAL_EXEC kill-switch entirely.
  it('invokes execFile/execa with a literal "gh" argv only in tracker-client.ts', () => {
    const EXEC_SIDE_EXEMPT = new Set([
      CANONICAL_MODULE,
      PR_SIDE_EXEMPT,
      'src/engine/worktree.ts',
      'src/engine/engineer/handoff.ts',
    ]);
    const files = listSourceFiles().filter((f) => !EXEC_SIDE_EXEMPT.has(f));

    const offenders: string[] = [];
    // Matches execFile(...'gh'...), execFile('gh', ...), execa('gh', ...), execaCommand('gh ...')
    const ghExecPattern = /\b(?:execFile|execFileSync|execa|execaSync|execaCommand)\s*\(\s*['"]gh['"]/;

    for (const file of files) {
      const contents = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      if (ghExecPattern.test(contents)) {
        offenders.push(`${file}: shells out to 'gh' directly instead of via makeProductionGh()`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
