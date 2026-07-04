import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readOperatorCredentialsState,
  waitForCredentialsChange,
} from '../../../src/engine/self-host/operator-credentials.js';

// Phase 2 (TR-2): operator-credentials reader — fresh/expired classification.
// The pre-flight must identify expired or imminent-expiry credentials so the
// conductor parks BEFORE launching a build. Fail-open: any read error or missing
// claudeAiOauth → 'unknown' (dispatch proceeds, no park).

describe('self-host/operator-credentials — readOperatorCredentialsState (TR-2)', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'op-creds-'));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it('expiresAt in the past → expired', async () => {
    const pastTime = Date.now() - 1000; // 1 second ago
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { expiresAt: pastTime } }),
      'utf-8',
    );

    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('expired');
  });

  it('expiresAt in the future, beyond imminent-expiry margin → fresh', async () => {
    const futureTime = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days from now
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { expiresAt: futureTime } }),
      'utf-8',
    );

    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('fresh');
  });

  it('expiresAt within the imminent-expiry margin (within 7 days) → expired', async () => {
    const imminentTime = Date.now() + 3 * 24 * 60 * 60 * 1000; // 3 days from now
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { expiresAt: imminentTime } }),
      'utf-8',
    );

    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('expired');
  });

  it('missing credentials file → unknown (fail-open)', async () => {
    // Do not write the file
    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('unknown');
  });

  it('malformed JSON → unknown (fail-open)', async () => {
    await writeFile(
      join(configDir, '.credentials.json'),
      '{not valid json',
      'utf-8',
    );

    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('unknown');
  });

  it('well-formed JSON without claudeAiOauth → unknown (fail-open)', async () => {
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({ other: 1 }),
      'utf-8',
    );

    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('unknown');
  });

  it('claudeAiOauth without expiresAt field → unknown (fail-open)', async () => {
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { token: 'something' } }),
      'utf-8',
    );

    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('unknown');
  });

  it('expiresAt is not a number → unknown (fail-open)', async () => {
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { expiresAt: 'not-a-number' } }),
      'utf-8',
    );

    const result = await readOperatorCredentialsState(configDir, Date.now());
    expect(result).toBe('unknown');
  });

  it('accepts injectable now parameter for time-machine testing', async () => {
    const fixedNow = 1000000000000; // Some fixed timestamp
    const expiresAt = fixedNow + 30 * 24 * 60 * 60 * 1000; // 30 days from fixedNow
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { expiresAt } }),
      'utf-8',
    );

    // When now=fixedNow, the token is 30 days away and beyond the 7-day margin → fresh
    const result = await readOperatorCredentialsState(configDir, fixedNow);
    expect(result).toBe('fresh');
  });
});

// Phase 3 (TR-3 & TR-4): park-and-poll wait primitive.
// The conductor parks on expired credentials, then polls for the file to be updated.
// Polling stops when credentials become fresh (TR-3 happy) or timeout elapses (TR-4).
// Fail-open: file deletion keeps polling (no crash).

describe('self-host/operator-credentials — waitForCredentialsChange (TR-3 & TR-4)', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'op-creds-'));
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('Scenario A: mtime advances with unexpired expiresAt → resolves with refreshed state', async () => {
    const baseTime = 1000000000000;
    const credPath = join(configDir, '.credentials.json');

    // Start with expired credentials
    const expiredExpiresAt = baseTime - 1000;
    await writeFile(
      credPath,
      JSON.stringify({ claudeAiOauth: { expiresAt: expiredExpiresAt } }),
      'utf-8',
    );

    const nowRef = { value: baseTime };
    let sleepCallCount = 0;

    const result = waitForCredentialsChange({
      initialState: 'expired',
      credentialsPath: credPath,
      globalConfigDir: configDir,
      timeoutMs: 10000,
      pollIntervalMs: 100,
      sleep: async (ms) => {
        sleepCallCount++;
        // On first sleep, update the file with unexpired credentials
        if (sleepCallCount === 1) {
          nowRef.value += ms;
          const freshExpiresAt = baseTime + 30 * 24 * 60 * 60 * 1000;
          await writeFile(
            credPath,
            JSON.stringify({ claudeAiOauth: { expiresAt: freshExpiresAt } }),
            'utf-8',
          );
        }
      },
      now: () => nowRef.value,
    });

    const outcome = await result;
    expect(outcome.type).toBe('refreshed');
    expect(outcome.credentialsPath).toBe(credPath);
    expect(outcome.credentialsState).toBe('fresh');
  });

  it('Scenario B: mtime advances but content still expired, then eventually becomes fresh', async () => {
    const baseTime = 1000000000000;
    const credPath = join(configDir, '.credentials.json');

    // Start with expired credentials
    const expiredExpiresAt = baseTime - 1000;
    await writeFile(
      credPath,
      JSON.stringify({ claudeAiOauth: { expiresAt: expiredExpiresAt } }),
      'utf-8',
    );

    const nowRef = { value: baseTime };
    let sleepCallCount = 0;

    const result = waitForCredentialsChange({
      initialState: 'expired',
      credentialsPath: credPath,
      globalConfigDir: configDir,
      timeoutMs: 20000,
      pollIntervalMs: 100,
      sleep: async (ms) => {
        sleepCallCount++;
        nowRef.value += ms;
        // First update: still expired
        if (sleepCallCount === 1) {
          const stillExpiredExpiresAt = baseTime + 1000;
          await writeFile(
            credPath,
            JSON.stringify({ claudeAiOauth: { expiresAt: stillExpiredExpiresAt } }),
            'utf-8',
          );
        }
        // Second update: now fresh
        else if (sleepCallCount === 2) {
          const freshExpiresAt = baseTime + 30 * 24 * 60 * 60 * 1000;
          await writeFile(
            credPath,
            JSON.stringify({ claudeAiOauth: { expiresAt: freshExpiresAt } }),
            'utf-8',
          );
        }
      },
      now: () => nowRef.value,
    });

    const outcome = await result;
    expect(outcome.type).toBe('refreshed');
    expect(outcome.credentialsState).toBe('fresh');
  });

  it('Scenario C: file deleted mid-park keeps polling toward timeout', async () => {
    const baseTime = 1000000000000;
    const credPath = join(configDir, '.credentials.json');

    // Start with expired credentials
    const expiredExpiresAt = baseTime - 1000;
    await writeFile(
      credPath,
      JSON.stringify({ claudeAiOauth: { expiresAt: expiredExpiresAt } }),
      'utf-8',
    );

    const nowRef = { value: baseTime };
    let sleepCallCount = 0;

    const result = waitForCredentialsChange({
      initialState: 'expired',
      credentialsPath: credPath,
      globalConfigDir: configDir,
      timeoutMs: 1000,
      pollIntervalMs: 100,
      sleep: async (ms) => {
        sleepCallCount++;
        nowRef.value += ms;
        // On first sleep, delete the file
        if (sleepCallCount === 1) {
          await rm(credPath, { force: true });
        }
        // Continue advancing time without restoring the file
      },
      now: () => nowRef.value,
    });

    const outcome = await result;
    expect(outcome.type).toBe('timeout');
    expect(outcome.credentialsPath).toBe(credPath);
    // expiresAt should be the last observed value (expired)
    expect(outcome.expiresAt).toBe(String(expiredExpiresAt));
  });

  it('Scenario D: timeout elapses without update', async () => {
    const baseTime = 1000000000000;
    const credPath = join(configDir, '.credentials.json');

    // Start with expired credentials
    const expiredExpiresAt = baseTime - 1000;
    await writeFile(
      credPath,
      JSON.stringify({ claudeAiOauth: { expiresAt: expiredExpiresAt } }),
      'utf-8',
    );

    const nowRef = { value: baseTime };

    const result = waitForCredentialsChange({
      initialState: 'expired',
      credentialsPath: credPath,
      globalConfigDir: configDir,
      timeoutMs: 1000,
      pollIntervalMs: 100,
      sleep: async (ms) => {
        nowRef.value += ms;
        // Don't update the file; just advance time
      },
      now: () => nowRef.value,
    });

    const outcome = await result;
    expect(outcome.type).toBe('timeout');
    expect(outcome.credentialsPath).toBe(credPath);
    expect(outcome.expiresAt).toBe(String(expiredExpiresAt));
  });
});
