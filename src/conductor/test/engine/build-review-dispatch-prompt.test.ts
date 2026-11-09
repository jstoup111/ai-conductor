// Covers: task:5
import { describe, expect, it } from 'vitest';
import { captureRubricPrompt } from './build-review-prompt-capture.js';

describe('build_review testQuality evidence re-read prompt', () => {
  it('instructs the provider to verify pinned evidence and leave unreadable evidence indeterminate', async () => {
    const prompt = await captureRubricPrompt('testQuality', 'build-review-prompt');
    const evidenceInstruction = prompt.split('\n\n').find((paragraph) =>
      paragraph.includes('git show <mergeBase>:<path>')
      && paragraph.includes('git show <headSha>:<path>')
      && paragraph.includes('startLine')
      && paragraph.includes('endLine')
      && paragraph.includes('contentHash')
      && paragraph.includes('unreadable')
      && paragraph.includes('not judged')
      && paragraph.includes('indeterminate')
      && paragraph.includes('missingEvidenceReason'),
    );

    expect(evidenceInstruction).toBeDefined();
  });

  it('leaves contentHash to the engine and never treats character offsets as bytes', async () => {
    // The engine hashes each region from its immutable commit. A read-only
    // review session has no hashing tool, so asking it to recompute the hash
    // turned every inspected candidate indeterminate. Character offsets still
    // diverge from byteRegion on non-ASCII files (#2612).
    const prompt = await captureRubricPrompt('testQuality', 'build-review-prompt');

    expect(prompt).toMatch(/do not recompute .?contentHash/i);
    expect(prompt).not.toMatch(/verify `contentHash` as sha256/);
    expect(prompt).not.toMatch(/hash-mismatched/);
    expect(prompt).toMatch(/must not be used as byte offsets/);
    expect(prompt).not.toMatch(/whitespace-normalized title/);
  });

  it('contains no provider-specific paths, environment variables, or model names', async () => {
    const prompt = await captureRubricPrompt('testQuality', 'build-review-prompt');

    expect(prompt).not.toMatch(/~\/.claude|CLAUDE_|CODEX_|claude-|gpt-|\b(?:opus|sonnet)\b/i);
  });
});
