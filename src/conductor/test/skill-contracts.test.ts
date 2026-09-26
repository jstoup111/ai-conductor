import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('architecture-review skill contract', () => {
  it('delegates as-built output-format enforcement to the scoped provider audit', async () => {
    const audit = await readFile(
      fileURLToPath(new URL('../../../test/test_provider_skill_contracts.sh', import.meta.url)),
      'utf8',
    );

    expect(audit).toContain('as_built_skill_prose_audit');
    expect(audit).toContain('as-built output-format prose rejected');
  });
});
