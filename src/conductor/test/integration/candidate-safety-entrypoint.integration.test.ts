import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The provider executor can only enforce its resolved-candidate boundary when
 * the two production constructors supply it.  Unit coverage of an injected
 * callback is insufficient: an omitted field here silently turns BUILD/SHIP
 * into direct provider invocation.
 */
describe('candidate safety production wiring', () => {
  it.each(['index.ts', 'daemon-cli.ts'])(
    'supplies the approved candidate wrapper from %s',
    async (entrypoint) => {
      const source = await readFile(join(ROOT, 'src', entrypoint), 'utf8');

      const providerExecution = source.match(
        entrypoint === 'index.ts'
          ? /const providerExecution: ProviderExecutionContext = \{([\s\S]*?)\n  \};/
          : /const createProviderExecution = \([\s\S]*?\): ProviderExecutionContext => \(\{([\s\S]*?)\n  \}\);/,
      )?.[1];

      expect(providerExecution, `expected ${entrypoint} to construct ProviderExecutionContext`).toBeTruthy();
      expect(providerExecution).toMatch(/withCandidateSafety\s*:\s*createCandidateSafetyBoundary\(\)/);
    },
  );

  it('routes self-host BUILD and SHIP phases through the candidate-local dispatch', async () => {
    const source = await readFile(join(ROOT, 'src', 'engine', 'conductor.ts'), 'utf8');
    expect(source).toContain("this.providerExecution && ['BUILD', 'SHIP'].includes(phaseForStep(step.name))");
    expect(source).toContain("phase: phaseForStep(candidate.step)");
  });
});
