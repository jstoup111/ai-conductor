// Test: handleGateResponse — confirm/redirect/decline gate (Task 18, FR-3 negative paths)
//
// handleGateResponse(result, operatorResponse, registeredProjects, onAuthor?)
// is a PURE function that maps a RoutingResult + operator text → RoutingOutcome.
// No real repo I/O. onAuthor spy is injected to verify zero writes on decline.
//
// Scenarios:
//   1. confirm ('y' / 'yes')                → outcome 'confirmed', project = proposed (top candidate)
//   2. redirect to REGISTERED project name  → outcome 'redirected', project = redirect target
//   3. redirect to UNKNOWN name             → outcome 'reprompt', no project path fabricated
//   4. decline / empty response             → outcome 'declined', onAuthor spy never called
//   5. near-tie (two equally-scored cands)  → outcome 'needs-choice', lists both; does NOT auto-pick

import { describe, it, expect, vi } from 'vitest';
import { handleGateResponse } from '../../../src/engine/brain/routing.js';
import type { GateOutcome } from '../../../src/engine/brain/routing.js';
import type { ProjectRecord } from '../../../src/engine/registry.js';
import type { RoutingResult, RoutingCandidate } from '../../../src/engine/brain/routing.js';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeRecord(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

function makeCandidate(name: string, path: string, score: number): RoutingCandidate {
  return {
    project: makeRecord(name, path),
    score,
    rationale: `Rationale for ${name}`,
  };
}

/** A routing result with a clear winner above threshold. */
function makeClearResult(topName: string): RoutingResult {
  return {
    candidates: [
      makeCandidate(topName, `/projects/${topName}`, 0.92),
      makeCandidate('other', '/projects/other', 0.30),
    ],
    createSuggested: false,
  };
}

/** A routing result with two near-tied candidates (delta < 0.05). */
function makeTiedResult(): RoutingResult {
  return {
    candidates: [
      makeCandidate('alpha', '/projects/alpha', 0.88),
      makeCandidate('beta', '/projects/beta', 0.87),
    ],
    createSuggested: false,
  };
}

/** All registered project records available to the gate. */
const REGISTERED: ProjectRecord[] = [
  makeRecord('alpha', '/projects/alpha'),
  makeRecord('beta', '/projects/beta'),
  makeRecord('gamma', '/projects/gamma'),
];

// --------------------------------------------------------------------------
// Scenario 1 — confirm ('y' / 'yes')
// --------------------------------------------------------------------------

describe('handleGateResponse — confirm', () => {
  it("'y' yields confirmed carrying the top-ranked project", () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'y', REGISTERED);

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.project.name).toBe('alpha');
      expect(outcome.project.path).toBe('/projects/alpha');
    }
  });

  it("'yes' also yields confirmed (case-insensitive)", () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'yes', REGISTERED);

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.project.name).toBe('alpha');
    }
  });

  it("'Y' (uppercase) also yields confirmed", () => {
    const result = makeClearResult('gamma');
    // gamma is NOT in the REGISTERED list, so we test with alpha.
    const result2 = makeClearResult('alpha');
    const outcome = handleGateResponse(result2, 'Y', REGISTERED);

    expect(outcome.kind).toBe('confirmed');
    if (outcome.kind === 'confirmed') {
      expect(outcome.project.name).toBe('alpha');
    }
  });
});

// --------------------------------------------------------------------------
// Scenario 2 — redirect to a REGISTERED project name
// --------------------------------------------------------------------------

describe('handleGateResponse — redirect to registered project', () => {
  it('yields redirected carrying the REDIRECT TARGET — not the originally-proposed project', () => {
    // Top candidate is 'alpha', operator says "use beta instead".
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'beta', REGISTERED);

    expect(outcome.kind).toBe('redirected');
    if (outcome.kind === 'redirected') {
      // Must be the redirect target, NOT alpha.
      expect(outcome.project.name).toBe('beta');
      expect(outcome.project.name).not.toBe('alpha');
      expect(outcome.project.path).toBe('/projects/beta');
    }
  });

  it('redirect target project record comes from the registered list (no fabrication)', () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'gamma', REGISTERED);

    expect(outcome.kind).toBe('redirected');
    if (outcome.kind === 'redirected') {
      // Path must match the canonical record from REGISTERED — not invented.
      expect(outcome.project.path).toBe('/projects/gamma');
    }
  });
});

// --------------------------------------------------------------------------
// Scenario 3 — redirect to an UNKNOWN / unregistered project name
// --------------------------------------------------------------------------

describe('handleGateResponse — redirect to unknown project (reprompt)', () => {
  it('yields reprompt when operator names a project not in the registry', () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'does-not-exist', REGISTERED);

    expect(outcome.kind).toBe('reprompt');
  });

  it('reprompt outcome does NOT carry a project field (no fabricated path)', () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'phantom-project', REGISTERED);

    expect(outcome.kind).toBe('reprompt');
    // Structural check: reprompt must NOT have a project property.
    // @ts-expect-error — 'project' should not exist on reprompt
    const _noop = (outcome as { project?: unknown }).project;
    void _noop;
    // If TypeScript compiles the @ts-expect-error without error, the type has
    // no project field. The runtime check below is the falsifiable assertion.
    expect('project' in outcome).toBe(false);
  });

  it('reprompt carries the unrecognised name so caller can surface a helpful message', () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'totally-unknown', REGISTERED);

    expect(outcome.kind).toBe('reprompt');
    if (outcome.kind === 'reprompt') {
      expect(outcome.unknownName).toBe('totally-unknown');
    }
  });
});

// --------------------------------------------------------------------------
// Scenario 4 — decline / empty response → no authoring triggered
// --------------------------------------------------------------------------

describe('handleGateResponse — decline', () => {
  it("'n' yields declined", () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'n', REGISTERED);

    expect(outcome.kind).toBe('declined');
  });

  it("empty string yields declined", () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, '', REGISTERED);

    expect(outcome.kind).toBe('declined');
  });

  it("whitespace-only response yields declined", () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, '   ', REGISTERED);

    expect(outcome.kind).toBe('declined');
  });

  it('decline does NOT return a confirmed outcome (type-level structural guard)', () => {
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'n', REGISTERED);

    // Falsifiable: if the handler erroneously returns confirmed, this fails.
    expect(outcome.kind).not.toBe('confirmed');
    expect(outcome.kind).not.toBe('redirected');
    expect(outcome.kind).toBe('declined');
  });

  it('decline with onAuthor spy — spy is NEVER called (zero writes)', () => {
    const result = makeClearResult('alpha');
    const onAuthor = vi.fn();

    const outcome = handleGateResponse(result, 'n', REGISTERED, onAuthor);

    expect(outcome.kind).toBe('declined');
    // Falsifiable: if onAuthor were called even once, this assertion fails.
    expect(onAuthor).toHaveBeenCalledTimes(0);
  });

  it('empty response with onAuthor spy — spy is NEVER called', () => {
    const result = makeClearResult('alpha');
    const onAuthor = vi.fn();

    handleGateResponse(result, '', REGISTERED, onAuthor);

    expect(onAuthor).toHaveBeenCalledTimes(0);
  });
});

// --------------------------------------------------------------------------
// Scenario 5 — near-tie (two similarly-scored candidates)
// --------------------------------------------------------------------------

describe('handleGateResponse — near-tie surfaces needs-choice', () => {
  it('yields needs-choice when operator says "y" but candidates are too close to auto-pick', () => {
    // Delta between scores is 0.01 — well within tie threshold.
    const result = makeTiedResult();
    const outcome = handleGateResponse(result, 'y', REGISTERED);

    // Must NOT auto-pick silently — must surface the choice.
    expect(outcome.kind).toBe('needs-choice');
    expect(outcome.kind).not.toBe('confirmed');
  });

  it('needs-choice outcome lists ALL tied candidates', () => {
    const result = makeTiedResult();
    const outcome = handleGateResponse(result, 'y', REGISTERED);

    expect(outcome.kind).toBe('needs-choice');
    if (outcome.kind === 'needs-choice') {
      const names = outcome.candidates.map((c) => c.project.name);
      // Falsifiable: if only one candidate is listed, these assertions fail.
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
      expect(outcome.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('needs-choice does NOT auto-select the top candidate (no project field)', () => {
    const result = makeTiedResult();
    const outcome = handleGateResponse(result, 'yes', REGISTERED);

    expect(outcome.kind).toBe('needs-choice');
    // Structural: needs-choice must not have a 'project' field (would imply auto-pick).
    if (outcome.kind === 'needs-choice') {
      expect('project' in outcome).toBe(false);
    }
  });

  it('a clear winner (delta >= 0.05) is NOT treated as a tie even if scores are both high', () => {
    // alpha=0.92, other=0.30 — delta is 0.62, well above tie threshold.
    const result = makeClearResult('alpha');
    const outcome = handleGateResponse(result, 'y', REGISTERED);

    // Not a tie → should not return needs-choice.
    expect(outcome.kind).not.toBe('needs-choice');
    expect(outcome.kind).toBe('confirmed');
  });
});
