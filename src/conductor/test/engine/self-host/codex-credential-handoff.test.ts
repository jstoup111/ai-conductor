import { describe, expect, it } from 'vitest';
import { createCredentialHandoff } from '../../../src/engine/self-host/codex-credential-handoff.js';

describe('Codex credential handoff cleanup', () => {
  it('does not broaden cleanup when no credential destination was created', async () => {
    const cleanup = createCredentialHandoff({ homeDir: '/tmp/exact-home' });
    await expect(cleanup.teardown()).resolves.toBeUndefined();
  });
});
