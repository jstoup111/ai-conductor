// Covers: task:3, task:4, task:5, task:6, task:9, task:12, task:17, task:rem-prd-audit-R1-5, task:rem-prd-audit-R1-6, task:rem-prd-audit-R2, task:rem-prd-audit-R2-2, task:rem-prd-audit-R2-3, task:rem-prd-audit-R3, task:rem-as-built-R4, task:rem-as-built-rem-validation-AB2
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeReviewedDigest, parsePlanReviewArtifact } from '../../src/engine/plan-review-artifact.js';
import { PLAN_REVIEW_INDEX_INSTRUCTION, runPlanReview } from '../../src/engine/plan-review-runner.js';
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
  it('indexes cited unchanged ADR decisions while inlining changed ADR decisions and excluding unrelated review files', async () => {
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
    expect(calls[0].options.prompt).toContain('- adr-review#D1 | D1. The flag is allowed. | .docs/decisions/adr-review.md');
    expect(calls[0].options.prompt).not.toContain('ADR DECISIONS (changed in this spec):\n{"adr-review#D1":"D1. The flag is allowed."}');
    expect(calls[0].options.prompt).toContain('This changed uncited ADR must reach the prompt.');
    expect(calls[0].options.prompt).not.toContain('This unrelated review must not reach the prompt.');
  });

  it('assembles round one from changed decision passages and an index of stable decisions', async () => {
    const root = await fixture();
    await mkdir(join(root, '.docs', 'coherence'), { recursive: true });
    await writeFile(join(root, '.docs', 'coherence', 'idea.md'), '# Coherence\n\nThis body is indexed, not inlined.\n', 'utf8');
    await writeFile(join(root, '.docs', 'decisions', 'adr-review.md'), `# ADR review

## Decision

D1. Stable first decision.

D2. Stable second decision.
`, 'utf8');
    await writeFile(join(root, '.docs', 'decisions', 'adr-b.md'), `# ADR B

## Decision

D1. Stable B decision.

D2. Original B decision.
`, 'utf8');
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), `# Plan

This plan follows adr-review and adr-b.

### Task 1: Configure
**Steps:**
1. Add \`reviewFlag\`.

**Done when:**
- [test] the flag works.

**Dependencies:** none
`, 'utf8');
    await execFile('git', ['add', '.'], { cwd: root });
    await execFile('git', ['commit', '-m', 'add decisions'], { cwd: root });
    await writeFile(join(root, '.docs', 'decisions', 'adr-b.md'), `# ADR B

## Decision

D1. Stable B decision.

D2. Amended B decision.
`, 'utf8');

    const calls: any[] = [];
    const artifact = await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    const prompt = calls[0].options.prompt;
    expect(prompt).toContain('### Task 1: Configure');
    expect(prompt).toContain('## Story 1: Review');
    expect(prompt).toContain('D2. Amended B decision.');
    expect(prompt).toContain('- adr-review#D1 | D1. Stable first decision. | .docs/decisions/adr-review.md');
    expect(prompt).toContain('- adr-review#D2 | D2. Stable second decision. | .docs/decisions/adr-review.md');
    expect(prompt).toContain('- adr-b#D1 | D1. Stable B decision. | .docs/decisions/adr-b.md');
    expect(prompt).toContain('- coherence | .docs/coherence/idea.md');
    expect(prompt).not.toContain('This body is indexed, not inlined.');
    expect(artifact.reviewedDigest).toEqual(computeReviewedDigest({
      planText: await readFile(join(root, '.docs', 'plans', 'idea.md'), 'utf8'),
      storiesText: await readFile(join(root, '.docs', 'stories', 'idea.md'), 'utf8'),
      adrTexts: {
        'adr-b': await readFile(join(root, '.docs', 'decisions', 'adr-b.md'), 'utf8'),
        'adr-review': await readFile(join(root, '.docs', 'decisions', 'adr-review.md'), 'utf8'),
      },
      artifactTexts: { '.docs/coherence/idea.md': await readFile(join(root, '.docs', 'coherence', 'idea.md'), 'utf8') },
      changedPaths: ['.docs/decisions/adr-b.md'],
    }));
  });

  it('tells the reviewer that indexed material must be read from its worktree path', async () => {
    const root = await fixture(); const calls: any[] = [];
    await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    expect(calls[0].options.prompt).toContain(PLAN_REVIEW_INDEX_INSTRUCTION);
    expect(PLAN_REVIEW_INDEX_INSTRUCTION).toContain('not inlined');
    expect(PLAN_REVIEW_INDEX_INSTRUCTION).toContain('read each item from its listed worktree path');
    expect(PLAN_REVIEW_INDEX_INSTRUCTION).toContain('open it before a finding quotes or relies on it');
  });

  it('inlines every decision from an ADR added after the merge base', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'decisions', 'adr-new.md'), `# New ADR

## Decision

D1. First new decision.

D2. Second new decision.
`, 'utf8');
    const calls: any[] = [];
    await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    expect(calls[0].options.prompt).toContain('D1. First new decision.');
    expect(calls[0].options.prompt).toContain('D2. Second new decision.');
  });

  it('keeps every cited decision inline when no canonical path supplies a change set', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs', 'decisions', 'adr-extra.md'), '## Decision\n\nD1. Extra cited decision.\n', 'utf8');
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), '# Plan\n\nThis plan follows adr-review and adr-extra.\n', 'utf8');

    await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    const prompt = calls[0].options.prompt;
    expect(prompt).toContain('D1. The flag is allowed.');
    expect(prompt).toContain('D1. Extra cited decision.');
    expect(prompt).not.toContain('- adr-review#');
    expect(prompt).not.toContain('- adr-extra#');
  });

  it('rejects before review dispatch when its canonical path cannot resolve a merge base', async () => {
    const root = await fixture(); const calls: any[] = [];
    const canonical = await mkdtemp(join(tmpdir(), 'plan-review-unrelated-')); roots.push(canonical);
    await execFile('git', ['init', '-b', 'missing-base'], { cwd: canonical });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: canonical });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: canonical });
    await writeFile(join(canonical, 'README.md'), 'unrelated\n', 'utf8');
    await execFile('git', ['add', '.'], { cwd: canonical });
    await execFile('git', ['commit', '-m', 'unrelated base'], { cwd: canonical });

    await expect(runPlanReview({
      worktreePath: root, canonicalPath: canonical, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('keeps every decision inline when merge-base text is unavailable after resolving the change set', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs', 'decisions', 'adr-extra.md'), '## Decision\n\nD1. Extra changed decision.\n', 'utf8');
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), '# Plan\n\nThis plan follows adr-review and adr-extra.\n', 'utf8');

    await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      readMergeBaseTexts: async () => undefined,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    const prompt = calls[0].options.prompt;
    expect(prompt).toContain('D1. The flag is allowed.');
    expect(prompt).toContain('D1. Extra changed decision.');
    expect(prompt).not.toContain('- adr-review#');
    expect(prompt).not.toContain('- adr-extra#');
  });

  it('inlines every decision from an unreadable changed ADR while indexing stable decisions from another changed ADR', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs', 'decisions', 'adr-unreadable.md'), '## Decision\n\nD1. Original unreadable decision.\n\nD2. Another unreadable decision.\n', 'utf8');
    await writeFile(join(root, '.docs', 'decisions', 'adr-split.md'), '## Decision\n\nD1. Stable split decision.\n\nD2. Original split decision.\n', 'utf8');
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), '# Plan\n\nThis plan follows adr-unreadable and adr-split.\n', 'utf8');
    await execFile('git', ['add', '.'], { cwd: root });
    await execFile('git', ['commit', '-m', 'add fallback ADRs'], { cwd: root });
    await writeFile(join(root, '.docs', 'decisions', 'adr-unreadable.md'), '## Decision\n\nD1. Changed unreadable decision.\n\nD2. Another unreadable decision.\n', 'utf8');
    await writeFile(join(root, '.docs', 'decisions', 'adr-split.md'), '## Decision\n\nD1. Stable split decision.\n\nD2. Changed split decision.\n', 'utf8');

    await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      readMergeBaseTexts: async () => ({
        '.docs/decisions/adr-unreadable.md': null,
        '.docs/decisions/adr-split.md': '## Decision\n\nD1. Stable split decision.\n\nD2. Original split decision.\n',
      }),
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    const prompt = calls[0].options.prompt;
    expect(prompt).toContain('D1. Changed unreadable decision.');
    expect(prompt).toContain('D2. Another unreadable decision.');
    expect(prompt).toContain('D2. Changed split decision.');
    expect(prompt).toContain('- adr-split#D1 | D1. Stable split decision. | .docs/decisions/adr-split.md');
  });

  it('omits ADRs without decisions and coherence when no coherence artifact exists', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs', 'decisions', 'adr-empty.md'), '# ADR empty\n\nNo decision heading here.\n', 'utf8');
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), '# Plan\n\nThis plan follows adr-review and adr-empty.\n', 'utf8');

    await runPlanReview({
      worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].options.prompt).not.toContain('adr-empty#');
    expect(calls[0].options.prompt).not.toContain('- coherence |');
  });

  it('treats trailing whitespace as changed but normalized CRLF line endings as stable', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs', 'decisions', 'adr-whitespace.md'), '## Decision\n\nD1. Whitespace-sensitive decision.\n', 'utf8');
    await writeFile(join(root, '.docs', 'decisions', 'adr-line-endings.md'), '## Decision\n\nD1. Line ending-stable decision.\n', 'utf8');
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), '# Plan\n\nThis plan follows adr-whitespace and adr-line-endings.\n', 'utf8');
    await execFile('git', ['add', '.'], { cwd: root });
    await execFile('git', ['commit', '-m', 'add formatting ADRs'], { cwd: root });
    await writeFile(join(root, '.docs', 'decisions', 'adr-whitespace.md'), '## Decision\n\nD1. Whitespace-sensitive decision.  \n', 'utf8');
    await writeFile(join(root, '.docs', 'decisions', 'adr-line-endings.md'), '## Decision\r\n\r\nD1. Line ending-stable decision.\r\n', 'utf8');

    await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });

    const prompt = calls[0].options.prompt;
    expect(prompt).toContain('D1. Whitespace-sensitive decision.  ');
    expect(prompt).toContain('- adr-line-endings#D1 | D1. Line ending-stable decision. | .docs/decisions/adr-line-endings.md');
  });

  it('dispatches the reviewer for a generated #2945-shaped fixture with a prompt under 400,000 characters', async () => {
    const root = await fixture();
    const plan = `# Plan\n\n${'p'.repeat(125_627)}\n`;
    const stories = `# Stories\n\n${'s'.repeat(33_172)}\n`;
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), plan, 'utf8');
    await writeFile(join(root, '.docs', 'stories', 'idea.md'), stories, 'utf8');
    await mkdir(join(root, '.docs', 'coherence'), { recursive: true });
    await writeFile(join(root, '.docs', 'coherence', 'idea.md'), `# Coherence\n\n${'c'.repeat(50_769)}\n`, 'utf8');
    for (let index = 1; index <= 15; index += 1) {
      await writeFile(join(root, '.docs', 'decisions', `adr-${index}.md`), `# ADR ${index}\n\n## Decision\n\nD1. ${'d'.repeat(9_360)}\n`, 'utf8');
    }
    await execFile('git', ['add', '.'], { cwd: root });
    await execFile('git', ['commit', '-m', 'large review baseline'], { cwd: root });
    for (let index = 1; index <= 6; index += 1) {
      await writeFile(join(root, '.docs', 'decisions', `adr-${index}.md`), `# ADR ${index}\n\n## Decision\n\nD1. ${'x'.repeat(9_360)}\n`, 'utf8');
    }
    const calls: any[] = [];
    await runPlanReview({
      worktreePath: root, canonicalPath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => { calls.push(request); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].options.prompt.length).toBeLessThan(400_000);
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

  it('keeps the round-two prompt byte-identical to the pre-index layout with coherence and prior blocking findings', async () => {
    const root = await fixture();
    await mkdir(join(root, '.docs', 'coherence'), { recursive: true });
    const coherence = '# Coherence\n\nThe full coherence body remains in round two.\n';
    await writeFile(join(root, '.docs', 'coherence', 'idea.md'), coherence, 'utf8');
    const prompts: string[] = [];
    const finding = {
      id: 'prior-blocker', severity: 'blocking', lens: 'reachability',
      artifact: '.docs/plans/idea.md', reference: 'task 1', relatedReference: null, resolvesPrior: null,
      summary: 'The first round found a blocker.', evidence: ['source.ts:1'],
    };
    const input = {
      worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any,
      runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (request: any) => {
        prompts.push(request.options.prompt);
        return { success: true, finalStructuredResult: { findings: prompts.length === 1 ? [finding] : [] } };
      }) as any,
    };

    await runPlanReview(input);
    const changedPlan = `# Plan

This plan follows adr-review.

### Task 1: Configure the revised flag
**Steps:**
1. Add \`reviewFlag\`.

**Done when:**
- [test] the revised flag works.

**Dependencies:** none
`;
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), changedPlan, 'utf8');
    await runPlanReview(input);

    const selectedTask = changedPlan.slice(changedPlan.indexOf('### Task 1:'));
    expect(prompts[1]).toBe(`$plan-review

PLAN:
${selectedTask}

STORIES:


ADR DECISIONS:
{}

COHERENCE:
${coherence}

CANDIDATES:
[]

PRIOR BLOCKING AND SIGNIFICANT FINDINGS:
${JSON.stringify([finding])}`);
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

  it('refuses before dispatch with every present section, both overrides, and no side effects', async () => {
    const root = await fixture(); const calls: any[] = []; const events: any[] = [];
    await expect(runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      maxPromptChars: 10,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
      emit: async (event) => { events.push(event); },
    })).rejects.toThrow(/plan review prompt is too large: \d+ characters exceeds 10 \(plan \d+, stories \d+, ADR decisions \d+, index \d+, candidates \d+\)\. Largest section: \w+(?: \w+)?\. To proceed, rerun with --max-prompt-chars \d+, or set plan_review\.max_prompt_chars: \d+ in \.ai-conductor\/config\.yml, or shrink the .+ section\./);
    expect(calls).toHaveLength(0);
    expect(events).toEqual([]);
    await expect(readFile(join(root, '.docs/plan-review/idea.md'), 'utf8')).rejects.toThrow();
  });

  it('uses the 400000-character default budget when no override is supplied', async () => {
    const root = await fixture(); const calls: any[] = [];
    await writeFile(join(root, '.docs', 'plans', 'idea.md'), `# Plan\n\n${'x'.repeat(400_001)}`, 'utf8');
    await expect(runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    })).rejects.toThrow('exceeds 400000');
    expect(calls).toEqual([]);
  });

  it('allows a prompt exactly equal to its override budget', async () => {
    const root = await fixture(); const calls: any[] = [];
    let promptLength = 0;
    await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      maxPromptChars: Number.MAX_SAFE_INTEGER,
      providerExecutor: (async (input: any) => { promptLength = input.options.prompt.length; calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    await rm(join(root, '.docs', 'plan-review'), { recursive: true, force: true });
    await runPlanReview({ worktreePath: root, planStem: 'idea', config: { llm_provider: 'codex' } as any, runtimes: {} as any, sessions: {} as any,
      maxPromptChars: promptLength,
      providerExecutor: (async (input: any) => { calls.push(input); return { success: true, finalStructuredResult: { findings: [] } }; }) as any,
    });
    expect(calls).toHaveLength(2);
  });
});
