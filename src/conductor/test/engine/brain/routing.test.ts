// Test: routeIdea — LLM routing inference over registry (Task 17, FR-3, ADR-007)
//
// routeIdea(idea, registryReader, provider, opts?) queries the registry for
// candidate projects, asks an injected RoutingProvider to rank them, and
// returns a ranked result set. NO real LLM call is made in tests — providers
// are stubs.
//
// Scenarios:
//   (a) Happy path — provider returns a high-confidence ranking → ranked
//       candidates with rationale surfaced, no create suggestion.
//   (b) Below-threshold — provider signals low confidence → create suggestion
//       surfaces in the result.
//   (c) No-fit — provider returns all scores below threshold → create suggestion.
//   (d) Tie — provider returns two equally high-scoring candidates → BOTH
//       surfaced (not silently collapsed to one).
//   (e) Empty registry — no projects → create suggestion immediately (no LLM
//       call needed).
//   (f) Negative: provider throws → routeIdea propagates the error (no swallow).

import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRegistryReader } from '../../../src/engine/registry.js';
import { routeIdea } from '../../../src/engine/brain/routing.js';
import type { RoutingProvider, RoutingResult } from '../../../src/engine/brain/routing.js';
import type { RegistryReader, ProjectRecord } from '../../../src/engine/registry.js';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeRecord(path: string, name: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'registered',
    registeredAt: '2026-06-25T00:00:00.000Z',
  };
}

/** Build a stub RoutingProvider that returns the given raw response string. */
function stubProvider(response: string): RoutingProvider {
  return { invoke: vi.fn().mockResolvedValue(response) };
}

/** Stub RegistryReader returning a fixed list without touching disk. */
function stubReader(records: ProjectRecord[]): RegistryReader {
  return {
    listProjects: vi.fn().mockResolvedValue(records),
    getProject: vi.fn().mockResolvedValue(undefined),
  };
}

// --------------------------------------------------------------------------
// Canonical provider response format: JSON array of candidate objects.
// Each object: { name: string; score: number; rationale: string }
// score is 0–1 (1 = perfect match).
// --------------------------------------------------------------------------

function encodeRanking(
  candidates: Array<{ name: string; score: number; rationale: string }>,
): string {
  return JSON.stringify(candidates);
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('routeIdea — happy path (FR-3)', () => {
  it('returns ranked candidates when provider returns high-confidence matches', async () => {
    const reader = stubReader([
      makeRecord('/projects/alpha', 'alpha'),
      makeRecord('/projects/beta', 'beta'),
      makeRecord('/projects/gamma', 'gamma'),
    ]);
    const response = encodeRanking([
      { name: 'alpha', score: 0.95, rationale: 'Best match — feature aligns with alpha domain' },
      { name: 'beta', score: 0.60, rationale: 'Partial overlap with beta scope' },
      { name: 'gamma', score: 0.20, rationale: 'Weak match' },
    ]);
    const provider = stubProvider(response);

    const result: RoutingResult = await routeIdea('add OAuth login', reader, provider);

    // Must have candidates, sorted by score descending.
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0].project.name).toBe('alpha');
    expect(result.candidates[0].score).toBe(0.95);
    expect(result.candidates[0].rationale).toContain('alpha domain');

    // High-confidence best match → no create suggestion forced.
    expect(result.createSuggested).toBe(false);
  });

  it('includes rationale strings on all returned candidates', async () => {
    const reader = stubReader([
      makeRecord('/projects/alpha', 'alpha'),
      makeRecord('/projects/beta', 'beta'),
    ]);
    const response = encodeRanking([
      { name: 'alpha', score: 0.85, rationale: 'Clear domain fit' },
      { name: 'beta', score: 0.40, rationale: 'Marginal' },
    ]);
    const result = await routeIdea('add a billing module', reader, stubProvider(response));

    for (const c of result.candidates) {
      expect(typeof c.rationale).toBe('string');
      expect(c.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe('routeIdea — below-threshold (FR-3)', () => {
  it('sets createSuggested=true when best candidate score is below threshold', async () => {
    const reader = stubReader([
      makeRecord('/projects/alpha', 'alpha'),
      makeRecord('/projects/beta', 'beta'),
    ]);
    // All scores below default threshold (0.5).
    const response = encodeRanking([
      { name: 'alpha', score: 0.30, rationale: 'Weak overlap' },
      { name: 'beta', score: 0.20, rationale: 'Very weak' },
    ]);

    const result = await routeIdea('build a completely new fintech app', reader, stubProvider(response));

    expect(result.createSuggested).toBe(true);
    // Candidates still present so caller can show them as "low-confidence" options.
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('sets createSuggested=true when provider returns no candidates at all', async () => {
    const reader = stubReader([
      makeRecord('/projects/alpha', 'alpha'),
    ]);
    const response = encodeRanking([]);

    const result = await routeIdea('something completely novel', reader, stubProvider(response));

    expect(result.createSuggested).toBe(true);
    expect(result.candidates).toHaveLength(0);
  });

  it('respects a custom threshold passed via opts', async () => {
    const reader = stubReader([
      makeRecord('/projects/alpha', 'alpha'),
    ]);
    // Score 0.65 — above default (0.5) but below custom threshold (0.8).
    const response = encodeRanking([
      { name: 'alpha', score: 0.65, rationale: 'Moderate match' },
    ]);

    const result = await routeIdea(
      'restructure payment flow',
      reader,
      stubProvider(response),
      { confidenceThreshold: 0.8 },
    );

    expect(result.createSuggested).toBe(true);
  });
});

describe('routeIdea — tie / multiple strong candidates (FR-3)', () => {
  it('surfaces ALL candidates above threshold when scores are tied', async () => {
    const reader = stubReader([
      makeRecord('/projects/alpha', 'alpha'),
      makeRecord('/projects/beta', 'beta'),
      makeRecord('/projects/gamma', 'gamma'),
    ]);
    // Alpha and beta both at 0.90 — tied; gamma below threshold.
    const response = encodeRanking([
      { name: 'alpha', score: 0.90, rationale: 'Strong domain alignment' },
      { name: 'beta', score: 0.90, rationale: 'Equally strong match' },
      { name: 'gamma', score: 0.25, rationale: 'Poor match' },
    ]);

    const result = await routeIdea('shared authentication service', reader, stubProvider(response));

    // Both tied-top candidates must be present — not silently collapsed.
    const names = result.candidates.map((c) => c.project.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');

    // No create suggested — there ARE strong matches.
    expect(result.createSuggested).toBe(false);
  });

  it('does NOT silently collapse a tie to a single winner', async () => {
    const reader = stubReader([
      makeRecord('/projects/alpha', 'alpha'),
      makeRecord('/projects/beta', 'beta'),
    ]);
    const response = encodeRanking([
      { name: 'alpha', score: 0.88, rationale: 'Very good' },
      { name: 'beta', score: 0.88, rationale: 'Equally very good' },
    ]);

    const result = await routeIdea('message queue integration', reader, stubProvider(response));

    // Must return 2 candidates, not 1.
    expect(result.candidates.length).toBe(2);
  });
});

describe('routeIdea — empty registry (FR-3)', () => {
  it('immediately returns createSuggested=true with no candidates when registry is empty', async () => {
    const reader = stubReader([]);
    // Provider should NOT be called — there is nothing to rank.
    const provider = stubProvider('[]');

    const result = await routeIdea('build anything', reader, provider);

    expect(result.createSuggested).toBe(true);
    expect(result.candidates).toHaveLength(0);
    // Provider must NOT have been invoked — no projects to rank.
    expect(provider.invoke).not.toHaveBeenCalled();
  });
});

describe('routeIdea — real RegistryReader (integration sanity)', () => {
  it('works end-to-end with createRegistryReader over a temp file', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'route-idea-test-'));
    try {
      const p1 = join(tmpDir, 'project-one');
      const p2 = join(tmpDir, 'project-two');
      await mkdir(p1, { recursive: true });
      await mkdir(p2, { recursive: true });

      const records: ProjectRecord[] = [
        makeRecord(p1, 'project-one'),
        makeRecord(p2, 'project-two'),
      ];
      const registryPath = join(tmpDir, 'registry.json');
      await writeFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');

      const reader = createRegistryReader({ registryPath });
      const response = encodeRanking([
        { name: 'project-one', score: 0.92, rationale: 'Perfect fit' },
        { name: 'project-two', score: 0.45, rationale: 'Poor fit' },
      ]);
      const provider = stubProvider(response);

      const result = await routeIdea('add a new API endpoint', reader, provider);

      expect(result.candidates[0].project.name).toBe('project-one');
      expect(result.createSuggested).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('routeIdea — adversarial / negative paths', () => {
  it('propagates provider errors — does NOT swallow them', async () => {
    const reader = stubReader([makeRecord('/projects/alpha', 'alpha')]);
    const brokenProvider: RoutingProvider = {
      invoke: vi.fn().mockRejectedValue(new Error('LLM network failure')),
    };

    await expect(routeIdea('anything', reader, brokenProvider)).rejects.toThrow('LLM network failure');
  });

  it('handles malformed provider JSON gracefully (treats as no candidates → create suggested)', async () => {
    const reader = stubReader([makeRecord('/projects/alpha', 'alpha')]);
    const provider = stubProvider('this is not JSON at all');

    const result = await routeIdea('some idea', reader, provider);

    // Can't parse → treat as no usable candidates → create suggested.
    expect(result.createSuggested).toBe(true);
  });

  it('ignores provider candidate names that do not match any registry record', async () => {
    const reader = stubReader([makeRecord('/projects/alpha', 'alpha')]);
    // Provider hallucinates 'nonexistent' — must be filtered out.
    const response = encodeRanking([
      { name: 'nonexistent', score: 0.99, rationale: 'Hallucinated project' },
      { name: 'alpha', score: 0.55, rationale: 'Real project, real match' },
    ]);

    const result = await routeIdea('add feature', reader, stubProvider(response));

    const names = result.candidates.map((c) => c.project.name);
    expect(names).not.toContain('nonexistent');
    expect(names).toContain('alpha');
  });
});
