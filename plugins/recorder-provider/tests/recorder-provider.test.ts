import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RecorderProvider, RecorderProviderError } from '../index.js';

// Minimal InvokeOptions for testing
function makeOptions(prompt = 'hello') {
  return {
    prompt,
    sessionId: 'test-session',
    resume: false,
  };
}

describe('RecorderProvider', () => {
  let tempDir: string;
  let recordingPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'recorder-provider-test-'));
    recordingPath = join(tempDir, 'recordings.jsonl');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // T3: JSONL logging + canned response
  // -------------------------------------------------------------------------

  it('invoke() appends a JSONL line with kind=invoke', async () => {
    const provider = new RecorderProvider({ recordingPath });
    await provider.invoke(makeOptions('hello world'));

    const content = await readFile(recordingPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]);
    expect(record.kind).toBe('invoke');
    expect(record.options.prompt).toBe('hello world');
    expect(record.ts).toBeTruthy();
  });

  it('invoke() returns canned response { success: true, output: "[RecorderProvider] canned response", exitCode: 0 }', async () => {
    const provider = new RecorderProvider({ recordingPath });
    const result = await provider.invoke(makeOptions());

    expect(result.success).toBe(true);
    expect(result.output).toBe('[RecorderProvider] canned response');
    expect(result.exitCode).toBe(0);
  });

  // -------------------------------------------------------------------------
  // T4: Parent directory creation
  // -------------------------------------------------------------------------

  it('creates parent directories on first write', async () => {
    const nestedPath = join(tempDir, 'deep', 'nested', 'dir', 'recordings.jsonl');
    const provider = new RecorderProvider({ recordingPath: nestedPath });

    await expect(provider.invoke(makeOptions())).resolves.not.toThrow();

    const content = await readFile(nestedPath, 'utf-8');
    expect(content.trim()).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // T5: Write-error throws RecorderProviderError
  // -------------------------------------------------------------------------

  it('throws RecorderProviderError when the recording path is a directory (unwritable)', async () => {
    // Use an unwritable path: a directory as the recording path
    const provider = new RecorderProvider({ recordingPath: tempDir });

    await expect(provider.invoke(makeOptions())).rejects.toThrow(RecorderProviderError);
  });

  it('RecorderProviderError has the correct name', async () => {
    const err = new RecorderProviderError('test error');
    expect(err.name).toBe('RecorderProviderError');
    expect(err.message).toBe('test error');
  });

  // -------------------------------------------------------------------------
  // T6: Lines are valid JSON (parseable)
  // -------------------------------------------------------------------------

  it('each JSONL line is valid JSON with ts, kind, and options fields', async () => {
    const provider = new RecorderProvider({ recordingPath });
    await provider.invoke(makeOptions('first'));
    await provider.invoke(makeOptions('second'));
    await provider.invokeInteractive(makeOptions('third'));

    const content = await readFile(recordingPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const record = JSON.parse(line);
      expect(typeof record.ts).toBe('string');
      expect(typeof record.kind).toBe('string');
      expect(typeof record.options).toBe('object');
    }
  });

  it('ts field is a valid ISO 8601 timestamp', async () => {
    const provider = new RecorderProvider({ recordingPath });
    await provider.invoke(makeOptions());

    const content = await readFile(recordingPath, 'utf-8');
    const record = JSON.parse(content.trim());
    const date = new Date(record.ts);
    expect(date.toISOString()).toBe(record.ts);
  });

  // -------------------------------------------------------------------------
  // T7: invokeInteractive
  // -------------------------------------------------------------------------

  it('invokeInteractive() appends a JSONL line with kind=invokeInteractive', async () => {
    const provider = new RecorderProvider({ recordingPath });
    await provider.invokeInteractive(makeOptions('interactive prompt'));

    const content = await readFile(recordingPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]);
    expect(record.kind).toBe('invokeInteractive');
    expect(record.options.prompt).toBe('interactive prompt');
  });

  it('invokeInteractive() resolves immediately (returns void)', async () => {
    const provider = new RecorderProvider({ recordingPath });
    const result = await provider.invokeInteractive(makeOptions());
    expect(result).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T8: Concurrent writes
  // -------------------------------------------------------------------------

  it('handles concurrent invoke() calls without data loss', async () => {
    const provider = new RecorderProvider({ recordingPath });
    const count = 20;

    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        provider.invoke(makeOptions(`prompt-${i}`))
      )
    );

    const content = await readFile(recordingPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(count);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('handles mixed concurrent invoke() and invokeInteractive() calls', async () => {
    const provider = new RecorderProvider({ recordingPath });

    await Promise.all([
      provider.invoke(makeOptions('a')),
      provider.invokeInteractive(makeOptions('b')),
      provider.invoke(makeOptions('c')),
      provider.invokeInteractive(makeOptions('d')),
    ]);

    const content = await readFile(recordingPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(4);

    const kinds = lines.map((l) => JSON.parse(l).kind);
    expect(kinds.filter((k) => k === 'invoke')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'invokeInteractive')).toHaveLength(2);
  });
});
