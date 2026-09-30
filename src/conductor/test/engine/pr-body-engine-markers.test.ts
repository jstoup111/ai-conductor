import { describe, it, expect } from 'vitest';
import {
  HALT_PR_BANNER_SENTINEL,
  NEEDS_REMEDIATION_BODY_MARKER,
  engineBodyIncludes,
  engineBodyLines,
  removeEngineBodyMarker,
} from '../../src/engine/pr-body-engine-markers.js';
import { hasHaltSignal } from '../../src/engine/halt-pr-rehabilitation.js';

const region = (content: string) => `<!-- ai-conductor:step attest -->\n${content}\n<!-- /ai-conductor:step -->`;

describe('engine marker reads ignore project-owned regions (ADR D6)', () => {
  it('hasHaltSignal ignores the remediation marker and banner inside a region', () => {
    const body = `## Summary\n\n${region(`${NEEDS_REMEDIATION_BODY_MARKER}\n${HALT_PR_BANNER_SENTINEL}`)}`;
    expect(hasHaltSignal({ title: 'feat: x', body, labels: [], isDraft: false })).toBe(false);
  });

  it('hasHaltSignal still sees an engine-owned marker outside regions', () => {
    const body = `## Summary\n\n${NEEDS_REMEDIATION_BODY_MARKER}`;
    expect(hasHaltSignal({ title: 'feat: x', body, labels: [], isDraft: false })).toBe(true);
  });

  it('engineBodyIncludes ignores region content', () => {
    expect(engineBodyIncludes(region(NEEDS_REMEDIATION_BODY_MARKER), NEEDS_REMEDIATION_BODY_MARKER)).toBe(false);
  });

  it('removeEngineBodyMarker removes the engine-owned marker and leaves the region byte-identical', () => {
    const owned = region(NEEDS_REMEDIATION_BODY_MARKER);
    const body = `${owned}\n\n${NEEDS_REMEDIATION_BODY_MARKER}`;
    expect(removeEngineBodyMarker(body, NEEDS_REMEDIATION_BODY_MARKER)).toBe(`${owned}\n\n`);
  });

  it('removeEngineBodyMarker leaves a body whose only marker is inside a region unchanged', () => {
    const body = region(NEEDS_REMEDIATION_BODY_MARKER);
    expect(removeEngineBodyMarker(body, NEEDS_REMEDIATION_BODY_MARKER)).toBe(body);
  });

  it('engineBodyLines masks region lines so banner filters keep them', () => {
    const lines = engineBodyLines(`${HALT_PR_BANNER_SENTINEL}\n${region(HALT_PR_BANNER_SENTINEL)}`);
    expect(lines.filter(({ masked }) => masked === HALT_PR_BANNER_SENTINEL).map(({ line }) => line)).toEqual([HALT_PR_BANNER_SENTINEL]);
  });
});
