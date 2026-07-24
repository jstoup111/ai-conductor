import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeSelfHostHalt } from '../../../src/engine/self-host/gate-halt.js';
import { HALT_CLASS_MARKER } from '../../../src/engine/halt-marker.js';

// Self-host gate HALTs (release-gate, version-gate, integrity) are always
// operator-only — the daemon re-kick sweep must never mechanically retry
// them. writeSelfHostHalt must classify its HALT as `needs-human`.

describe('writeSelfHostHalt classification', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'gate-halt-test-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('persists a needs-human HALT.class sidecar', async () => {
    await writeSelfHostHalt(projectRoot, 'release-gate failed: missing artifact');
    const cls = await readFile(join(projectRoot, HALT_CLASS_MARKER), 'utf-8');
    expect(cls.trim()).toBe('needs-human');
  });
});
