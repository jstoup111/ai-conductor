// Port purity guard — Task 4, FR-13, C5
//
// Static import-graph assertion: the engineer core (loop.ts) must NOT import
// the concrete claude-session adapter. The core must depend only on the port
// interface (intake/port), never the concrete adapter.
//
// Design note (from plan Task 4):
// "loop.ts may not import the port yet — the purity test can assert the
// negative: that loop.ts does not import intake/claude-session. Keep the
// assertion robust to current loop.ts state; it must pass now and remain
// meaningful."
//
// This test asserts the NEGATIVE (no concrete adapter import). The positive
// assertion (loop imports the port) is a separate concern handled in the
// acceptance spec (intake.test.ts) and guarded by the loop reshape task.
import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

// Path to the engineer core loop
const loopPath = join(here, '..', '..', '..', '..', 'src', 'engine', 'engineer', 'loop.ts');

// Path to the intake directory
const intakeDirPath = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'src',
  'engine',
  'engineer',
  'intake',
);

describe('port-purity: engineer core must not import concrete adapters (FR-13, C5)', () => {
  it('loop.ts does NOT statically import intake/claude-session', async () => {
    const loopSrc = await readFile(loopPath, 'utf8');

    // The core loop must never statically import the concrete claude-session adapter.
    // This enforces the hexagonal port pattern: core → port only.
    expect(loopSrc).not.toMatch(/from ['"][^'"]*intake\/claude-session(\.js)?['"]/);
    expect(loopSrc).not.toMatch(/require\(['"][^'"]*intake\/claude-session(\.js)?['"]\)/);
  });

  it('intake/port.ts exists and exports IntakePort interface + parseEnvelope', async () => {
    const portPath = join(intakeDirPath, 'port.ts');
    const portSrc = await readFile(portPath, 'utf8');

    // The port module must define the IntakePort interface — the seam the core depends on.
    expect(portSrc).toMatch(/IntakePort/);
    // The port must export parseEnvelope — the boundary validation function.
    expect(portSrc).toMatch(/parseEnvelope/);
  });

  it('intake/ directory contains port.ts (the seam module)', async () => {
    const files = await readdir(intakeDirPath);
    expect(files).toContain('port.ts');
  });

  it('loop.ts does not import any intake/claude-session OR intake/github-issues adapter', async () => {
    const loopSrc = await readFile(loopPath, 'utf8');

    // Broader guard: no concrete adapter — not claude-session, not github-issues,
    // nor any future concrete adapter directory entry (9.3b adapters are deferred).
    expect(loopSrc).not.toMatch(/intake\/claude-session/);
    expect(loopSrc).not.toMatch(/intake\/github-issues/);
  });
});
