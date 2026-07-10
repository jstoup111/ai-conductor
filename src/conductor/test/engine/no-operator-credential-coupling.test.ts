import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Task 16: static verification gates for retired credential-copy machinery.
 *
 * These gates are deterministic (plain grep), not LLM-judged: they enforce
 * two architectural invariants at the point of violation rather than trusting
 * agent reports.
 *
 * 1. `refreshSandboxCredentials` (the retired credential-copy function, Task 10)
 *    must have zero references anywhere in src/conductor/src.
 * 2. `CREDENTIALS_FILE` (the retired credential-copy constant, Task 10) must
 *    have zero references anywhere in src/conductor/src.
 * 3. The daemon-token build-auth dispatch/park path (conductor.ts's
 *    `buildAuthMode === 'daemon-token'` branches) must never pass the operator
 *    OAuth credentials path (`.credentials.json` / CLAUDE_CONFIG_DIR-derived
 *    `operatorConfigDir`) into the daemon build-token machinery. Enforced by
 *    isolating the daemon-token branch text and grepping it for operator
 *    credential identifiers.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONDUCTOR_ROOT = join(__dirname, '..', '..');
const SRC_DIR = join(CONDUCTOR_ROOT, 'src');

/** Runs grep -rn over src/conductor/src; returns matching lines (empty array if none). */
function grepSrc(pattern: string): string[] {
  try {
    const out = execFileSync('grep', ['-rn', pattern, SRC_DIR], {
      encoding: 'utf-8',
    });
    return out.split('\n').filter((l) => l.length > 0);
  } catch (err: unknown) {
    // grep exits 1 when no matches are found — that's the success case here.
    const e = err as { status?: number };
    if (e.status === 1) return [];
    throw err;
  }
}

describe('no-operator-credential-coupling (Task 16 static gates)', () => {
  it('refreshSandboxCredentials has zero references in src/conductor/src', () => {
    const matches = grepSrc('refreshSandboxCredentials');
    expect(matches).toEqual([]);
  });

  it('CREDENTIALS_FILE has zero references in src/conductor/src', () => {
    const matches = grepSrc('CREDENTIALS_FILE');
    expect(matches).toEqual([]);
  });

  it('the daemon-token build-auth dispatch/park branch never touches the operator credentials path', () => {
    const conductorPath = join(SRC_DIR, 'engine', 'conductor.ts');
    const contents = readFileSync(conductorPath, 'utf-8');
    const lines = contents.split('\n');

    // Isolate each `... buildAuthMode === 'daemon-token'` branch body: from the
    // guard line up to (but not including) the next top-level `} else` at the
    // same or lesser indentation, or a blank-line-delimited block end. We use a
    // simpler, robust heuristic: capture from the guard line through the next
    // line that starts a sibling `else`/`else if` branch at matching indent, or
    // through N lines if no sibling is found — then assert operator-credential
    // identifiers never appear inside that slice.
    const guardIndices = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /buildAuthMode\s*===\s*'daemon-token'/.test(line))
      .map(({ i }) => i);

    expect(guardIndices.length).toBeGreaterThan(0);

    const operatorCredentialIdentifiers = [
      '.credentials.json',
      'operatorConfigDir',
      'readOperatorCredentialsState',
      'CLAUDE_CONFIG_DIR',
    ];

    for (const guardIdx of guardIndices) {
      // Isolate exactly the `if (...) { ... }` block guarded by this condition
      // via brace counting, so the slice never bleeds into unrelated sibling
      // code (e.g. an unrelated preflight check that follows a guard with no
      // `else`).
      let depth = 0;
      let openedAt = -1;
      let endIdx = lines.length - 1;
      outer: for (let j = guardIdx; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') {
            depth++;
            if (openedAt === -1) openedAt = j;
          } else if (ch === '}') {
            depth--;
            if (openedAt !== -1 && depth === 0) {
              endIdx = j;
              break outer;
            }
          }
        }
      }

      const branchSlice = lines.slice(guardIdx, endIdx + 1).join('\n');

      for (const identifier of operatorCredentialIdentifiers) {
        expect(
          branchSlice.includes(identifier),
          `daemon-token branch (conductor.ts:${guardIdx + 1}-${endIdx}) must not reference "${identifier}" (operator credentials path leaking into build-auth dispatch)`,
        ).toBe(false);
      }
    }
  });
});
