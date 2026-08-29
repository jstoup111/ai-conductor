import { describe, expect, it } from 'vitest';

import {
  resolveCanonicalLauncher,
  shellQuote,
} from '../../src/engine/canonical-launcher.js';
import { DAEMON_FOREGROUND_COMMAND } from '../../src/engine/daemon-tmux.js';
import { BRAIN_FOREGROUND_COMMAND } from '../../src/engine/brain-supervisor-cli.js';

describe('resolveCanonicalLauncher', () => {
  it('honors AI_CONDUCTOR_ENGINE_BIN before inspecting the running layout', () => {
    expect(
      resolveCanonicalLauncher({
        env: { AI_CONDUCTOR_ENGINE_BIN: '/custom/engine launcher' },
        moduleDir: '/unresolvable/layout',
        isExecutable: () => false,
      }),
    ).toBe('/custom/engine launcher');
  });

  it('uses the executable bin/ai-conductor beside a source-tree engine bundle', () => {
    expect(
      resolveCanonicalLauncher({
        env: {},
        moduleDir: '/harness/src/conductor/src/engine',
        isExecutable: (path) => path === '/harness/bin/ai-conductor',
      }),
    ).toBe('/harness/bin/ai-conductor');
  });

  it('uses the executable bin/ai-conductor beside a published bundle', () => {
    expect(
      resolveCanonicalLauncher({
        env: {},
        moduleDir: '/harness/src/conductor/dist',
        isExecutable: (path) => path === '/harness/bin/ai-conductor',
      }),
    ).toBe('/harness/bin/ai-conductor');
  });

  it('falls back to the PATH command when no recognizable layout has an executable launcher', () => {
    expect(
      resolveCanonicalLauncher({
        env: {},
        moduleDir: '/unresolvable/layout',
        isExecutable: () => false,
      }),
    ).toBe('ai-conductor');
  });

  it('quotes launcher paths safely when they are emitted into shell commands', () => {
    expect(shellQuote("/harness with space/bin/ai-conductor's")).toBe(
      "'/harness with space/bin/ai-conductor'\\''s'",
    );
  });
});

describe('foreground commands', () => {
  it('launch the current bundle through its canonical repo-relative launcher', () => {
    for (const command of [DAEMON_FOREGROUND_COMMAND, BRAIN_FOREGROUND_COMMAND]) {
      expect(command).toContain('bin/ai-conductor');
      expect(command).not.toMatch(/^ai-conductor\b/);
    }
  });
});
