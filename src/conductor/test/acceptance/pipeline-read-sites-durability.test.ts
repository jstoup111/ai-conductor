// Story 3 (Task 5): .pipeline read sites are existence-guarded
// Tests verify that all bookkeeping read sites return sensible defaults when
// files/directories are missing, ensuring a mid-loop .pipeline wipe doesn't crash.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));

describe('Story 3 (Task 5): .pipeline read sites are existence-guarded', () => {
  let readSitesDir: string;
  let readSitesPipelineDir: string;

  beforeEach(async () => {
    readSitesDir = await mkdtemp(join(tmpdir(), 'read-sites-'));
    readSitesPipelineDir = join(readSitesDir, '.pipeline');
  });

  afterEach(async () => {
    await rm(readSitesDir, { recursive: true, force: true });
  });

  describe('SessionManager.getSessionId() - conduct-session-id read', () => {
    it('creates new ID when file absent', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      const { SessionManager } = await import('../../src/execution/session.js');
      const mgr = new SessionManager(readSitesPipelineDir);
      const id = await mgr.getSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('creates and guards dir when absent (GREEN: gap fixed)', async () => {
      // This test verifies the fix: getSessionId() now creates .pipeline if missing
      const { SessionManager } = await import('../../src/execution/session.js');
      const mgr = new SessionManager(readSitesPipelineDir);
      const id = await mgr.getSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const written = await readFile(join(readSitesPipelineDir, 'conduct-session-id'), 'utf-8');
      expect(written.trim()).toBe(id);
    });

    it('handles empty file gracefully', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      await writeFile(join(readSitesPipelineDir, 'conduct-session-id'), '', 'utf-8');
      const { SessionManager } = await import('../../src/execution/session.js');
      const mgr = new SessionManager(readSitesPipelineDir);
      const id = await mgr.getSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('reads existing valid ID', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      const expectedId = '12345678-1234-1234-1234-123456789abc';
      await writeFile(join(readSitesPipelineDir, 'conduct-session-id'), expectedId, 'utf-8');
      const { SessionManager } = await import('../../src/execution/session.js');
      const mgr = new SessionManager(readSitesPipelineDir);
      const id = await mgr.getSessionId();
      expect(id).toBe(expectedId);
    });
  });

  describe('SessionManager.isSessionCreated() - session-created marker', () => {
    it('returns false when marker absent', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      const { SessionManager } = await import('../../src/execution/session.js');
      const mgr = new SessionManager(readSitesPipelineDir);
      const created = await mgr.isSessionCreated();
      expect(created).toBe(false);
    });

    it('returns false when dir absent', async () => {
      const { SessionManager } = await import('../../src/execution/session.js');
      const mgr = new SessionManager(readSitesPipelineDir);
      const created = await mgr.isSessionCreated();
      expect(created).toBe(false);
    });

    it('returns true when marker exists', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      await writeFile(join(readSitesPipelineDir, 'session-created'), '1', 'utf-8');
      const { SessionManager } = await import('../../src/execution/session.js');
      const mgr = new SessionManager(readSitesPipelineDir);
      const created = await mgr.isSessionCreated();
      expect(created).toBe(true);
    });
  });

  describe('artifacts.ts checkStepCompletion(dir, "finish") - finish-choice read', () => {
    it('returns done:false when finish-choice absent', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      const { checkStepCompletion } = await import('../../src/engine/artifacts.js');
      const result = await checkStepCompletion(readSitesDir, 'finish', {
        daemon: false,
        sessionStartedAt: Date.now() - 5000,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toContain('finish-choice');
    });

    it('returns done:false when dir absent', async () => {
      const { checkStepCompletion } = await import('../../src/engine/artifacts.js');
      const result = await checkStepCompletion(readSitesDir, 'finish', {
        daemon: false,
        sessionStartedAt: Date.now() - 5000,
      });
      expect(result.done).toBe(false);
    });

    it('returns done:false when file empty', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      await writeFile(join(readSitesPipelineDir, 'finish-choice'), '', 'utf-8');
      const { checkStepCompletion } = await import('../../src/engine/artifacts.js');
      const result = await checkStepCompletion(readSitesDir, 'finish', {
        daemon: false,
        sessionStartedAt: Date.now() - 5000,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('returns done:false for invalid value', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      await writeFile(join(readSitesPipelineDir, 'finish-choice'), 'invalid', 'utf-8');
      const { checkStepCompletion } = await import('../../src/engine/artifacts.js');
      const result = await checkStepCompletion(readSitesDir, 'finish', {
        daemon: false,
        sessionStartedAt: Date.now() - 5000,
      });
      expect(result.done).toBe(false);
      expect(result.reason).toContain('unrecognized');
    });
  });

  describe('step-runners.ts readQuarantineSentinel() - QUARANTINE read', () => {
    it('returns without throwing when absent', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      const { DefaultStepRunner } = await import('../../src/engine/step-runners.js');
      const mockProvider = {
        invoke: vi.fn().mockResolvedValue({ success: true, output: '' }),
        invokeInteractive: vi.fn(),
      };
      const runner = new DefaultStepRunner(mockProvider as any, 'test', readSitesDir, {
        pipelineDir: readSitesPipelineDir,
      });
      const prompt = await runner['buildSystemPrompt']('build', true, undefined);
      expect(prompt).toBeDefined();
      expect(prompt).not.toContain('SETUP QUARANTINE CONTEXT');
    });

    it('returns without throwing when dir absent', async () => {
      const { DefaultStepRunner } = await import('../../src/engine/step-runners.js');
      const mockProvider = {
        invoke: vi.fn().mockResolvedValue({ success: true, output: '' }),
        invokeInteractive: vi.fn(),
      };
      const runner = new DefaultStepRunner(mockProvider as any, 'test', readSitesDir, {
        pipelineDir: readSitesPipelineDir,
      });
      const prompt = await runner['buildSystemPrompt']('build', true, undefined);
      expect(prompt).toBeDefined();
    });

    it('includes QUARANTINE content when present', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      const content = 'Quarantine ref: refs/heads/q\nPreserved: /path';
      await writeFile(join(readSitesPipelineDir, 'QUARANTINE'), content, 'utf-8');
      const { DefaultStepRunner } = await import('../../src/engine/step-runners.js');
      const mockProvider = {
        invoke: vi.fn().mockResolvedValue({ success: true, output: '' }),
        invokeInteractive: vi.fn(),
      };
      const runner = new DefaultStepRunner(mockProvider as any, 'test', readSitesDir, {
        pipelineDir: readSitesPipelineDir,
      });
      const prompt = await runner['buildSystemPrompt']('build', true, undefined);
      expect(prompt).toContain('SETUP QUARANTINE CONTEXT');
    });

    it('handles empty QUARANTINE file', async () => {
      await mkdir(readSitesPipelineDir, { recursive: true });
      await writeFile(join(readSitesPipelineDir, 'QUARANTINE'), '', 'utf-8');
      const { DefaultStepRunner } = await import('../../src/engine/step-runners.js');
      const mockProvider = {
        invoke: vi.fn().mockResolvedValue({ success: true, output: '' }),
        invokeInteractive: vi.fn(),
      };
      const runner = new DefaultStepRunner(mockProvider as any, 'test', readSitesDir, {
        pipelineDir: readSitesPipelineDir,
      });
      const prompt = await runner['buildSystemPrompt']('build', true, undefined);
      expect(prompt).toBeDefined();
    });
  });
});
