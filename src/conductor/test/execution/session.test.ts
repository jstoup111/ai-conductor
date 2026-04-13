import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../../src/execution/session.js';

describe('SessionManager', () => {
  let dir: string;
  let mgr: SessionManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'session-'));
    mgr = new SessionManager(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // --- Session ID ---

  describe('getSessionId', () => {
    it('creates a new UUID when no session file exists', async () => {
      const id = await mgr.getSessionId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('returns the same ID on subsequent calls', async () => {
      const first = await mgr.getSessionId();
      const second = await mgr.getSessionId();
      expect(first).toBe(second);
    });

    it('persists session ID to disk', async () => {
      const id = await mgr.getSessionId();
      const contents = await readFile(
        join(dir, 'conduct-session-id'),
        'utf-8',
      );
      expect(contents.trim()).toBe(id);
    });
  });

  describe('resetSession', () => {
    it('generates a new UUID different from the old one', async () => {
      const old = await mgr.getSessionId();
      const next = await mgr.resetSession();
      expect(next).not.toBe(old);
      expect(next).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('clears the session-created marker', async () => {
      await mgr.getSessionId();
      await mgr.markSessionCreated();
      expect(await mgr.isSessionCreated()).toBe(true);
      await mgr.resetSession();
      expect(await mgr.isSessionCreated()).toBe(false);
    });
  });

  // --- Marker ---

  describe('markSessionCreated / isSessionCreated', () => {
    it('returns false before marking', async () => {
      expect(await mgr.isSessionCreated()).toBe(false);
    });

    it('returns true after marking', async () => {
      await mgr.markSessionCreated();
      expect(await mgr.isSessionCreated()).toBe(true);
    });
  });

  // --- Claude args ---

  describe('buildClaudeArgs', () => {
    it('returns --session-id when session is not yet created', async () => {
      const id = await mgr.getSessionId();
      const args = mgr.buildClaudeArgs({});
      expect(args).toContain('--session-id');
      expect(args).toContain(id);
      expect(args).not.toContain('--resume');
    });

    it('returns --resume when session has been created', async () => {
      const id = await mgr.getSessionId();
      await mgr.markSessionCreated();
      const args = mgr.buildClaudeArgs({});
      expect(args).toContain('--resume');
      expect(args).toContain(id);
      expect(args).not.toContain('--session-id');
    });

    it('includes --dangerously-skip-permissions for non-interactive mode', async () => {
      await mgr.getSessionId();
      const args = mgr.buildClaudeArgs({ interactive: false });
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('omits --dangerously-skip-permissions for interactive mode', async () => {
      await mgr.getSessionId();
      const args = mgr.buildClaudeArgs({ interactive: true });
      expect(args).not.toContain('--dangerously-skip-permissions');
    });
  });

  // --- Detection ---

  describe('detectStaleSession', () => {
    it('returns true for "No conversation found"', () => {
      expect(mgr.detectStaleSession('Error: No conversation found for session')).toBe(true);
    });

    it('returns false for normal output', () => {
      expect(mgr.detectStaleSession('Task completed successfully')).toBe(false);
    });
  });

  describe('detectRateLimit', () => {
    it.each([
      'rate limit exceeded',
      'HTTP 429 Too Many Requests',
      'server overloaded please retry',
      'usage limit reached',
    ])('returns true for "%s"', (output) => {
      expect(mgr.detectRateLimit(output)).toBe(true);
    });

    it('returns false for normal output', () => {
      expect(mgr.detectRateLimit('All tests pass')).toBe(false);
    });
  });

  // --- Cooldown ---

  describe('getCooldownSeconds', () => {
    it('returns 60 for fewer than 10 calls', () => {
      expect(mgr.getCooldownSeconds(5)).toBe(60);
    });

    it('returns 120 for 10-19 calls', () => {
      expect(mgr.getCooldownSeconds(15)).toBe(120);
    });

    it('returns 180 for 20+ calls', () => {
      expect(mgr.getCooldownSeconds(25)).toBe(180);
    });
  });
});
