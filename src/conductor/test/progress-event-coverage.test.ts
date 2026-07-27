import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ConductorEvent } from '../src/types/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..', 'src');

const PROGRESS_KINDS = [
  'build_progress',
  'build_no_progress',
  'build_stall',
  'unattributed_progress',
] as const;

// This must remain a direct union assignment: adding a new emitted event type
// without extending ConductorEvent should fail typecheck at this seam.
const UNATTRIBUTED_PROGRESS_EVENT: ConductorEvent = {
  type: 'unattributed_progress',
  step: 'build',
  attempt: 1,
  resolvedCount: 0,
  headBefore: 'before-sha',
  headAfter: 'after-sha',
};

/**
 * Guard against subscriber-list drift: every progress/stall event kind must
 * be present in each of the five places that dispatch on ConductorEvent
 * kinds. Missing a kind from any one of these silently drops the event for
 * that consumer (persistence, UI plugin subscription, daemon rendering, TTY
 * rendering, or OTel export) without any type error, because these are all
 * plain string-literal arrays / switch statements, not exhaustive unions.
 */
describe('progress event coverage guard', () => {
  it('accepts the exact unattributed_progress payload in the ConductorEvent union', () => {
    expect(UNATTRIBUTED_PROGRESS_EVENT).toEqual({
      type: 'unattributed_progress',
      step: 'build',
      attempt: 1,
      resolvedCount: 0,
      headBefore: 'before-sha',
      headAfter: 'after-sha',
    });
  });

  const lists: Array<{ name: string; file: string }> = [
    { name: 'EventPersister.ALL_EVENT_TYPES', file: join(SRC_ROOT, 'engine', 'event-persister.ts') },
    { name: 'ui/subscriber.ts eventTypes', file: join(SRC_ROOT, 'ui', 'subscriber.ts') },
    { name: 'daemon-cli.ts renderer switch', file: join(SRC_ROOT, 'daemon-cli.ts') },
    { name: 'ui/create-renderer.ts TTY renderer switch', file: join(SRC_ROOT, 'ui', 'create-renderer.ts') },
    { name: 'engine/otel/otel-visualizer.ts subscription list', file: join(SRC_ROOT, 'engine', 'otel', 'otel-visualizer.ts') },
  ];

  for (const { name, file } of lists) {
    it(`${name} explicitly handles every progress event, including unattributed_progress`, () => {
      const contents = readFileSync(file, 'utf-8');
      const missing = PROGRESS_KINDS.filter((kind) => !contents.includes(`'${kind}'`));

      expect(
        missing,
        `${name} (${file}) is missing kind(s): ${missing.join(', ')}. ` +
          `Every progress/stall event kind must appear in this list or switch, ` +
          `or that consumer silently drops the event.`,
      ).toEqual([]);
    });
  }
});
