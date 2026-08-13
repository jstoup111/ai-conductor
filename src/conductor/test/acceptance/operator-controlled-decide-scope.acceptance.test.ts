import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function contract(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${repoRoot}/`), 'utf8');
}

const harness = contract('HARNESS.md');
const explore = contract('skills/explore/SKILL.md');
const architectureReview = contract('skills/architecture-review/SKILL.md');
const stories = contract('skills/stories/SKILL.md');
const plan = contract('skills/plan/SKILL.md');

describe('Story 1: operator-controlled fix comprehensiveness', () => {
  it('asks how comprehensive the fix should be before confirming an approach and blocks without an answer', () => {
    expect(harness).toMatch(/operator.+chooses?.+(?:fix |repair )?(?:breadth|comprehensiveness)/is);
    expect(explore).toMatch(/ask.+how comprehensive.+before.+(?:recommend|confirm|select).+approach/is);
    expect(explore).toMatch(/(?:block|do not proceed|must not proceed).+(?:answer|confirmed)/is);
    expect(explore).toMatch(/(?:no|never|must not).+(?:silent|silently).+(?:default|choose)/is);
  });

  it('preserves the confirmed breadth through architecture review, stories, and planning', () => {
    for (const downstreamContract of [architectureReview, stories, plan]) {
      expect(downstreamContract).toMatch(/confirmed.+(?:breadth|comprehensiveness|scope boundary)/is);
      expect(downstreamContract).toMatch(/preserve.+(?:narrow|comprehensive).+(?:breadth|outcome|scope)/is);
    }
  });

  it('requires operator confirmation before a downstream step materially expands scope', () => {
    for (const downstreamContract of [architectureReview, stories, plan]) {
      expect(downstreamContract).toMatch(/material(?:ly)? broad(?:er|en|ening)?.+operator.+confirm/is);
      expect(downstreamContract).toMatch(/(?:block|must not|do not).+(?:expansion|broader).+(?:confirm|approval)/is);
    }
  });

  it('does not let active planning guidance unconditionally widen or narrow the operator-confirmed outcome', () => {
    expect(plan).toMatch(/scope boundary:.+binding/is);
    expect(plan).toMatch(/preserve.+confirmed.+(?:narrow|comprehensive).+(?:breadth|outcome)/is);
    expect(plan).toMatch(/do not permit.+broader expansion.+unless.+operator confirms/is);
    expect(plan).not.toMatch(/expand scope where valuable/i);
  });

});

describe('Story 2: ADRs only for structural change', () => {
  it('requires a real structural change before creating a new ADR', () => {
    expect(architectureReview).toMatch(/structural change.+necessary.+(?:ADR|decision record)/is);
    expect(architectureReview).toMatch(/(?:system )?boundar(?:y|ies)/i);
    expect(architectureReview).toMatch(/component|service decomposition/i);
    expect(architectureReview).toMatch(/integration/i);
    expect(architectureReview).toMatch(/state.+data|data.+state/i);
    expect(architectureReview).toMatch(/foundational technolog/i);
  });

  it('rejects non-structural importance, breadth, policy, wording, and implementation detail as ADR triggers', () => {
    expect(architectureReview).toMatch(/importance.+(?:not|does not|is not).+(?:sufficient|trigger|require)/is);
    expect(architectureReview).toMatch(/breadth.+(?:not|does not|is not).+(?:sufficient|trigger|require)/is);
    expect(architectureReview).toMatch(/workflow policy/i);
    expect(architectureReview).toMatch(/prompt wording/i);
    expect(architectureReview).toMatch(/ordinary implementation (?:choice|detail)/i);
  });

  it('keeps small structural changes eligible and reuses an existing governing ADR', () => {
    expect(architectureReview).toContain(
      'A small change may still warrant an ADR when it makes one\nof the structural decisions above;',
    );
    expect(architectureReview).toContain(
      'Reuse an existing governing ADR rather than duplicate it.',
    );
  });
});
