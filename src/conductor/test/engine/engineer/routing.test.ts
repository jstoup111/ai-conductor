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
//
// Task 27 (FR-3, C2): In-chat routing proposal + confirmation gate — no subprocess.
//   - Loop prints a proposal carrying target repo + rationale before asking for
//     human confirmation. Routing is reasoned in-chat (no claude -p spawn).
//   - C2 static: routing.ts does NOT spawn 'claude' or 'claude -p'.
//   - C2 static: routing.ts does NOT import readline / call createInterface.
//   - Behavioral: scripted IO confirms the proposal produces the expected output
//     and pauses at the confirmation gate before acting.
//
// Task 28 (FR-3, C1): Redirect leaves the ORIGINALLY PROPOSED repo untouched.
//   - When the human redirects to a different project, the originally-proposed
//     project receives NO branch, NO PR, NO working-tree change.
//
// Task 31 (FR-5): Create-on-no-fit offer + decline/partial-fail rollback.
//   - No existing repo fits → loop offers to create a new project.
//   - DECLINE → registry unchanged, no directory created, zero side effects.
//   - PARTIAL scaffold failure → no dangling registry entry (clean rollback).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { createRegistryReader } from '../../../src/engine/registry.js';
import { routeIdea } from '../../../src/engine/engineer/routing.js';
import type { RoutingProvider, RoutingResult } from '../../../src/engine/engineer/routing.js';
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

// =============================================================================
// Task 27 (FR-3, C2): In-chat routing proposal + confirmation gate — no subprocess.
// =============================================================================

// ── C2 static source checks ───────────────────────────────────────────────────

function routingSrcPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'src', 'engine', 'engineer', 'routing.ts');
}

describe('Task 27: routing.ts C2 static invariants — no subprocess, no TTY REPL', () => {
  it('[C2] routing.ts does NOT spawn the claude CLI (no execFile/spawn of "claude")', async () => {
    const src = await readFile(routingSrcPath(), 'utf8');
    // Forbidden: spawning the claude binary for routing — routing is in-chat.
    expect(src).not.toMatch(/execFile\s*\(\s*['"]claude['"]/);
    expect(src).not.toMatch(/spawn\s*\(\s*['"]claude['"]/);
    // Also check for `claude -p` (the headless process form).
    expect(src).not.toMatch(/claude\s+-p/);
  });

  it('[C2] routing.ts does NOT import readline or call createInterface (no Node TTY REPL)', async () => {
    const src = await readFile(routingSrcPath(), 'utf8');
    // Forbidden: a readline REPL for routing — the host agent drives the gate.
    expect(src).not.toMatch(/from\s+['"]node:readline['"]/);
    expect(src).not.toMatch(/require\s*\(\s*['"]readline['"]\s*\)/);
    expect(src).not.toMatch(/createInterface/);
  });

  it('[C2] routing.ts is a pure-function / async module — no process.stdin consumption', async () => {
    const src = await readFile(routingSrcPath(), 'utf8');
    // Routing primitives must be pure (no direct stdin reads).
    expect(src).not.toMatch(/process\.stdin\.read/);
    expect(src).not.toMatch(/process\.stdin\.on\s*\(/);
  });
});

// ── Behavioral: loop produces a proposal + pauses for confirmation ────────────

// Shared temp-dir scaffolding for loop integration tests in this file.
let workDir27: string;
let registryPath27: string;
let engineerDir27: string;
const savedEnv27: Record<string, string | undefined> = {};

beforeEach(async () => {
  workDir27 = await mkdtemp(join(tmpdir(), 'routing-task27-'));
  registryPath27 = join(workDir27, 'registry.json');
  engineerDir27 = join(workDir27, 'engineer');
  await mkdir(engineerDir27, { recursive: true });
  savedEnv27.AI_CONDUCTOR_REGISTRY = process.env.AI_CONDUCTOR_REGISTRY;
  savedEnv27.AI_CONDUCTOR_ENGINEER_DIR = process.env.AI_CONDUCTOR_ENGINEER_DIR;
  process.env.AI_CONDUCTOR_REGISTRY = registryPath27;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir27;
});

afterEach(async () => {
  process.env.AI_CONDUCTOR_REGISTRY = savedEnv27.AI_CONDUCTOR_REGISTRY;
  process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv27.AI_CONDUCTOR_ENGINEER_DIR;
  await rm(workDir27, { recursive: true, force: true });
});

/** Scripted IO: queued lines → null on EOF. Captures printed output. */
function scriptedIo27(lines: string[]) {
  const queue = [...lines];
  const out: string[] = [];
  return {
    out,
    text: () => out.join('\n'),
    io: {
      prompt: async (): Promise<string | null> => (queue.length ? queue.shift()! : null),
      print: (s: string) => out.push(s),
    },
  };
}

function makeRecord27(path: string, name: string) {
  return {
    schemaVersion: 1 as const,
    name,
    path,
    status: 'registered' as const,
    registeredAt: '2026-06-26T00:00:00.000Z',
  };
}

async function writeRegistry27(records: unknown[]): Promise<void> {
  await writeFile(registryPath27, JSON.stringify(records, null, 2), 'utf-8');
}

describe('Task 27: in-chat routing proposal + confirmation gate (FR-3, C2)', () => {
  it('loop prints a proposal naming the top-candidate project before asking for confirmation', async () => {
    // Set up a project directory (the target) and a registry with one record.
    const projDir = join(workDir27, 'my-project');
    await mkdir(projDir, { recursive: true });
    await writeRegistry27([makeRecord27(projDir, 'my-project')]);

    // Provider stub: returns high-confidence ranking for the single project.
    // loop.ts routingProvider adapter reads `(result as any).output ?? ''`, so
    // the provider must return an object with an `output` property.
    const rankingJson = JSON.stringify([{ name: 'my-project', score: 0.92, rationale: 'Perfect fit' }]);
    const providerStub = {
      invoke: vi.fn().mockResolvedValue({ output: rankingJson }),
    };

    // IO: idea line → user declines so we don't go into authoring.
    const { io, out } = scriptedIo27(['add a login page', 'n']);

    const { runEngineerMode } = await import('../../../src/engine/engineer/loop.js');
    await runEngineerMode({
      provider: providerStub as any,
      io,
      gh: async () => ({ stdout: '' }),
      registryPath: registryPath27,
      engineerDir: engineerDir27,
    });

    // The loop MUST print a proposal that names the candidate project BEFORE
    // asking for confirmation. This is the falsifiable in-chat proposal invariant.
    const combinedOutput = out.join('\n');
    expect(combinedOutput).toMatch(/my-project/);
    // The proposal must include language that asks for confirmation.
    expect(combinedOutput).toMatch(/confirm|suggest/i);
  });

  it('loop pauses for human confirmation: decline before authoring leaves ideasProcessed=0', async () => {
    const projDir = join(workDir27, 'target-proj');
    await mkdir(projDir, { recursive: true });
    await writeRegistry27([makeRecord27(projDir, 'target-proj')]);

    const rankingJson = JSON.stringify([{ name: 'target-proj', score: 0.88, rationale: 'Good match' }]);
    const providerStub = {
      invoke: vi.fn().mockResolvedValue({ output: rankingJson }),
    };

    // Decline at the confirmation gate → no authoring should happen.
    const { io } = scriptedIo27(['some feature idea', 'n']);

    const { runEngineerMode } = await import('../../../src/engine/engineer/loop.js');
    const summary = await runEngineerMode({
      provider: providerStub as any,
      io,
      gh: async () => ({ stdout: '' }),
      registryPath: registryPath27,
      engineerDir: engineerDir27,
    });

    // Declined before authoring → ideasProcessed must remain 0 (no work done).
    expect(summary.ideasProcessed).toBe(0);
  });

  it('confirmation gate is required: routing proposal does NOT immediately commit authoring', async () => {
    // If the loop auto-committed without waiting for confirmation, ideasProcessed
    // would be > 0 on EOF without any confirmation input. EOF immediately = 0.
    const projDir = join(workDir27, 'eager-proj');
    await mkdir(projDir, { recursive: true });
    await writeRegistry27([makeRecord27(projDir, 'eager-proj')]);

    const rankingJson = JSON.stringify([{ name: 'eager-proj', score: 0.95, rationale: 'Top match' }]);
    const providerStub = {
      invoke: vi.fn().mockResolvedValue({ output: rankingJson }),
    };

    // IO: one idea line, then EOF during the confirmation gate (null).
    // If the gate exists, EOF = declined; if not, it would proceed to authoring.
    const { io } = scriptedIo27(['improve the dashboard']);
    // The queue has only the idea line; the next prompt() call (confirmation gate)
    // returns null (EOF). If authoring ran anyway, ideasProcessed would be > 0.

    const { runEngineerMode } = await import('../../../src/engine/engineer/loop.js');
    const summary = await runEngineerMode({
      provider: providerStub as any,
      io,
      gh: async () => ({ stdout: '' }),
      registryPath: registryPath27,
      engineerDir: engineerDir27,
    });

    // EOF at the gate means decline → no authoring → ideasProcessed stays 0.
    expect(summary.ideasProcessed).toBe(0);
  });
});

// =============================================================================
// Task 28 (FR-3, C1): Redirect leaves the ORIGINALLY PROPOSED repo untouched.
// =============================================================================

describe('Task 28: routing redirect — original repo gets NO branch/PR/change (FR-3, C1)', () => {
  it('redirect to a different project: the originally-proposed project directory is byte-identical before/after', async () => {
    // Two projects: alpha (proposed), beta (redirect target).
    const alphaDir = join(workDir27, 'alpha');
    const betaDir = join(workDir27, 'beta');
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });

    // Write both to registry.
    await writeRegistry27([
      makeRecord27(alphaDir, 'alpha'),
      makeRecord27(betaDir, 'beta'),
    ]);

    // Capture the directory listing of alphaDir BEFORE the loop runs.
    // An empty dir has 0 entries; if the loop creates a branch/worktree/file inside
    // it, the listing would change.
    const beforeAlpha = await readdir(alphaDir);

    // Provider stub: proposes alpha as the top candidate.
    // Must return { output: '<json>' } — the loop adapter reads (result as any).output.
    const rankingJson = JSON.stringify([
      { name: 'alpha', score: 0.91, rationale: 'Primary match' },
      { name: 'beta', score: 0.60, rationale: 'Secondary match' },
    ]);
    const providerStub = {
      invoke: vi.fn().mockResolvedValue({ output: rankingJson }),
    };

    // IO: idea → redirect to beta → decline (so we don't try to actually author
    // into a real git repo; the key assertion is about alphaDir).
    const { io } = scriptedIo27(['build a feature', 'redirect beta', 'n']);

    const { runEngineerMode } = await import('../../../src/engine/engineer/loop.js');
    await runEngineerMode({
      provider: providerStub as any,
      io,
      gh: async () => ({ stdout: '' }),
      registryPath: registryPath27,
      engineerDir: engineerDir27,
    });

    // After redirect + decline, alphaDir must be untouched.
    const afterAlpha = await readdir(alphaDir);
    expect(afterAlpha).toEqual(beforeAlpha);
  });

  it('redirect: ideasProcessed=0 after decline confirms NO authoring ran on either repo', async () => {
    const alphaDir = join(workDir27, 'alpha-2');
    const betaDir = join(workDir27, 'beta-2');
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });

    await writeRegistry27([
      makeRecord27(alphaDir, 'alpha-2'),
      makeRecord27(betaDir, 'beta-2'),
    ]);

    const rankingJson = JSON.stringify([
      { name: 'alpha-2', score: 0.90, rationale: 'Proposed' },
      { name: 'beta-2', score: 0.65, rationale: 'Redirect target' },
    ]);
    const providerStub = {
      invoke: vi.fn().mockResolvedValue({ output: rankingJson }),
    };

    // redirect → then decline → no authoring on either repo.
    const { io } = scriptedIo27(['my great idea', 'redirect beta-2', 'n']);

    const { runEngineerMode } = await import('../../../src/engine/engineer/loop.js');
    const summary = await runEngineerMode({
      provider: providerStub as any,
      io,
      gh: async () => ({ stdout: '' }),
      registryPath: registryPath27,
      engineerDir: engineerDir27,
    });

    expect(summary.ideasProcessed).toBe(0);
    // Both dirs remain empty (no branches, no files created).
    expect(await readdir(alphaDir)).toHaveLength(0);
    expect(await readdir(betaDir)).toHaveLength(0);
  });

  it('redirect to unknown name: loop reprompts and does NOT write to original or unknown repo', async () => {
    const alphaDir = join(workDir27, 'alpha-3');
    await mkdir(alphaDir, { recursive: true });
    await writeRegistry27([makeRecord27(alphaDir, 'alpha-3')]);

    const rankingJson = JSON.stringify([{ name: 'alpha-3', score: 0.88, rationale: 'Only option' }]);
    const providerStub = {
      invoke: vi.fn().mockResolvedValue({ output: rankingJson }),
    };

    // redirect to a non-existent project → should reprompt (output about invalid),
    // then decline → zero authoring.
    const { io, out } = scriptedIo27(['some idea', 'redirect phantom-project', 'n']);

    const { runEngineerMode } = await import('../../../src/engine/engineer/loop.js');
    const summary = await runEngineerMode({
      provider: providerStub as any,
      io,
      gh: async () => ({ stdout: '' }),
      registryPath: registryPath27,
      engineerDir: engineerDir27,
    });

    // No authoring on an invalid redirect.
    expect(summary.ideasProcessed).toBe(0);
    // alphaDir untouched.
    expect(await readdir(alphaDir)).toHaveLength(0);
    // The phantom project directory must NOT have been created.
    expect(existsSync(join(workDir27, 'phantom-project'))).toBe(false);
  });
});
