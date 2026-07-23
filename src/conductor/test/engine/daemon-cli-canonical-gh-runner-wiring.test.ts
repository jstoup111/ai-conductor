// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli.ts must not hand-roll its own anonymous `gh` runner
// closures. Every real `gh` invocation must flow through the canonical
// `makeProductionGh()` factory in `tracker-client.ts`
// (.docs/plans/canonical-tracker-client-seam-with-per-backend-tra.md Task 11).
//
// Source-grep, not a full daemon-cli.ts process spin-up — same technique
// `daemon-cli-build-auth-wiring.test.ts` and siblings use: the composition
// root is too large to exercise end-to-end in a unit test, so we assert on
// its source text that the wiring point exists and the old ad-hoc closures
// are gone.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const daemonCliSrc = readFileSync(
  join(__dirname, '..', '..', 'src', 'daemon-cli.ts'),
  'utf-8',
);

describe('daemon-cli canonical gh runner wiring (Task 11)', () => {
  it('imports makeProductionGh from the canonical tracker-client module', () => {
    expect(daemonCliSrc).toMatch(
      /import\s*\{[^}]*makeProductionGh[^}]*\}\s*from\s*['"]\.\/engine\/tracker-client\.js['"]/,
    );
  });

  it('contains no more anonymous inline gh-shelling runner closures', () => {
    // Each previously-inline runner shelled out via execFile('gh', ...).
    // Once all four call sites are routed through makeProductionGh(), no
    // hand-rolled closure should still construct one directly.
    const inlineGhClosures = daemonCliSrc.match(
      /async \([^)]*\)[^{]*\{\s*(?:const\s+\w+\s*=\s*await\s+)?(?:await\s+)?execFile\(\s*['"]gh['"]/g,
    );
    expect(inlineGhClosures).toBeNull();
  });

  it('constructs the canonical production gh runner at least once', () => {
    expect(daemonCliSrc).toMatch(/makeProductionGh\(\)/);
  });
});
