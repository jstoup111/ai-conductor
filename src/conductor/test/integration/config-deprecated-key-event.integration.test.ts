import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  emitDeprecatedConfigKeyEvents,
  validateConfig,
} from '../../src/engine/config.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('config deprecated-key event spine', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('emits each accepted retired key once and persists each occurrence', async () => {
    const result = validateConfig({
      build_review: {
        rubrics: {
          scope: { enabled: true },
          wiring: { enabled: false },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const root = await mkdtemp(join(tmpdir(), 'config-deprecated-key-event-'));
    dirs.push(root);
    const events = new ConductorEventEmitter();
    const seen: string[] = [];
    events.on('config_deprecated_key', (event) => {
      if (event.type === 'config_deprecated_key') seen.push(event.key);
    });
    const persister = new EventPersister(join(root, 'events.jsonl'), events);
    persister.start();

    await emitDeprecatedConfigKeyEvents(result, events);

    expect(seen).toEqual([
      'build_review.rubrics.scope',
      'build_review.rubrics.wiring',
    ]);
    const persisted = (await readFile(join(root, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(persisted.map((event) => event.key)).toEqual(seen);
    expect(persisted.map((event) => event.adr)).toEqual([
      'adr-2026-08-22-build-review-opt-in-rubric-container',
      'adr-2026-08-22-build-review-opt-in-rubric-container',
    ]);
    persister.stop();
  });
});
