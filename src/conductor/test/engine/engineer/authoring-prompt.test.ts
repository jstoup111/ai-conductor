// Test: buildAuthoringPrompt embeds LessonDigest into the authoring prompt (Task 14, FR-5)
import { describe, it, expect } from 'vitest';
import { buildAuthoringPrompt } from '../../../src/engine/engineer/authoring.js';
import type { LessonDigest, RetrievedLesson } from '../../../src/engine/engineer/lesson-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLesson(id: string, text: string, metadata: Record<string, unknown> = {}): RetrievedLesson {
  return { id, text, metadata };
}

function emptyDigest(): LessonDigest {
  return { kickbacks: [], halts: [], retryHotspots: [], narrativeRefs: [] };
}

// ---------------------------------------------------------------------------
// FR-5 happy path — digest content is OBSERVABLE in the returned prompt string
// ---------------------------------------------------------------------------

describe('buildAuthoringPrompt — digest observably present', () => {
  it('includes the idea and project in the returned prompt', () => {
    const idea = 'add real-time notifications';
    const project = 'acme-api';
    const digest = emptyDigest();

    const result = buildAuthoringPrompt(idea, project, digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(prompt).toContain(idea);
    expect(prompt).toContain(project);
  });

  it('embeds kickback lesson text literally in the prompt', () => {
    const kickbackLesson = makeLesson(
      'kick-1',
      'Auth kickback caused 2 rework cycles on login gate',
      { outcome: 'completed' },
    );
    const digest: LessonDigest = {
      kickbacks: [kickbackLesson],
      halts: [],
      retryHotspots: [],
      narrativeRefs: [],
    };

    const result = buildAuthoringPrompt('build auth flow', 'acme-api', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(prompt).toContain(kickbackLesson.text);
  });

  it('embeds halt lesson text literally in the prompt', () => {
    const haltLesson = makeLesson(
      'halt-1',
      'Gate loop halted after 3 failed evaluations',
      { outcome: 'halted' },
    );
    const digest: LessonDigest = {
      kickbacks: [],
      halts: [haltLesson],
      retryHotspots: [],
      narrativeRefs: [],
    };

    const result = buildAuthoringPrompt('build auth flow', 'acme-api', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(prompt).toContain(haltLesson.text);
  });

  it('embeds retryHotspot lesson text literally in the prompt', () => {
    const retryLesson = makeLesson(
      'retry-1',
      'hotspot detected: database migration step requires retry logic',
      { outcome: 'completed' },
    );
    const digest: LessonDigest = {
      kickbacks: [],
      halts: [],
      retryHotspots: [retryLesson],
      narrativeRefs: [],
    };

    const result = buildAuthoringPrompt('add migration tooling', 'acme-api', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(prompt).toContain(retryLesson.text);
  });

  it('embeds narrativeRef lesson text literally in the prompt', () => {
    const narrativeLesson = makeLesson(
      'narr-1',
      'Feature delivery narrated at docs/retro-2025-q1.md',
      { outcome: 'completed', narrativeRef: 'docs/retro-2025-q1.md' },
    );
    const digest: LessonDigest = {
      kickbacks: [],
      halts: [],
      retryHotspots: [],
      narrativeRefs: [narrativeLesson],
    };

    const result = buildAuthoringPrompt('plan Q2 feature', 'acme-api', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(prompt).toContain(narrativeLesson.text);
  });

  it('embeds ALL lesson texts when digest has multiple populated groups', () => {
    const kick = makeLesson('k1', 'kickback on schema validation step', { outcome: 'completed' });
    const halt = makeLesson('h1', 'daemon halted after gate timeout', { outcome: 'halted' });
    const retry = makeLesson('r1', 'retry loop triggered on deploy hotspot', { outcome: 'completed' });
    const narr = makeLesson('n1', 'narrated feature delivery: see docs/q3.md', { outcome: 'completed', narrativeRef: 'docs/q3.md' });

    const digest: LessonDigest = {
      kickbacks: [kick],
      halts: [halt],
      retryHotspots: [retry],
      narrativeRefs: [narr],
    };

    const result = buildAuthoringPrompt('big feature rollout', 'acme-api', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(prompt).toContain(kick.text);
    expect(prompt).toContain(halt.text);
    expect(prompt).toContain(retry.text);
    expect(prompt).toContain(narr.text);
  });
});

// ---------------------------------------------------------------------------
// Empty digest — "no prior lessons" must be EXPLICITLY observable
// ---------------------------------------------------------------------------

describe('buildAuthoringPrompt — empty digest is explicitly observable', () => {
  it('contains explicit "no prior lessons" phrasing when digest is empty', () => {
    const digest = emptyDigest();

    const result = buildAuthoringPrompt('brand new idea', 'fresh-project', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    // The exact phrasing must be observable so a downstream LLM/reader sees absence
    expect(prompt.toLowerCase()).toContain('no prior lessons');
  });

  it('does NOT silently omit the lessons section for an empty digest', () => {
    const digest = emptyDigest();

    const result = buildAuthoringPrompt('another idea', 'another-project', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    // The lessons section header must still appear (not silently dropped)
    // even though it will report "no prior lessons"
    expect(prompt.toLowerCase()).toMatch(/lesson|prior/);
  });

  it('still includes idea and project even with empty digest', () => {
    const idea = 'deploy monitoring dashboard';
    const project = 'ops-project';
    const digest = emptyDigest();

    const result = buildAuthoringPrompt(idea, project, digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(prompt).toContain(idea);
    expect(prompt).toContain(project);
    expect(prompt.toLowerCase()).toContain('no prior lessons');
  });
});

// ---------------------------------------------------------------------------
// Adversarial / negative-path: malformed / edge inputs
// ---------------------------------------------------------------------------

describe('buildAuthoringPrompt — negative paths and edge cases', () => {
  it('handles a digest where only one group is populated (others empty)', () => {
    // Only halts populated — other groups are empty
    const haltLesson = makeLesson('h-only', 'execution halted on third attempt', { outcome: 'halted' });
    const digest: LessonDigest = {
      kickbacks: [],
      halts: [haltLesson],
      retryHotspots: [],
      narrativeRefs: [],
    };

    const result = buildAuthoringPrompt('partial feature', 'partial-project', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    // Halt lesson IS present
    expect(prompt).toContain(haltLesson.text);
    // Prompt does NOT claim "no prior lessons" because at least one lesson exists
    expect(prompt.toLowerCase()).not.toContain('no prior lessons');
  });

  it('handles lesson text with special characters without breaking the prompt', () => {
    const specialLesson = makeLesson(
      'special-1',
      'Lesson with "quotes", \'apostrophes\', and `backticks` — plus: colons: and\nnewlines',
      { outcome: 'completed' },
    );
    const digest: LessonDigest = {
      kickbacks: [specialLesson],
      halts: [],
      retryHotspots: [],
      narrativeRefs: [],
    };

    const result = buildAuthoringPrompt('edge case idea', 'edge-project', digest);
    const prompt = typeof result === 'string' ? result : result.prompt;

    // Special characters must survive verbatim in the output
    expect(prompt).toContain(specialLesson.text);
  });

  it('returns a non-empty string (or object with non-empty prompt) regardless of inputs', () => {
    const result = buildAuthoringPrompt('', '', emptyDigest());
    const prompt = typeof result === 'string' ? result : result.prompt;

    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});
