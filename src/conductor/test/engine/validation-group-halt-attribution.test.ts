// Covers: task:2
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const haltMarkerCalls = vi.hoisted((): unknown[][] => []);

vi.mock('../../src/engine/halt-marker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/halt-marker.js')>();
  return {
    ...actual,
    writeHaltMarker: async (...args: Parameters<typeof actual.writeHaltMarker>) => {
      haltMarkerCalls.push(args);
      return actual.writeHaltMarker(...args);
    },
  };
});

import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('validation-group halt attribution', () => {
  const roots: string[] = [];

  afterEach(async () => {
    haltMarkerCalls.length = 0;
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function conductorAtValidationGroupEntry() {
    const root = await mkdtemp(join(tmpdir(), 'validation-group-halt-attribution-'));
    roots.push(root);
    const events = new ConductorEventEmitter();
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline/conduct-state.json'),
      stepRunner: { run: vi.fn().mockResolvedValue({ success: true }) },
      events,
      mode: 'auto',
      daemon: true,
    });
    // This is the fan-out's entry breadcrumb. The member override must win.
    (conductor as any).dispatchingStep = 'manual_test';
    return { conductor, events };
  }

  it.each([
    'terminal PLAN_GAP',
    'terminal DESIGN',
    'terminal invalid verdict',
    'remediation planner halt',
    'kickback no-op escalation',
    'findings projection refusal',
  ])('uses the as-built member for %s', async () => {
    const { conductor, events } = await conductorAtValidationGroupEntry();
    const halts: Array<{ step?: string }> = [];
    events.on('loop_halt', (event) => { halts.push(event); });

    await (conductor as any).writeHaltMarker(
      'as-built validator ended this group\n',
      'needs-human',
      'architecture_review_as_built',
    );
    await (conductor as any).emitLoopHalt(
      'as-built validator ended this group',
      undefined,
      'architecture_review_as_built',
    );

    expect(halts).toEqual([expect.objectContaining({ step: 'architecture_review_as_built' })]);
    expect(haltMarkerCalls).toContainEqual(expect.arrayContaining([
      expect.any(String),
      'as-built validator ended this group\n',
      'needs-human',
      expect.anything(),
      undefined,
      'architecture_review_as_built',
    ]));
  });

  it('keeps a non-group BUILD halt attributed to build', async () => {
    const { conductor, events } = await conductorAtValidationGroupEntry();
    const halts: Array<{ step?: string }> = [];
    events.on('loop_halt', (event) => { halts.push(event); });
    (conductor as any).dispatchingStep = 'build';

    await (conductor as any).writeHaltMarker('BUILD failed\n', 'needs-human');
    await (conductor as any).emitLoopHalt('BUILD failed');

    expect(halts).toEqual([expect.objectContaining({ step: 'build' })]);
    expect(haltMarkerCalls.at(-1)).toEqual(expect.arrayContaining([
      expect.any(String), 'BUILD failed\n', 'needs-human', expect.anything(), undefined, undefined,
    ]));
  });
});
