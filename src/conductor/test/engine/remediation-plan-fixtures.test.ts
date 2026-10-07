// Covers: task:18
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createRemediationPlanProviderFixture,
  type RemediationPlanProviderOutcome,
} from './remediation-plan-fixtures.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('typed remediation plan provider fixture', () => {
  // Covers: task:18
  it.each(['claude', 'codex'] as const)(
    'installs a %s fake runtime that returns scripted outcomes in order and records each invocation',
    async (key) => {
      const root = await mkdtemp(join(tmpdir(), 'remediation-plan-fixture-'));
      roots.push(root);
      const schema = { type: 'object', properties: { version: { type: 'string' } } };
      const structured = { version: 'v1', dispositions: [] };
      const providerCondition = {
        success: false,
        output: 'authentication required',
        exitCode: 1,
        authFailure: true,
      } as const;
      const outcomes: readonly RemediationPlanProviderOutcome[] = [
        { kind: 'structured', finalStructuredResult: structured },
        { kind: 'chat', output: JSON.stringify(structured) },
        { kind: 'throw', error: new Error('fixture throw') },
        { kind: 'timeout', output: 'fixture timeout' },
        { kind: 'provider-condition', result: providerCondition },
      ];
      const fixture = createRemediationPlanProviderFixture({ key, outcomes });

      expect(fixture.runtimes.get(key)).toMatchObject({
        key,
        provider: fixture.provider,
        nativeSchemaCapability: { nativeOutputSchema: true },
      });

      await expect(fixture.provider.invoke({
        prompt: 'first', sessionId: 'session-1', resume: false, cwd: root, nativeSchema: schema,
      })).resolves.toEqual({ success: true, output: 'structured result', exitCode: 0, finalStructuredResult: structured });
      await expect(fixture.provider.invoke({
        prompt: 'second', sessionId: 'session-2', resume: false, cwd: root,
      })).resolves.toEqual({ success: true, output: JSON.stringify(structured), exitCode: 0 });
      await expect(fixture.provider.invoke({
        prompt: 'third', sessionId: 'session-3', resume: false, cwd: root, nativeSchema: schema,
      })).rejects.toThrow('fixture throw');
      await expect(fixture.provider.invoke({
        prompt: 'fourth', sessionId: 'session-4', resume: false, cwd: root,
      })).resolves.toEqual({ success: false, output: 'fixture timeout', exitCode: 124 });
      await expect(fixture.provider.invoke({
        prompt: 'fifth', sessionId: 'session-5', resume: false, cwd: root, nativeSchema: schema,
      })).resolves.toEqual(providerCondition);

      expect(fixture.invocationCount).toBe(5);
      expect(fixture.calls).toEqual([
        { sessionId: 'session-1', nativeSchema: schema },
        { sessionId: 'session-2', nativeSchema: undefined },
        { sessionId: 'session-3', nativeSchema: schema },
        { sessionId: 'session-4', nativeSchema: undefined },
        { sessionId: 'session-5', nativeSchema: schema },
      ]);
      await expect(access(join(root, '.pipeline', 'remediation.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
