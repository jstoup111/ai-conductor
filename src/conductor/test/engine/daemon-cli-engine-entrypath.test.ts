// Regression: the stale-engine checker was silently disabled because the daemon
// hashed `<projectRoot>/dist/index.js` (nonexistent) instead of the real engine
// at `<projectRoot>/src/conductor/dist/index.js`. captureEngineIdentity returned
// null for the wrong path, so createStaleEngineChecker(null) always reported
// 'current' and no daemon ever auto-restarted. This drives the real wired path
// against a real self-host layout — the seam no prior test exercised (the
// identity primitive was only ever tested against a directly-passed fixture).

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { engineEntryPathForRepo } from '../../src/daemon-cli.js';
import { captureEngineIdentity } from '../../src/engine/engine-identity.js';

describe('engineEntryPathForRepo (stale-engine checker wiring)', () => {
  it('resolves <projectRoot>/src/conductor/dist/index.js, not the repo root', () => {
    expect(engineEntryPathForRepo('/repo')).toBe('/repo/src/conductor/dist/index.js');
  });

  it('captureEngineIdentity finds the engine at the wired path in a real self-host layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engine-entrypath-'));
    const distDir = join(root, 'src', 'conductor', 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.js'), 'export const engine = 1;\n', 'utf-8');

    const identity = await captureEngineIdentity(engineEntryPathForRepo(root));
    expect(identity).not.toBeNull();
    expect(identity).toMatch(/^[0-9a-f]{64}$/);

    // The pre-fix path (`<root>/dist/index.js`) never exists → capture fails →
    // the checker would be permanently disabled.
    const preFix = await captureEngineIdentity(join(root, 'dist', 'index.js'));
    expect(preFix).toBeNull();
  });
});
