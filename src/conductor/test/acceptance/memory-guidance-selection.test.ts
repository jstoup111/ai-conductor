import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for Slice 1b — guidance-skill selection by the ACTIVE
// provider (FR-4, adr-2026-06-29-per-provider-retrieval-guidance-location):
//
//   - double active (manifest names a `guidance` skill) → the memory step
//     resolves THAT guidance skill.
//   - `local` active → the default `skills/memory/SKILL.md`.
//   - a provider whose guidance is absent/incomplete → SAFE DEGRADE to local
//     guidance semantics + exactly one warning (not silent, not a crash).
//
// Drives the not-yet-existing guidance-selection entry point in
// `skill-resolver.ts` (`resolveMemoryGuidanceSkill`). The function does not
// exist yet → dynamically imported so RED is "not yet implemented".
// ─────────────────────────────────────────────────────────────────────────────

const RESOLVER_MOD = '../../src/engine/skill-resolver.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

// Self-contained providers. `guidance` mirrors the real PluginManifest field —
// the skill ref the harness surfaces for the active provider.
const localProvider = { name: 'local', kind: 'memory_provider' as const };
function doubleWithGuidance(guidance?: string) {
  return { name: 'double', kind: 'memory_provider' as const, guidance };
}

const DEFAULT_MEMORY_SKILL = 'skills/memory/SKILL.md';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'memory-guidance-'));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-4 happy: an active non-default provider's own guidance skill is in effect.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-4: guidance follows the active provider', () => {
  it('double active (declares guidance) → resolves the provider guidance skill, no warning', async () => {
    const resolveMemoryGuidanceSkill = requireFn(
      await load(RESOLVER_MOD),
      'resolveMemoryGuidanceSkill',
    );
    const ctx = { warnings: [] as string[] };
    const provider = doubleWithGuidance('skills/memory-double/SKILL.md');

    const resolved = await resolveMemoryGuidanceSkill({
      provider,
      config: {},
      projectRoot,
      ctx,
    });

    expect(resolved.path).toBe('skills/memory-double/SKILL.md');
    expect(ctx.warnings).toEqual([]);
  });

  it('local active → resolves the default skills/memory/SKILL.md, no warning', async () => {
    const resolveMemoryGuidanceSkill = requireFn(
      await load(RESOLVER_MOD),
      'resolveMemoryGuidanceSkill',
    );
    const ctx = { warnings: [] as string[] };

    const resolved = await resolveMemoryGuidanceSkill({
      provider: localProvider,
      config: {},
      projectRoot,
      ctx,
    });

    expect(resolved.path).toBe(DEFAULT_MEMORY_SKILL);
    expect(ctx.warnings).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-4 negative: missing / incomplete provider guidance → SAFE DEGRADE to local
// guidance semantics + exactly one warning (defined, not silent, not a crash).
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-4: missing/incomplete provider guidance degrades safely', () => {
  it('non-default provider with NO guidance declared → local default + one warning', async () => {
    const resolveMemoryGuidanceSkill = requireFn(
      await load(RESOLVER_MOD),
      'resolveMemoryGuidanceSkill',
    );
    const ctx = { warnings: [] as string[] };
    const provider = doubleWithGuidance(undefined); // non-local, guidance absent

    const resolved = await resolveMemoryGuidanceSkill({
      provider,
      config: {},
      projectRoot,
      ctx,
    });

    // Defined safe behavior: degrade to local semantics, surfaced (not silent).
    expect(resolved.path).toBe(DEFAULT_MEMORY_SKILL);
    expect(ctx.warnings.length).toBe(1);
    expect(ctx.warnings[0]).toMatch(/guidance|degrad|local|double/i);
  });

  it('does not throw on a non-default provider with empty guidance', async () => {
    const resolveMemoryGuidanceSkill = requireFn(
      await load(RESOLVER_MOD),
      'resolveMemoryGuidanceSkill',
    );
    const ctx = { warnings: [] as string[] };
    const provider = doubleWithGuidance(''); // empty/incomplete

    const resolved = await resolveMemoryGuidanceSkill({
      provider,
      config: {},
      projectRoot,
      ctx,
    });

    expect(resolved.path).toBe(DEFAULT_MEMORY_SKILL);
    expect(ctx.warnings.length).toBe(1);
  });
});
