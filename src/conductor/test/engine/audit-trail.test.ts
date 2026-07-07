import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditTrailWriter, type AuditRecord } from '../../src/engine/audit-trail.js';

describe('engine/audit-trail', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'audit-trail-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends a whole-line JSON record with derived phase and timestamp', async () => {
    const writer = new AuditTrailWriter(dir);

    writer.record({ step: 'build', event: 'retry', reason: 'tests failed', attempt: 2 });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]) as AuditRecord;

    expect(record.step).toBe('build');
    expect(record.event).toBe('retry');
    expect(record.reason).toBe('tests failed');
    expect(record.attempt).toBe(2);
    expect(record.phase).toBe('BUILD');
    expect(typeof record.at).toBe('number');
  });

  it('bootstraps the audit-trail dir idempotently without touching existing batch artifacts', async () => {
    const auditTrailDir = join(dir, '.pipeline', 'audit-trail');
    const batchDir = join(auditTrailDir, 'batch-1');
    await mkdir(batchDir, { recursive: true });

    const satisfiedPath = join(auditTrailDir, 'code-review-satisfied.md');
    const reviewPath = join(batchDir, 'review.json');
    const satisfiedContent = '# Code review satisfied\n\nAll checks passed.\n';
    const reviewContent = JSON.stringify({ status: 'approved', batch: 1 });

    await writeFile(satisfiedPath, satisfiedContent, 'utf8');
    await writeFile(reviewPath, reviewContent, 'utf8');

    const writer = new AuditTrailWriter(dir);
    writer.record({ step: 'build', event: 'retry', reason: 'tests failed', attempt: 1 });

    const eventsPath = join(auditTrailDir, 'events.jsonl');
    const eventsContents = await readFile(eventsPath, 'utf8');
    const lines = eventsContents.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);

    const satisfiedAfter = await readFile(satisfiedPath, 'utf8');
    const reviewAfter = await readFile(reviewPath, 'utf8');

    expect(satisfiedAfter).toBe(satisfiedContent);
    expect(reviewAfter).toBe(reviewContent);
  });
});
