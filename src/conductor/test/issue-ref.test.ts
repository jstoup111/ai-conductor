import { describe, it, expect, vi } from 'vitest';

const MOD_PATH = '../src/engine/engineer/issue-ref.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

describe('issue-ref', () => {
  describe('resolveIssueRefKeyword', () => {
    it('returns "Closes" for undefined declaration', async () => {
      const mod = await load();
      const resolveIssueRefKeyword = requireFn(mod, 'resolveIssueRefKeyword');

      const result = resolveIssueRefKeyword(undefined);

      expect(result).toBe('Closes');
    });

    it('returns "Closes" for close-on-merge declaration', async () => {
      const mod = await load();
      const resolveIssueRefKeyword = requireFn(mod, 'resolveIssueRefKeyword');

      const declaration = {
        kind: 'close-on-merge',
        rationale: 'This fix resolves the underlying issue; closing on merge is safe.',
      };

      const result = resolveIssueRefKeyword(declaration);

      expect(result).toBe('Closes');
    });

    it('returns "Refs" for watched declaration', async () => {
      const mod = await load();
      const resolveIssueRefKeyword = requireFn(mod, 'resolveIssueRefKeyword');

      const declaration = {
        kind: 'watched',
        signature: 'test',
        isRegex: false,
        windowDays: 14,
        surface: 'daemon-log' as const,
      };

      const result = resolveIssueRefKeyword(declaration);

      expect(result).toBe('Refs');
    });
  });

  describe('closeIssueOnImplementationMerge', () => {
    it('Test 4: closeIssueOnImplementationMerge with watched declaration calls enroll and injects Refs', async () => {
      const mod = await load();
      const closeIssueOnImplementationMerge = requireFn(mod, 'closeIssueOnImplementationMerge');

      const enrollCalls: unknown[] = [];
      const enroll = vi.fn(async (entry: unknown) => {
        enrollCalls.push(entry);
      });

      const ghCalls: unknown[] = [];
      const gh = vi.fn(async (args: string[], opts: { cwd: string }) => {
        ghCalls.push({ args, opts });
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ body: '' }) };
        }
        return { stdout: '' };
      });

      const declaration = {
        kind: 'watched' as const,
        signature: 'fix-observed',
        isRegex: false,
        windowDays: 14,
        surface: 'daemon-log' as const,
      };

      const outcome = await closeIssueOnImplementationMerge({
        gh,
        sourceRef: '#42',
        prUrl: 'https://github.com/org/repo/pull/123',
        cwd: '/repo',
        slug: 'test-feature',
        declaration,
        enroll,
      });

      expect(outcome).toBe('attempted');
      expect(enrollCalls).toHaveLength(1);
      const enrolledEntry = enrollCalls[0] as Record<string, unknown>;
      expect(enrolledEntry.v).toBe(1);
      expect(enrolledEntry.sourceRef).toBe('#42');
      expect(enrolledEntry.prUrl).toBe('https://github.com/org/repo/pull/123');
      expect(enrolledEntry.slug).toBe('test-feature');
      expect(enrolledEntry.signature).toBe('fix-observed');
      expect(enrolledEntry.isRegex).toBe(false);
      expect(enrolledEntry.windowDays).toBe(14);
      expect(typeof enrolledEntry.enrolledAt).toBe('number');
    });

    it('Test 5: closeIssueOnImplementationMerge with close-on-merge injects Closes and no enroll', async () => {
      const mod = await load();
      const closeIssueOnImplementationMerge = requireFn(mod, 'closeIssueOnImplementationMerge');

      const enrollCalls: unknown[] = [];
      const enroll = vi.fn(async (entry: unknown) => {
        enrollCalls.push(entry);
      });

      const gh = vi.fn(async (args: string[], opts: { cwd: string }) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ body: '' }) };
        }
        return { stdout: '' };
      });

      const declaration = {
        kind: 'close-on-merge' as const,
        rationale: 'This fix resolves the underlying issue; closing on merge is safe.',
      };

      const outcome = await closeIssueOnImplementationMerge({
        gh,
        sourceRef: '#42',
        prUrl: 'https://github.com/org/repo/pull/123',
        cwd: '/repo',
        slug: 'test-feature',
        declaration,
        enroll,
      });

      expect(outcome).toBe('attempted');
      expect(enrollCalls).toHaveLength(0);
    });

    it('Test 6: closeIssueOnImplementationMerge with no declaration defaults to Closes and no enroll (legacy path)', async () => {
      const mod = await load();
      const closeIssueOnImplementationMerge = requireFn(mod, 'closeIssueOnImplementationMerge');

      const enrollCalls: unknown[] = [];
      const enroll = vi.fn(async (entry: unknown) => {
        enrollCalls.push(entry);
      });

      const gh = vi.fn(async (args: string[], opts: { cwd: string }) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ body: '' }) };
        }
        return { stdout: '' };
      });

      const outcome = await closeIssueOnImplementationMerge({
        gh,
        sourceRef: '#42',
        prUrl: 'https://github.com/org/repo/pull/123',
        cwd: '/repo',
        slug: 'test-feature',
        enroll,
      });

      expect(outcome).toBe('attempted');
      expect(enrollCalls).toHaveLength(0);
    });

    it('Test 7: closeIssueOnImplementationMerge with enroll throwing swallows error and still injects', async () => {
      const mod = await load();
      const closeIssueOnImplementationMerge = requireFn(mod, 'closeIssueOnImplementationMerge');

      const enrollError = new Error('Registry write failed');
      const enroll = vi.fn(async (entry: unknown) => {
        throw enrollError;
      });

      const gh = vi.fn(async (args: string[], opts: { cwd: string }) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ body: '' }) };
        }
        return { stdout: '' };
      });

      const declaration = {
        kind: 'watched' as const,
        signature: 'fix-observed',
        isRegex: false,
        windowDays: 14,
        surface: 'daemon-log' as const,
      };

      const outcome = await closeIssueOnImplementationMerge({
        gh,
        sourceRef: '#42',
        prUrl: 'https://github.com/org/repo/pull/123',
        cwd: '/repo',
        slug: 'test-feature',
        declaration,
        enroll,
      });

      expect(outcome).toBe('attempted');
      expect(enroll).toHaveBeenCalled();
    });
  });
});
