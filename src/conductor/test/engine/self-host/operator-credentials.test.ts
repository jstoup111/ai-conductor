import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readOperatorCredentialsState } from '../../../src/engine/self-host/operator-credentials.js';

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
