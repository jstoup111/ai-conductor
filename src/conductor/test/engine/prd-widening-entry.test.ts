import { describe, expect, it, vi } from 'vitest';

import { preparePrdWideningEntry } from '../../src/engine/prd-widening-entry.js';

describe('preparePrdWideningEntry', () => {
  it('returns capture defects rather than hiding them before routing', async () => {
    const result = await preparePrdWideningEntry({
      projectRoot: '/not-read', feature: { version: 1, repository: 'acme/repo', feature: 'feature' }, priorHalt: '```json over-scope-decisions\nnot-json\n```',
      capture: { operator: undefined, offerStore: { mutate: vi.fn() }, decisionStore: { append: vi.fn() } },
    });
    expect(result.capture).toMatchObject({ kind: 'captured', defects: [{ kind: 'malformed-block' }] });
  });
});
