import { describe, it, expect } from 'vitest';
import { buildAttributionPrompt } from '../../src/engine/attribution-prompt.js';

// ── Attribution verifier prompt assembly ─────────────────────────────────
//
// The prompt is the ONLY instruction set the input-starved verifier session
// sees. It must carry the exact verdict schema (schema 1), the whitewash guard
// (satisfied requires citations + passing tests), instructions to run scoped
// tests and record command+exit, permission for split attribution across
// satisfied tasks, and the strict file-write constraint (.pipeline/attribution-verdict.json only).
// It must NEVER leak conductor state — input isolation is the point.

describe('buildAttributionPrompt', () => {
  const inputs = {
    prompt: `## Residue Tasks for Attribution Verification

### Task 7
Implement the sweep feature.

**Files:** src/sweep.ts

## Candidate Commits

### Commit abc123def456
**Subject:** Add sweep wiring to CLI
**Diff:**
\`\`\`
diff --git a/src/sweep.ts b/src/sweep.ts
+export function sweep() { }
\`\`\`
`,
  };

  it('embeds the verdict JSON schema with schema version 1', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toContain('schema: 1');
    expect(prompt).toContain('.pipeline/attribution-verdict.json');
  });

  it('includes the exact JSON schema structure for the verdict file', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toContain('schema');
    expect(prompt).toContain('results');
    expect(prompt).toContain('taskId');
    expect(prompt).toContain('verdict');
    expect(prompt).toContain('citations');
    expect(prompt).toContain('testEvidence');
  });

  it('includes the whitewash guard warning about satisfied verdicts', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toContain('satisfied');
    expect(prompt).toContain('must provide');
    expect(prompt).toContain('citations');
    expect(prompt).toContain('passing test');
    expect(prompt).toContain('exit: 0');
  });

  it('instructs running scoped tests for each task', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toMatch(/run.*scoped.*test/i);
    expect(prompt).toMatch(/test.*command/i);
  });

  it('instructs recording command and exit code from test runs', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toMatch(/command/i);
    expect(prompt).toMatch(/exit.*code/i);
  });

  it('instructs that split attribution is allowed across satisfied tasks', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toMatch(/split.*attribution/i);
    expect(prompt).toMatch(/multiple.*task/i);
  });

  it('forbids writing anything except .pipeline/attribution-verdict.json', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toMatch(/only.*\.pipeline\/attribution-verdict\.json/i);
    expect(prompt).toMatch(/no.*other.*file/i);
  });

  it('includes the residue tasks and candidate commits from inputs', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).toContain('Residue Tasks for Attribution Verification');
    expect(prompt).toContain('Candidate Commits');
    expect(prompt).toContain('abc123def456');
    expect(prompt).toContain('Add sweep wiring to CLI');
  });

  it('never references conductor state or maker session internals', () => {
    const prompt = buildAttributionPrompt(inputs);

    expect(prompt).not.toMatch(/task-status/i);
    expect(prompt).not.toMatch(/maker summary/i);
    expect(prompt).not.toMatch(/maker session/i);
    expect(prompt).not.toMatch(/transcript/i);
  });
});
