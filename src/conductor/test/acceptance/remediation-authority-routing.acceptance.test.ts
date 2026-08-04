/**
 * RED acceptance contract for implementation-only remediation routing.
 *
 * Story coverage:
 * - S1: both machine-consumed planner surfaces classify conforming
 *   implementation/test/documentation drift as BUILD, independent of the
 *   audit that reported it.
 * - S2: both surfaces reserve architecture_review for changing or clarifying
 *   approved architecture and keep in-scope plan omissions on the plan route.
 * - S3: both surfaces reject disposition/rationale contradictions in either
 *   direction.
 *
 * Existing coverage intentionally reused rather than duplicated:
 * - test/engine/conductor-remediation-authority-routing.test.ts proves the
 *   runtime BUILD routing matrix, including taskless rejection.
 * - test/acceptance/daemon-decide-kickback-halt.acceptance.test.ts proves the
 *   daemon's real DECIDE guard halts before re-authoring protected artifacts.
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');

const CONTRACT_SURFACES = [
  ['remediate skill', 'skills/remediate/SKILL.md'],
  ['remediation planner', 'agents/remediation-planner.md'],
] as const;

describe.each(CONTRACT_SURFACES)('%s authority contract', (_label, relativePath) => {
  async function contract(): Promise<string> {
    return readFile(join(REPO_ROOT, relativePath), 'utf8');
  }

  it('reserves architecture_review for changing or clarifying approved architecture', async () => {
    const text = await contract();

    expect(text).toMatch(
      /architecture_review[\s\S]{0,500}(?:chang(?:e|ing)|clarif(?:y|ying|ication))[\s\S]{0,180}approved architecture/i,
    );
    expect(text).not.toMatch(
      /architecture_review[^\n|]*(?:correct fix is clear|needs no decision|no decision needed)/i,
    );
  });

  it('routes drift that preserves approved architecture to build regardless of audit origin', async () => {
    const text = await contract();

    expect(text).toMatch(/approved architecture remains (?:applicable|authoritative)/i);
    expect(text).toMatch(
      /(?:implementation|impl)[\s/,_-]*(?:test|tests)[\s/,_-]*(?:documentation|docs)[\s\S]{0,240}\bbuild\b/i,
    );
    expect(text).toMatch(
      /(?:origin|reported by|finding id)[\s\S]{0,160}(?:alone|itself)[\s\S]{0,160}(?:does not|never)[\s\S]{0,100}(?:determine|select|decide)/i,
    );
  });

  it('keeps an in-scope planning omission on the plan route', async () => {
    const text = await contract();

    expect(text).toMatch(
      /\bplan\b[\s\S]{0,300}(?:in scope|in-scope)[\s\S]{0,180}(?:omission|omitted|missed)/i,
    );
    expect(text).toMatch(/(?:planning|plan)[ -](?:omission|miss)[\s\S]{0,160}not (?:an? )?(?:architecture|design)/i);
  });

  it('rejects both disposition/rationale contradiction directions', async () => {
    const text = await contract();

    expect(text).toMatch(
      /architecture_review[\s\S]{0,260}no (?:architecture|architectural|product) decision[\s\S]{0,180}(?:reject|invalid|forbidden|contradict)/i,
    );
    expect(text).toMatch(
      /\bbuild\b[\s\S]{0,260}(?:unresolved|ambiguous)[\s\S]{0,100}(?:architecture|architectural)[\s\S]{0,180}(?:reject|invalid|forbidden|contradict)/i,
    );
  });
});
