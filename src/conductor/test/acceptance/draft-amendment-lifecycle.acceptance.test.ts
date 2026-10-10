// Covers: task:2
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');

async function readContract(relativePath: string): Promise<string> {
  return readFile(join(REPO_ROOT, relativePath), 'utf8');
}

function amendmentOwnershipSection(contract: string): string {
  return contract.match(
    /### DECIDE Artifact Amendment Ownership\n([\s\S]*?)(?=\n### |\n## )/,
  )?.[0] ?? '';
}

function hasDraftInPlaceRevisionRule(section: string): boolean {
  return /absent from the base\s+branch[\s\S]{0,220}revise(?:d)?\s+(?:it|the artifact)\s+in place[\s\S]{0,180}remove(?:d)?\s+superseded text[\s\S]{0,160}no amendment note/i.test(section);
}

function hasStoryOnlyAmendmentException(contract: string): boolean {
  const exception = contract.match(
    /Story artifacts under `\.docs\/stories\/`[\s\S]{0,220}?exception[\s\S]{0,220}?\./i,
  )?.[0];

  return (
    exception !== undefined &&
    !/\b(?:plans?|specs?|ADRs?|architecture documents|coherence mappings)\b/i.test(exception)
  );
}

describe('DECIDE artifact amendment lifecycle contract', () => {
  it('revises drafts absent from the base in place without an amendment note', async () => {
    const section = amendmentOwnershipSection(await readContract('HARNESS.md'));

    expect(hasDraftInPlaceRevisionRule(section)).toBe(true);
    expect(hasDraftInPlaceRevisionRule(section.replace(/revise(?:d)? (?:it|the artifact) in place/i, 'correct it'))).toBe(false);
  });

  it('keeps the additive note and original-text safeguard for non-story artifacts on the base', async () => {
    const section = amendmentOwnershipSection(await readContract('HARNESS.md'));

    expect(section).toMatch(/non-story[\s\S]{0,180}already on the base\s+branch/i);
    expect(section).toMatch(/beside the original assertion[\s\S]{0,180}Amended YYYY-MM-DD by #NNN/i);
    expect(section).toMatch(/never rewrite or delete the original text/i);
    expect(section).toMatch(/draft[\s\S]{0,180}absent from the base branch/i);
  });

  it('keeps the story exception narrow and names the draft-amendment-note land gate', async () => {
    const contract = await readContract('HARNESS.md');
    const section = amendmentOwnershipSection(contract);

    expect(hasStoryOnlyAmendmentException(contract)).toBe(true);
    expect(section).toMatch(/draft-amendment-note/);
  });
});
