// Covers: task:3
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  emitDeprecatedConfigKeyEvents,
  loadMergedConfig,
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

  it('deduplicates merged wiring deprecation events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'config-deprecated-wiring-'));
    const home = await mkdtemp(join(tmpdir(), 'config-deprecated-wiring-home-'));
    dirs.push(root, home);
    await mkdir(join(root, '.ai-conductor'));
    await mkdir(join(home, '.ai-conductor'));
    await writeFile(join(root, '.ai-conductor', 'config.yml'), 'wiring: 5\n', 'utf8');
    await writeFile(join(home, '.ai-conductor', 'config.yml'), 'wiring:\n  entry_points: [src/cli.ts]\n', 'utf8');

    const originalHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const result = await loadMergedConfig(root);
      expect(result).toMatchObject({
        ok: true,
        deprecatedKeys: [{ key: 'wiring', adr: 'adr-2026-08-14-retire-build-review-wiring-rubric' }],
      });
      if (!result.ok) return;

      const events = new ConductorEventEmitter();
      const seen: string[] = [];
      events.on('config_deprecated_key', (event) => {
        if (event.type === 'config_deprecated_key') seen.push(event.key);
      });
      await emitDeprecatedConfigKeyEvents(result, events);

      expect(seen).toEqual(['wiring']);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  it('does not emit a wiring deprecation event when wiring is absent', async () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = new ConductorEventEmitter();
    const seen: string[] = [];
    events.on('config_deprecated_key', (event) => {
      if (event.type === 'config_deprecated_key') seen.push(event.key);
    });
    await emitDeprecatedConfigKeyEvents(result, events);

    expect(seen).toEqual([]);
  });
});
