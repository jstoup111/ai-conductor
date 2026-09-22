// Covers: task:8
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as skillResolver from '../../src/engine/skill-resolver.js';

const resolveCustomStepSkill = (skillResolver as {
  resolveCustomStepSkill: (stepKey: string, configuredPath: string, projectRoot: string) => string;
}).resolveCustomStepSkill;

describe('resolveCustomStepSkill', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-step-skill-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns the configured file frontmatter name instead of the step key or directory', () => {
    const configuredPath = '.ai-conductor/skills/a-directory-name/SKILL.md';
    const skillPath = path.join(projectRoot, configuredPath);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, '---\nname: maintain-documentation\n---\n');

    expect(resolveCustomStepSkill('docs-gate', configuredPath, projectRoot)).toBe('maintain-documentation');
  });

  it('returns a typed name-missing failure with the step key and configured path', () => {
    const configuredPath = '.ai-conductor/skills/a-directory-name/SKILL.md';
    const skillPath = path.join(projectRoot, configuredPath);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, '---\ndescription: no name\n---\n');

    expect(resolveCustomStepSkill('docs-gate', configuredPath, projectRoot)).toEqual({
      kind: 'name-missing',
      stepKey: 'docs-gate',
      configuredPath,
    });
  });

  it('returns a typed file-missing failure with the step key and configured path', () => {
    const configuredPath = '.ai-conductor/skills/removed-skill/SKILL.md';

    expect(resolveCustomStepSkill('docs-gate', configuredPath, projectRoot)).toEqual({
      kind: 'file-missing',
      stepKey: 'docs-gate',
      configuredPath,
    });
  });
});
