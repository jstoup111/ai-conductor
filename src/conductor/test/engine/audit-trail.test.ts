import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditTrailWriter, type AuditRecord } from '../../src/engine/audit-trail.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeVerdict, readVerdict, type GateVerdict } from '../../src/engine/gate-verdicts.js';

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

  it('roots paths at the injected projectRoot, never process.cwd()', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'audit-trail-root-a-'));
    const rootB = await mkdtemp(join(tmpdir(), 'audit-trail-root-b-'));
    const originalCwd = process.cwd();

    try {
      const writer = new AuditTrailWriter(rootA);
      process.chdir(rootB);

      writer.record({ step: 'build', event: 'retry', reason: 'tests failed', attempt: 1 });

      const pathA = join(rootA, '.pipeline', 'audit-trail', 'events.jsonl');
      const pathB = join(rootB, '.pipeline', 'audit-trail', 'events.jsonl');

      const contentsA = await readFile(pathA, 'utf8');
      expect(contentsA.length).toBeGreaterThan(0);

      await expect(readFile(pathB, 'utf8')).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });

  it('does not throw and writes stderr + a WRITE-FAILED marker when the append fails', async () => {
    const auditDir = join(dir, '.pipeline', 'audit-trail');
    await mkdir(auditDir, { recursive: true });
    const eventsPath = join(auditDir, 'events.jsonl');
    // Create events.jsonl as a directory so appendFileSync fails (EISDIR) instead of writing.
    await mkdir(eventsPath);

    const writer = new AuditTrailWriter(dir);
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      expect(() =>
        writer.record({ step: 'build', event: 'retry', reason: 'tests failed', attempt: 2 })
      ).not.toThrow();
    } finally {
      process.stderr.write = originalWrite;
    }

    const stderrOutput = stderrWrites.join('');
    expect(stderrOutput).toContain('build');
    expect(stderrOutput).toContain('retry');
    expect(stderrOutput.toLowerCase()).toContain('error');

    const marker = await readFile(join(auditDir, 'WRITE-FAILED'), 'utf8').catch(() => null);
    expect(marker).not.toBeNull();
  });

  it('preserves every record with no corruption when two writers append concurrently without coordination', async () => {
    const writer1 = new AuditTrailWriter(dir);
    const writer2 = new AuditTrailWriter(dir);

    const appendMany = async (writer: AuditTrailWriter, count: number, tag: string) => {
      for (let i = 0; i < count; i++) {
        // Yield to the microtask queue between writes so the two loops'
        // synchronous appendFileSync calls actually interleave in time,
        // rather than one loop running to completion before the other starts.
        await Promise.resolve();
        writer.record({ step: 'build', event: `${tag}-${i}`, attempt: i });
      }
    };

    await Promise.all([appendMany(writer1, 100, 'writer1'), appendMany(writer2, 100, 'writer2')]);

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(200);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('subscribe() appends a record for allowlisted event types', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({ type: 'gate_verdict', step: 'build', satisfied: true, reason: 'ok' });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.step).toBe('build');
    expect(record.event).toBe('gate_pass');
  });

  it('gate_verdict with satisfied:false maps to gate_fail with non-divergent reason and at >= checkedAt', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    const checkedAt = Date.now() - 1000;
    const reason = 'stories missing Status: Accepted';

    await emitter.emit({
      type: 'gate_verdict',
      step: 'conflict_check',
      satisfied: false,
      reason,
      checkedAt,
    });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.event).toBe('gate_fail');
    expect(record.reason).toBe(reason);
    expect(record.at).toBeGreaterThanOrEqual(checkedAt);
  });

  it('gate_verdict with satisfied:true maps to gate_pass with non-divergent reason', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    const checkedAt = Date.now() - 500;
    const reason = 'all stories accepted';

    await emitter.emit({
      type: 'gate_verdict',
      step: 'build',
      satisfied: true,
      reason,
      checkedAt,
    });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.event).toBe('gate_pass');
    expect(record.reason).toBe(reason);
    expect(record.at).toBeGreaterThanOrEqual(checkedAt);
  });

  it('subscribe() maps kickback to a record at the target step with cause documenting source + evidence', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({
      type: 'kickback',
      from: 'conflict_check',
      to: 'architecture_review',
      evidence: 'missing seam',
      count: 1,
    });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.step).toBe('architecture_review');
    expect(record.event).toBe('kickback');
    expect(record.cause).toBe('conflict_check evidence: missing seam');
  });

  it('subscribe() maps step_retry to a retry record with attempt and reason', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({
      type: 'step_retry',
      step: 'build',
      attempt: 2,
      maxAttempts: 3,
      reason: 'tests failed',
    });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.step).toBe('build');
    expect(record.event).toBe('retry');
    expect(record.attempt).toBe(2);
    expect(record.reason).toBe('tests failed');
  });

  it('subscribe() falls back to a default reason and still appends when step_retry reason is empty', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({
      type: 'step_retry',
      step: 'build',
      attempt: 1,
      maxAttempts: 3,
      reason: '',
    });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.step).toBe('build');
    expect(record.event).toBe('retry');
    expect(record.attempt).toBe(1);
    expect(record.reason).toBeTruthy();
    expect(record.reason).not.toBe('');
  });

  it('subscribe() maps loop_halt to an intervention record with cause', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({ type: 'loop_halt', reason: 'stuck cap exceeded' });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.event).toBe('intervention');
    expect(record.cause).toBe('stuck cap exceeded');
  });

  it('subscribe() keeps both records in order when a kickback is immediately followed by loop_halt (cap exceeded)', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({
      type: 'kickback',
      from: 'plan',
      to: 'stories',
      evidence: 'contradiction found',
      count: 3,
    });
    await emitter.emit({ type: 'loop_halt', reason: 'kickback cap exceeded' });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as AuditRecord;
    const second = JSON.parse(lines[1]) as AuditRecord;

    expect(first.event).toBe('kickback');
    expect(first.step).toBe('stories');
    expect(second.event).toBe('intervention');
    expect(second.cause).toBe('kickback cap exceeded');
  });

  it('preserves both gate_fail and gate_pass history when a gate fails then later passes, agreeing with the latest-state GateVerdict file', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    const step = 'conflict_check';
    const failReason = 'contradiction found between stories 3 and 6';
    const passReason = 'no contradictions remain';

    await emitter.emit({
      type: 'gate_verdict',
      step,
      satisfied: false,
      reason: failReason,
      checkedAt: Date.now() - 2000,
    });

    const passCheckedAt = Date.now();
    await emitter.emit({
      type: 'gate_verdict',
      step,
      satisfied: true,
      reason: passReason,
      checkedAt: passCheckedAt,
    });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    // Both records must be present, in order — no dedup or replacement.
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as AuditRecord;
    const second = JSON.parse(lines[1]) as AuditRecord;

    expect(first.step).toBe(step);
    expect(first.event).toBe('gate_fail');
    expect(first.reason).toBe(failReason);

    expect(second.step).toBe(step);
    expect(second.event).toBe('gate_pass');
    expect(second.reason).toBe(passReason);

    // The final on-disk gate verdict (latest state) must agree with the
    // last-appended audit record, even though the audit trail also retains
    // the earlier gate_fail history.
    const verdict: GateVerdict = {
      satisfied: true,
      reason: passReason,
      checkedAt: passCheckedAt,
    };
    await writeVerdict(dir, step, verdict);

    const persisted = await readVerdict(dir, step);
    expect(persisted).not.toBeNull();
    expect(persisted?.satisfied).toBe(true);
    expect(persisted?.reason).toBe(second.reason);
    expect(persisted?.checkedAt).toBe(passCheckedAt);
    expect(second.at).toBeGreaterThanOrEqual(passCheckedAt);
  });

  it('step_completed with no prior gate_verdict emits one gate_pass positive-evidence record', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({ type: 'step_completed', step: 'manual_test', status: 'done' });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.step).toBe('manual_test');
    expect(record.event).toBe('gate_pass');
  });

  it('step_completed for a step that already has a gate_verdict does not duplicate the pass record', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await emitter.emit({ type: 'gate_verdict', step: 'build', satisfied: true, reason: 'ok' });
    await emitter.emit({ type: 'step_completed', step: 'build', status: 'done' });

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const lines = contents.split('\n').filter((line) => line.length > 0);

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as AuditRecord;
    expect(record.step).toBe('build');
    expect(record.event).toBe('gate_pass');
  });

  it('subscribe() ignores unmapped event types without error or append', async () => {
    const writer = new AuditTrailWriter(dir);
    const emitter = new ConductorEventEmitter();
    writer.subscribe(emitter);

    await expect(
      emitter.emit({ type: 'step_started', step: 'build', index: 0 })
    ).resolves.not.toThrow();

    const eventsPath = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    const contents = await readFile(eventsPath, 'utf8').catch(() => '');
    const lines = contents.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(0);
  });
});
