// Covers: task:40
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { AuditTrailWriter } from '../../src/engine/audit-trail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function withoutTimestamp(record: Record<string, unknown>): Record<string, unknown> {
  const { ts: _ts, ...event } = record;
  return event;
}

describe('custom build-review policy event spine', () => {
  it('persists, renders, and audits bounded current and reused policy provenance without policy bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-policy-events-'));
    roots.push(root);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    new AuditTrailWriter(root).subscribe(events);
    const lines: string[] = [];
    for (const type of ['build_review_policy_resolved', 'build_review_policy_failed', 'build_review_cache_hit', 'build_review_rubric_result', 'build_review_outer_verdict'] as const) {
      events.on(type, (event) => renderDaemonEvent(event, (line) => lines.push(line)));
    }
    const candidate = { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' } as const;
    const resolved = {
      type: 'build_review_policy_resolved', rubric: 'portablePolicy', lapId: 'lap-current',
      provider: 'codex', source: 'plugin', pluginId: 'acme:portable', bundleDigest: 'sha256:bundle',
      provenance: { inputDigest: 'sha256:input', candidate, plugin: { id: 'acme:portable', version: '2.4.0' } },
    } satisfies ConductorEvent;
    const failed = {
      type: 'build_review_policy_failed', rubric: 'portablePolicy', lapId: 'lap-current',
      provider: 'codex', stage: 'capture', reason: 'selected resource is unreadable',
      provenance: { inputDigest: 'sha256:input', candidate },
    } satisfies ConductorEvent;
    const reused = {
      type: 'build_review_cache_hit', rubric: 'portablePolicy', lapId: 'lap-current',
      customReuse: {
        source: 'plugin', plugin: { id: 'acme:portable', version: '2.4.0' },
        bundleDigest: 'sha256:bundle', inputDigest: 'sha256:input', candidate,
        originalLapId: 'lap-original', originalSnapshotDigest: 'sha256:original-input',
      },
    } satisfies ConductorEvent;
    const customResult = {
      type: 'build_review_rubric_result', rubric: 'portablePolicy', lapId: 'lap-current', verdict: 'PASS',
    } satisfies ConductorEvent;
    const outerVerdict = {
      type: 'build_review_outer_verdict', lapId: 'lap-current', rawVerdict: 'PASS', effectiveVerdict: 'PASS',
    } satisfies ConductorEvent;

    persister.start();
    await events.emit(resolved);
    await events.emit(failed);
    await events.emit(reused);
    await events.emit(customResult);
    await events.emit(outerVerdict);
    persister.stop();

    const ledger = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => withoutTimestamp(JSON.parse(line)));
    const audit = (await readFile(join(root, '.pipeline', 'audit-trail', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));

    expect(ledger).toEqual([resolved, failed, reused, customResult, outerVerdict]);
    expect(lines.join('\n')).toContain('codex/gpt-5.6-sol/medium plugin/acme:portable');
    expect(lines.join('\n')).toContain('custom reuse from lap-original');
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'build_review_policy_resolved', cause: 'sha256:bundle; input sha256:input; candidate codex/gpt-5.6-sol/medium' }),
      expect.objectContaining({ event: 'build_review_policy_failed', cause: 'sha256:input; candidate codex/gpt-5.6-sol/medium' }),
      expect.objectContaining({ event: 'build_review_cache_hit', cause: 'sha256:bundle; input sha256:input; candidate codex/gpt-5.6-sol/medium' }),
    ]));
    expect(JSON.stringify({ ledger, audit, lines })).not.toContain('full policy body');
  });
});
