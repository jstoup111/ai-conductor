// Covers: task:3, task:12, task:17, task:rem-prd-audit-R1-5, task:rem-prd-audit-R1-6, task:rem-prd-audit-R2, task:rem-prd-audit-R2-2, task:rem-prd-audit-R2-3, task:rem-prd-audit-R3, task:rem-as-built-R4, task:rem-as-built-rem-validation-AB2
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import { runPlanReview } from '../../src/engine/plan-review-runner.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';

const roots: string[] = [];
const execFile = promisify(execFileCb);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(includeUncitedAdr = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plan-review-runner-')); roots.push(root);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
  await writeFile(join(root, '.docs/plans/idea.md'), `# Plan\n\nThis plan follows adr-review.\n\n### Task 1: Configure\n**Steps:**\n1. Add \`reviewFlag\`.\n\n**Done when:**\n- [test] the flag works.\n\n**Dependencies:** none\n`, 'utf8');
  await writeFile(join(root, '.docs/stories/idea.md'), '# Stories\n\n## Story 1: Review\nThe flag is reviewed.\n', 'utf8');
  await writeFile(join(root, '.docs/decisions/adr-review.md'), '# ADR review\n\nThis introduction is not a decision.\n\n## Decision\n\nD1. The flag is allowed.\n', 'utf8');
  if (includeUncitedAdr) await writeFile(join(root, '.docs/decisions/adr-uncited.md'), '# Unrelated ADR\n\n## Decision\n\nD1. Original decision.\n', 'utf8');
  await writeFile(join(root, 'source.ts'), 'export const reviewFlag = true;\n', 'utf8');
  await execFile('git', ['init', '-b', 'main'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: root });
  await execFile('git', ['add', '.'], { cwd: root });
  await execFile('git', ['commit', '-m', 'baseline'], { cwd: root });
  return root;
}

describe('runPlanReview', () => {
  it('forwards its candidate-start callback into the provider executor', async () => {
    const root = await fixture(); const calls: any[] = [];
    const onCandidateStart = vi.fn();
    await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any, onCandidateStart,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    expect(calls[0].onCandidateStart).toBe(onCandidateStart);
  });

  it('dispatches one fresh, read-only, schema-constrained reviewer and writes only its validated findings', async () => {
    const root = await fixture(); const calls: any[] = []; const events: any[] = [];
    const artifact = await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: ['claude', 'pi'], steps: { plan_review: { llm_provider: 'pi' } } } as any,
      configuredProviders: ['claude', 'pi'], env: { AI_CONDUCTOR_AUTHORING_PROVIDER: 'claude' }, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
      emit: async (event) => { events.push(event); },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ step: 'plan_review', configuredProviders: ['pi'], nativeSchemaScratch: { worktreeRoot: root, repository: root, featureSlug: 'idea' }, options: { cwd: root, interactive: false, readOnlyReview: true } });
    expect(calls[0].options.nativeSchema).toBeDefined();
    expect(calls[0].options.prompt).toContain('### Task 1: Configure');
    expect(calls[0].options.prompt).toContain('## Story 1: Review');
    expect(calls[0].options.prompt).toContain('D1. The flag is allowed.');
    expect(calls[0].options.prompt).not.toContain('This introduction is not a decision.');
    expect(artifact).toMatchObject({ round: 1, reviewerProvider: 'pi', independence: 'cross-provider', findings: [] });
    expect(events.map((event) => event.type)).toEqual(['plan_review_dispatched', 'plan_review_completed']);
    expect([...new Set(events.map((event) => event.reviewerProvider))]).toEqual(['pi']);
    expect(parsePlanReviewArtifact(await readFile(join(root, '.docs/plan-review/idea.md'), 'utf8'))).toMatchObject({ findings: [] });
  });

  // Covers: task:rem-as-built-rem-validation-AB4
  it('loads cited and changed ADR Decision sections while excluding unchanged unrelated ADRs and review files from the prompt', async () => {
    const root = await fixture(true);
    const uncitedAdr = join(root, '.docs/decisions/adr-uncited.md');
    await writeFile(uncitedAdr, '## Decision\n\nD1. This changed uncited ADR must reach the prompt.\n', 'utf8');
    await writeFile(join(root, '.docs/decisions/architecture-review-unrelated.md'), '## Decision\n\nD1. This unrelated review must not reach the prompt.\n', 'utf8');
    // An unrelated directory with an `.md` suffix proves the runner does not
    // attempt to read every decision-directory entry before narrowing scope.
    await mkdir(join(root, '.docs/decisions/adr-not-a-cited-document.md'));

    const calls: any[] = [];
    const artifact = await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    expect(artifact.reviewedDigest.adrDecisionDigests).toHaveProperty('adr-uncited#D1');
    expect(calls[0].options.prompt).toContain('D1. The flag is allowed.');
    expect(calls[0].options.prompt).toContain('This changed uncited ADR must reach the prompt.');
    expect(calls[0].options.prompt).not.toContain('This unrelated review must not reach the prompt.');
  });

  // Covers: task:rem-as-built-R6
  it('supplies a changed numbered-Markdown ADR decision to the round-two reviewer', async () => {
    const root = await fixture();
    const prompts: string[] = [];
    const input = {
      worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => {
        prompts.push(request.options.prompt);
        return { success: true, finalStructuredResult: { findings: [] } };
      }) as any,
    };

    await runPlanReview(input);
    await writeFile(join(root, '.docs/decisions/adr-review.md'), '# ADR review\n\n## Decision\n\n1. The numbered replacement is allowed.\n', 'utf8');
    await runPlanReview(input);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('1. The numbered replacement is allowed.');
    expect(prompts[1]).not.toContain('D1. The flag is allowed.');
  });

  it('falls through a failed candidate while preserving round one and recording same-provider independence', async () => {
    const root = await fixture(); const calls: any[] = []; const notices: string[] = [];
    const artifact = await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: ['codex', 'claude'] } as any, configuredProviders: ['codex', 'claude'], env: { AI_CONDUCTOR_AUTHORING_PROVIDER: 'claude' }, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return calls.length === 1 ? { success: false } : { success: true, finalStructuredResult: { findings: [] } }; }) as any,
      onNotice: (notice) => notices.push(notice),
    });
    expect(calls.map((call) => call.configuredProviders[0])).toEqual(['codex', 'claude']);
    expect(artifact).toMatchObject({ round: 1, reviewerProvider: 'claude', independence: 'same-provider' });
    expect(notices).toEqual(['plan review independence: same-provider (claude authoring host, claude reviewer)']);
  });

  it('emits one unknown-host independence notice after writing the review artifact', async () => {
    const root = await fixture(); const notices: string[] = [];
    const artifact = await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: ['claude'] } as any,
      configuredProviders: ['claude'], runtimes: {} as any, sessions: {} as any, env: {},
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [] } })) as any,
      onNotice: (notice) => notices.push(notice),
    });

    expect(artifact).toMatchObject({ reviewerProvider: 'claude', independence: 'unknown-host' });
    await expect(readFile(join(root, '.docs/plan-review/idea.md'), 'utf8')).resolves.toContain('unknown-host');
    expect(notices).toEqual(['plan review independence: unknown-host (unknown authoring host, claude reviewer)']);
  });

  it('falls through a schema-invalid response to a fresh second-provider session', async () => {
    const root = await fixture(); const events: any[] = []; const invocations: any[] = [];
    const codex = { invoke: vi.fn(async (options) => {
      invocations.push({ provider: 'codex', ...options });
      return { success: true, finalStructuredResult: { nope: [] } };
    }) };
    const claude = { invoke: vi.fn(async (options) => {
      invocations.push({ provider: 'claude', ...options });
      return { success: true, finalStructuredResult: { findings: [] } };
    }) };
    const runtimes = new ProviderRuntimeSet([
      { key: 'codex', provider: codex as any, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder), nativeSchemaCapability: { nativeOutputSchema: true } },
      { key: 'claude', provider: claude as any, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder), nativeSchemaCapability: { nativeOutputSchema: true } },
    ]);
    const artifact = await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: ['codex', 'claude'] } as any,
      runtimes, sessions: new ProviderSessionStore(),
      emit: async (event) => { events.push(event); },
    });
    expect(invocations.map(({ provider }) => provider)).toEqual(['codex', 'claude']);
    expect(invocations.map(({ resume }) => resume)).toEqual([false, false]);
    expect(invocations[1].sessionId).not.toBe(invocations[0].sessionId);
    expect(events.filter((event) => event.type === 'plan_review_dispatched').map((event) => event.reviewerProvider)).toEqual(['codex', 'claude']);
    expect(artifact.reviewerProvider).toBe('claude');
  });

  // Covers: task:rem-prd-audit-R2-3
  it('falls through a malformed findings envelope to a fresh second-provider session', async () => {
    const root = await fixture(); const invocations: any[] = [];
    const codex = { invoke: vi.fn(async (options) => {
      invocations.push({ provider: 'codex', ...options });
      return { success: true, finalStructuredResult: { findings: 'not-an-array' } };
    }) };
    const claude = { invoke: vi.fn(async (options) => {
      invocations.push({ provider: 'claude', ...options });
      return { success: true, finalStructuredResult: { findings: [] } };
    }) };
    const runtimes = new ProviderRuntimeSet([
      { key: 'codex', provider: codex as any, policy: CODEX_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder), nativeSchemaCapability: { nativeOutputSchema: true } },
      { key: 'claude', provider: claude as any, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder), nativeSchemaCapability: { nativeOutputSchema: true } },
    ]);

    const artifact = await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: ['codex', 'claude'] } as any,
      runtimes, sessions: new ProviderSessionStore(),
    });

    expect(invocations.map(({ provider }) => provider)).toEqual(['codex', 'claude']);
    expect(invocations.map(({ resume }) => resume)).toEqual([false, false]);
    expect(invocations[1].sessionId).not.toBe(invocations[0].sessionId);
    expect(artifact.reviewerProvider).toBe('claude');
  });

  it('falls through a response containing a schema-invalid finding in a fresh provider session', async () => {
    const root = await fixture(); const calls: any[] = [];
    const artifact = await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: ['codex', 'claude'] } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return calls.length === 1
        ? { success: true, finalStructuredResult: { findings: [{}] } }
        : { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    expect(calls.map((call) => call.configuredProviders[0])).toEqual(['codex', 'claude']);
    expect(artifact.reviewerProvider).toBe('claude');
  });

  it('drops insufficient evidence and writes findings grounded in source or permitted .docs artifacts', async () => {
    const root = await fixture();
    const artifact = await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [
        { id: 'bad', severity: 'blocking', lens: 'reachability', artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: null, resolvesPrior: null, summary: 'missing evidence', evidence: ['no location'] },
        { id: 'good', severity: 'significant', lens: 'feasibility', artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: null, resolvesPrior: null, summary: 'grounded', evidence: ['source.ts:1'] },
        { id: 'story-grounded', severity: 'significant', lens: 'reachability', artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: null, resolvesPrior: null, summary: 'grounded in the story artifact', evidence: ['.docs/stories/idea.md:3'] },
        { id: 'adr-grounded', severity: 'significant', lens: 'dependency-order', artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: 'task 2', resolvesPrior: null, summary: 'grounded in the cited ADR artifact', evidence: ['.docs/decisions/adr-review.md:1', 'Dependency closure for task 1: none; task 2 is not reachable.'] },
      ] } })) as any,
    });
    expect(artifact.findings.map((finding) => finding.id)).toEqual(['good', 'story-grounded', 'adr-grounded']);
    expect(parsePlanReviewArtifact(await readFile(join(root, '.docs/plan-review/idea.md'), 'utf8'))).toMatchObject({ findings: [{ id: 'good' }, { id: 'story-grounded' }, { id: 'adr-grounded' }] });
  });

  // Covers: task:rem-prd-audit-R1-5
  it('writes a task-versus-task contradiction grounded by two plan Done-when passages', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs/plans/idea.md'), `# Plan

### Task 1: Enable the legacy path

**Done when:**
- The legacy path remains enabled.

**Dependencies:** none

### Task 2: Remove the legacy path

**Done when:**
- The legacy path is removed.

**Dependencies:** task 1
`, 'utf8');

    const finding = {
      id: 'task-pair-contradiction', severity: 'blocking', lens: 'contradiction',
      artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: 'task 2', resolvesPrior: null,
      summary: 'The two task completion conditions cannot both hold.',
      evidence: [
        '.docs/plans/idea.md:6',
        '.docs/plans/idea.md:11',
        'Task 1 requires "The legacy path remains enabled."',
        'Task 2 requires "The legacy path is removed."',
      ],
    };
    const artifact = await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async () => ({ success: true, finalStructuredResult: { findings: [finding] } })) as any,
    });

    expect(artifact.findings).toEqual([finding]);
    expect(parsePlanReviewArtifact(await readFile(join(root, '.docs/plan-review/idea.md'), 'utf8'))).toMatchObject({
      findings: [{ id: 'task-pair-contradiction', reference: 'task 1', relatedReference: 'task 2' }],
    });
  });

  it('feeds the feature architecture review Wiring Surface into reachability candidates', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs/plans/idea.md'), `# Plan

### Task 1: Introduce \`unwiredSurface\`
**Steps:**
1. Add the surface.

**Done when:**
- [test] the surface is covered.

**Dependencies:** none
`, 'utf8');
    await writeFile(join(root, '.docs/decisions/architecture-review-2026-10-13-idea.md'), `# Architecture review

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| \`unwiredSurface\` | \`runSurface\` |
`, 'utf8');

    await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    expect(calls[0].options.prompt).toContain('"lens":"reachability"');
    expect(calls[0].options.prompt).toContain('"identifier":"unwiredSurface"');
    expect(calls[0].options.prompt).toContain('"taskId":"1"');
  });
});

describe('runPlanReview prompt bounds', () => {
  it('sends reachability candidates with a searched-path count instead of the full path list', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs/plans/idea.md'), `# Plan

### Task 1: Add surface
**Files likely touched:**
- \`surface.ts\`

**Steps:**
1. Add \`unwiredSurface\`.

**Done when:**
- [test] the surface is covered.

**Dependencies:** none
`, 'utf8');
    await writeFile(join(root, 'other.ts'), 'export const other = 1;\n', 'utf8');

    await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    expect(calls[0].options.prompt).toContain('"identifier":"unwiredSurface"');
    expect(calls[0].options.prompt).toMatch(/"searchedPathCount":[1-9]/);
    expect(calls[0].options.prompt).not.toContain('"searchedPaths"');
  });

  it('refuses before dispatch, naming the sizes, when the review prompt exceeds its budget', async () => {
    const root = await fixture(); const calls: any[] = [];
    await expect(runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      maxPromptChars: 10,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    })).rejects.toThrow(/plan review prompt is too large: \d+ characters exceeds 10 \(plan \d+, stories \d+, ADR decisions \d+, coherence \d+, candidates \d+\)/);
    expect(calls).toHaveLength(0);
  });
});
