// Covers: task:6
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ProjectHalt, RegisteredHaltInventoryResult } from '../../../src/engine/monitor/halt-inventory.js';

type QueueMembershipDeps = {
  enumerateRegisteredProjectHalts: (
    selection: { projectName?: string },
  ) => Promise<RegisteredHaltInventoryResult>;
};

type QueueMembershipOptions = {
  projectName?: string;
  openItem?: { project: string; feature: string };
};

async function deriveQueueMembership(
  options: QueueMembershipOptions = {},
  deps: QueueMembershipDeps,
): Promise<RegisteredHaltInventoryResult> {
  const queue = await import('../../../src/engine/monitor/queue.js') as {
    deriveQueueMembership(
      options: QueueMembershipOptions,
      deps: QueueMembershipDeps,
    ): Promise<RegisteredHaltInventoryResult>;
  };
  return queue.deriveQueueMembership(options, deps);
}

function halt(project: string, slug: string): ProjectHalt {
  return {
    project,
    projectName: project.split('/').at(-1),
    slug,
    reason: `${slug} needs attention`,
    haltClass: 'needs-human',
  };
}

describe('Task 6 — derived monitor queue membership', () => {
  it('re-derives a newly halted feature on a later pass without restarting', async () => {
    let halts: ProjectHalt[] = [];
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({ code: 0, halts }));

    const first = await deriveQueueMembership({}, { enumerateRegisteredProjectHalts });
    halts = [halt('/projects/alpha', 'newly-halted')];
    const second = await deriveQueueMembership({}, { enumerateRegisteredProjectHalts });

    expect([first.halts, second.halts]).toEqual([[], [halt('/projects/alpha', 'newly-halted')]]);
  });

  it('omits a halt resolved between passes instead of rendering a resolved queue state', async () => {
    let halts = [halt('/projects/alpha', 'resolved-halt')];
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({ code: 0, halts }));

    await deriveQueueMembership({}, { enumerateRegisteredProjectHalts });
    halts = [];
    const queue = await deriveQueueMembership({}, { enumerateRegisteredProjectHalts });

    expect(queue.halts).toEqual([]);
  });

  it('deduplicates one feature enumerated twice within a pass by project and feature', async () => {
    const duplicate = halt('/projects/alpha', 'duplicate-halt');
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({
      code: 0,
      halts: [duplicate, { ...duplicate, reason: 'duplicate observation' }],
    }));

    const queue = await deriveQueueMembership({}, { enumerateRegisteredProjectHalts });

    expect(queue.halts).toEqual([duplicate]);
  });

  it('suppresses the item with an open guided session on a later pass', async () => {
    const open = halt('/projects/alpha', 'open-halt');
    const other = halt('/projects/alpha', 'other-halt');
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({ code: 0, halts: [open, other] }));

    const queue = await deriveQueueMembership({
      openItem: { project: open.project, feature: open.slug },
    }, { enumerateRegisteredProjectHalts });

    expect(queue.halts).toEqual([other]);
  });

  it('forwards a named-project selection to the inventory boundary', async () => {
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({ code: 0, halts: [] }));

    await deriveQueueMembership({ projectName: 'beta' }, { enumerateRegisteredProjectHalts });

    expect(enumerateRegisteredProjectHalts).toHaveBeenCalledWith({ projectName: 'beta' });
  });

  it('preserves the inventory error result while keeping halts from readable projects', async () => {
    const readable = halt('/projects/readable', 'still-halted');
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({ code: 1, halts: [readable] }));

    const queue = await deriveQueueMembership({}, { enumerateRegisteredProjectHalts });

    expect(queue).toEqual({ code: 1, halts: [readable] });
  });

  it('forwards a terminal inventory result so the composition root can end the monitor', async () => {
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({ code: 1, halts: [], terminal: true }));

    const queue = await deriveQueueMembership({}, { enumerateRegisteredProjectHalts });

    expect(queue).toEqual({ code: 1, halts: [], terminal: true });
  });

  it('creates independent membership for each monitor without a persisted queue artifact', async () => {
    const current = halt('/projects/alpha', 'shared-halt');
    const enumerateRegisteredProjectHalts = vi.fn(async () => ({ code: 0, halts: [current] }));
    const source = readFileSync(resolve(import.meta.dirname, '../../../src/engine/monitor/queue.ts'), 'utf-8');

    const monitors = await Promise.all([
      deriveQueueMembership({}, { enumerateRegisteredProjectHalts }),
      deriveQueueMembership({}, { enumerateRegisteredProjectHalts }),
    ]);

    expect({
      monitors,
      inventoryCalls: enumerateRegisteredProjectHalts.mock.calls.length,
      hasFilesystemImport: /node:fs|from ['"]fs['"]/.test(source),
    }).toEqual({
      monitors: [{ code: 0, halts: [current] }, { code: 0, halts: [current] }],
      inventoryCalls: 2,
      hasFilesystemImport: false,
    });
  });
});
