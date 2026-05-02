import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RecorderProvider } from '../index.js';

function makeOptions(prompt = 'hello') {
  return { prompt, sessionId: 'test-session', resume: false };
}

describe('RecorderProvider tokenUsage', () => {
  let tempDir: string;
  let recordingPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'recorder-token-'));
    recordingPath = join(tempDir, 'recordings.jsonl');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('invoke() returns deterministic tokenUsage { input: 10, output: 5 }', async () => {
    const provider = new RecorderProvider({ recordingPath });
    const result = await provider.invoke(makeOptions());

    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage?.input).toBe(10);
    expect(result.tokenUsage?.output).toBe(5);
  });

  it('tokenUsage is present on every invoke() call', async () => {
    const provider = new RecorderProvider({ recordingPath });
    const r1 = await provider.invoke(makeOptions('first'));
    const r2 = await provider.invoke(makeOptions('second'));

    expect(r1.tokenUsage?.input).toBe(10);
    expect(r2.tokenUsage?.input).toBe(10);
  });
});
