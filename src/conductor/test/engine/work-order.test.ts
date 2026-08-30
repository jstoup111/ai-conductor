// Covers: task:1
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildWorkOrder } from '../../src/engine/work-order.js';

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
        documentRefs: [...documents.keys()],
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
      serializedKeys: ['baseSha', 'manifest', 'repository', 'slug'],
      containsAbsolutePath: false,
    });
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
});
