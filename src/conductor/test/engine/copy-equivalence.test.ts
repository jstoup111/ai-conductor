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
});
