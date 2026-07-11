import { describe, it, expect } from 'vitest';

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
});
