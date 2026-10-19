// Covers: task:1, task:2, task:3
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkOrder,
  verifyWorkOrder,
  WORK_ORDER_SCHEMA_VERSION,
  WorkOrderBaseShaMissingError,
  WorkOrderManifestMismatchError,
} from '../../src/engine/work-order.js';
import type { EnginePin } from '../../src/engine/engine-pin.js';
import type { EngineVersionId } from '../../src/engine/engine-version-id.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const ENGINE_VERSION_ID = '20261019T120000Z-aaaaaaaaaaaa' as EngineVersionId;
const ENGINE_PIN: EnginePin = {
  engineVersionId: ENGINE_VERSION_ID,
  engineDir: `/engine/dist-versions/${ENGINE_VERSION_ID}`,
  fallbackReason: undefined,
};

describe('engine/work-order', () => {
  it('round-trips a fully populated order with a ref-and-hash document manifest', async () => {
    const documents = new Map([
      ['.docs/specs/parallel-dispatch.md', '# Specification'],
      ['.docs/plans/parallel-dispatch.md', '# Plan'],
      ['.docs/stories/parallel-dispatch.md', '# Stories'],
    ]);
    const gitCalls: string[][] = [];
    const order = await buildWorkOrder(
      {
        repository: 'jstoup/ai-conductor',
        slug: 'parallel-dispatch',
        baseSha: 'a'.repeat(40),
        enginePin: ENGINE_PIN,
        documentRefs: [...documents.keys()],
        tier: 'L',
        sourceRef: 'owner/repo#42',
        track: 'technical',
        band: 'P0',
        resolutionMode: 'banded',
      },
      async (args) => {
        gitCalls.push([...args]);
        const [command, object] = args;
        const [, ref] = object.split(':', 2);
        return command === 'show' && ref && documents.has(ref)
          ? { exitCode: 0, stdout: documents.get(ref)!, stderr: '' }
          : { exitCode: 1, stdout: '', stderr: 'missing document' };
      },
    );
    const serialized = JSON.stringify(order);

    expect({
      roundTrip: JSON.parse(serialized),
      manifestKeys: order.manifest.map((entry) => Object.keys(entry).sort()),
      contentHashes: order.manifest.map((entry) => entry.contentHash),
      gitCalls,
      serializedKeys: Object.keys(JSON.parse(serialized)).sort(),
      containsAbsolutePath: serialized.includes('/home/') || serialized.includes('\\\\'),
    }).toEqual({
      roundTrip: {
        repository: 'jstoup/ai-conductor',
        slug: 'parallel-dispatch',
        baseSha: 'a'.repeat(40),
        engineVersionId: ENGINE_VERSION_ID,
        schemaVersion: WORK_ORDER_SCHEMA_VERSION,
        tier: 'L',
        sourceRef: 'owner/repo#42',
        track: 'technical',
        band: 'P0',
        resolutionMode: 'banded',
        manifest: [
          ...[...documents.entries()].map(([ref, content]) => ({
            ref,
            contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
          })),
        ],
      },
      manifestKeys: [['contentHash', 'ref'], ['contentHash', 'ref'], ['contentHash', 'ref']],
      contentHashes: [...documents.values()].map(
        (content) => `sha256:${createHash('sha256').update(content).digest('hex')}`,
      ),
      gitCalls: [...documents.keys()].map((ref) => ['show', `${'a'.repeat(40)}:${ref}`]),
      serializedKeys: ['band', 'baseSha', 'engineVersionId', 'manifest', 'repository', 'resolutionMode', 'schemaVersion', 'slug', 'sourceRef', 'tier', 'track'],
      containsAbsolutePath: false,
    });
  });

  it('preserves the claim-time engine pin through JSON and rejects incompatible order identities', async () => {
    const order = await buildWorkOrder(
      {
        repository: 'jstoup/ai-conductor',
        slug: 'parallel-dispatch',
        baseSha: 'a'.repeat(40),
        enginePin: ENGINE_PIN,
        documentRefs: [],
      },
      async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    );

    expect(JSON.parse(JSON.stringify(order))).toEqual(order);

    const gitMustNotRun = async () => {
      throw new Error('work-order identity must be checked before Git');
    };
    await expect(verifyWorkOrder(
      { ...order, schemaVersion: WORK_ORDER_SCHEMA_VERSION + 1 } as WorkOrder,
      gitMustNotRun,
    )).rejects.toThrow(/schemaVersion/);
    await expect(verifyWorkOrder(
      { ...order, engineVersionId: 'not-an-engine-version' as EngineVersionId },
      gitMustNotRun,
    )).rejects.toThrow(/engineVersionId/);
  });

  it.each(['/outside/spec.md', 'C:\\outside\\spec.md'])(
    'rejects absolute document ref %s before resolving it from Git',
    async (ref) => {
      const gitCalls: string[][] = [];
      let message: string | undefined;
      try {
        await buildWorkOrder(
          {
            repository: 'jstoup/ai-conductor',
            slug: 'parallel-dispatch',
            baseSha: 'a'.repeat(40),
            enginePin: ENGINE_PIN,
            documentRefs: [ref],
          },
          async (args) => {
            gitCalls.push([...args]);
            return { exitCode: 0, stdout: '# Specification', stderr: '' };
          },
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect({ message, gitCalls }).toEqual({
        message: `document ref must be repository-relative: ${ref}`,
        gitCalls: [],
      });
    },
  );

  it('rejects a changed manifest document before creating its worktree', async () => {
    const baseSha = 'a'.repeat(40);
    const ref = '.docs/plans/parallel-dispatch.md';
    const expectedContents = '# Approved plan';
    const actualContents = '# Changed after dispatch';
    const gitCalls: string[][] = [];
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'work-order-'));
    const worktreePath = join(temporaryRoot, 'feature-worktree');
    const order = {
      repository: 'jstoup/ai-conductor',
      slug: 'parallel-dispatch',
      baseSha,
      engineVersionId: ENGINE_VERSION_ID,
      schemaVersion: WORK_ORDER_SCHEMA_VERSION,
      manifest: [
        {
          ref,
          contentHash: `sha256:${createHash('sha256').update(expectedContents).digest('hex')}`,
        },
      ],
    } satisfies WorkOrder;

    try {
      let caught: unknown;
      try {
        await verifyWorkOrder(order, async (args) => {
          gitCalls.push([...args]);
          if (args[0] === 'cat-file') {
            return { exitCode: 0, stdout: '', stderr: '' };
          }
          if (args[0] === 'show' && args[1] === `${baseSha}:${ref}`) {
            return { exitCode: 0, stdout: actualContents, stderr: '' };
          }
          return { exitCode: 1, stdout: '', stderr: 'unexpected git call' };
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(WorkOrderManifestMismatchError);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain(ref);
      await expect(stat(worktreePath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(gitCalls.some(([command, subcommand]) => command === 'worktree' && subcommand === 'add')).toBe(false);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it('rejects an unavailable base SHA before resolving manifests or creating its worktree', async () => {
    const baseSha = 'b'.repeat(40);
    const gitCalls: string[][] = [];
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'work-order-'));
    const worktreePath = join(temporaryRoot, 'feature-worktree');
    const order = {
      repository: 'jstoup/ai-conductor',
      slug: 'parallel-dispatch',
      baseSha,
      engineVersionId: ENGINE_VERSION_ID,
      schemaVersion: WORK_ORDER_SCHEMA_VERSION,
      manifest: [
        {
          ref: '.docs/plans/not-needed.md',
          contentHash: `sha256:${createHash('sha256').update('# Irrelevant').digest('hex')}`,
        },
      ],
    } satisfies WorkOrder;

    try {
      let caught: unknown;
      try {
        await verifyWorkOrder(order, async (args) => {
          gitCalls.push([...args]);
          return args[0] === 'cat-file' && args[1] === '-e' && args[2] === baseSha
            ? { exitCode: 1, stdout: '', stderr: 'missing base' }
            : { exitCode: 1, stdout: '', stderr: 'manifest should not resolve' };
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(WorkOrderBaseShaMissingError);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain(baseSha);
      expect(gitCalls).toEqual([['cat-file', '-e', baseSha]]);
      await expect(stat(worktreePath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(gitCalls.some(([command, subcommand]) => command === 'worktree' && subcommand === 'add')).toBe(false);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});
