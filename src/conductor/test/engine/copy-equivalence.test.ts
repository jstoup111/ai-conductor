import { describe, expect, it } from 'vitest';
import { verifyCopyEquivalence } from '../../src/engine/copy-equivalence.js';

describe('verifyCopyEquivalence', () => {
  it('passes and names the verified pair when target content is the source with the ordered rename map applied', async () => {
    const sourcePath = 'src/engine/source-widget.ts';
    const targetPath = 'src/engine/target-widget.ts';
    const source = 'export const SourceWidget = "source-widget";\n';

    const result = await verifyCopyEquivalence(
      {
        kind: 'resolved',
        sourcePath,
        renameMap: [
          { source: 'SourceWidget', target: 'TargetWidget' },
          { source: 'source-widget', target: 'target-widget' },
        ],
      },
      targetPath,
      async (path) => (path === sourcePath ? source : 'export const TargetWidget = "target-widget";\n'),
    );

    expect(result).toEqual({
      kind: 'equivalent',
      verifiedPair: { sourcePath, targetPath },
    });
  });

  it('names the target and first differing region when content differs beyond the rename map', async () => {
    const sourcePath = 'src/engine/source-widget.ts';
    const targetPath = 'src/engine/target-widget.ts';

    await expect(verifyCopyEquivalence(
      {
        kind: 'resolved',
        sourcePath,
        renameMap: [{ source: 'SourceWidget', target: 'TargetWidget' }],
      },
      targetPath,
      async (path) => (path === sourcePath
        ? 'export const SourceWidget = "expected";\n'
        : 'export const TargetWidget = "actual";\n'),
    )).rejects.toThrow('Copy equivalence content mismatch for src/engine/target-widget.ts at line 1, column 30.');
  });

  it('reports a missing target when the target cannot be read', async () => {
    const sourcePath = 'src/engine/source-widget.ts';
    const targetPath = 'src/engine/target-widget.ts';

    await expect(verifyCopyEquivalence(
      { kind: 'resolved', sourcePath, renameMap: [] },
      targetPath,
      async (path) => {
        if (path === sourcePath) return 'export const SourceWidget = "source";\n';
        throw new Error('ENOENT');
      },
    )).rejects.toThrow('Copy equivalence missing target: src/engine/target-widget.ts.');
  });

  it('reports an unexpected target when its source cannot be read', async () => {
    const sourcePath = 'src/engine/source-widget.ts';
    const targetPath = 'src/engine/target-widget.ts';

    await expect(verifyCopyEquivalence(
      { kind: 'resolved', sourcePath, renameMap: [] },
      targetPath,
      async (path) => {
        if (path === targetPath) return 'export const TargetWidget = "target";\n';
        throw new Error('ENOENT');
      },
    )).rejects.toThrow('Copy equivalence unexpected target: src/engine/target-widget.ts.');
  });

  it('reports a rename-map collision when two source names map to one target name', async () => {
    await expect(verifyCopyEquivalence(
      {
        kind: 'resolved',
        sourcePath: 'src/engine/source-widget.ts',
        renameMap: [
          { source: 'SourceWidget', target: 'TargetWidget' },
          { source: 'OtherWidget', target: 'TargetWidget' },
        ],
      },
      'src/engine/target-widget.ts',
      async () => 'export const SourceWidget = "source";\n',
    )).rejects.toThrow('Copy equivalence rename-map collision: "SourceWidget" and "OtherWidget" both map to "TargetWidget".');
  });

  it('fails closed when the source becomes unreadable', async () => {
    const sourcePath = 'src/engine/source-widget.ts';
    const targetPath = 'src/engine/target-widget.ts';

    await expect(verifyCopyEquivalence(
      { kind: 'resolved', sourcePath, renameMap: [] },
      targetPath,
      async (path) => {
        if (path === targetPath) return 'export const TargetWidget = "target";\n';
        throw new Error('EACCES');
      },
    )).rejects.toThrow('Copy equivalence cannot read source: src/engine/source-widget.ts.');
  });
});
