import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// TR-12 (structural, ADR-005/ADR-010): the daemon never merges. This is a
// by-construction guard on the NEW self-host code — no self-host module may
// reference a merge entry point. The finish gates only ever write a HALT; the
// live-path wiring (which also never merges) lands in a follow-up PR, and its
// own integration test will re-assert this at the conductor.run() seam.

const SELF_HOST_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'engine',
  'self-host',
);

// Patterns that would indicate an autonomous merge — none may appear.
const MERGE_PATTERNS = [/pr\s+merge/i, /mergePull/i, /\bmerge_pull_request\b/i, /gh\b.*\bmerge\b/i];

describe('self-host non-autonomy (TR-12, ADR-005)', () => {
  it('no self-host module references a merge entry point', async () => {
    const files = (await readdir(SELF_HOST_SRC)).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const text = await readFile(join(SELF_HOST_SRC, f), 'utf-8');
      for (const re of MERGE_PATTERNS) {
        if (re.test(text)) offenders.push(`${f} :: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
