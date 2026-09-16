import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const skillPath = join(root, 'skills', 'bootstrap', 'SKILL.md');

async function configSection(): Promise<string> {
  const skill = await readFile(skillPath, 'utf8');
  return skill.slice(skill.indexOf('### 1b-i. Initialize Project Config'), skill.indexOf('### 1c.'));
}

describe('bootstrap project-configuration interview', () => {
  it('asks every decidable project setting with guidance and its writer flag', async () => {
    const section = await configSection();
    for (const [key, flag] of [
      ['test_suite.verification.mode', '--test-suite-mode'],
      ['test_suite.verification.drift_budget', '--test-suite-drift-budget'],
      ['test_suite.command', '--test-suite-command'],
    ]) {
      const question = section.slice(section.indexOf(key), section.indexOf('\n\n', section.indexOf(key)));
      expect(question).toContain(flag);
      for (const marker of ['Controls:', 'Allowed:', 'Default:', 'Changing it:']) expect(question).toContain(marker);
    }
    expect(section).toMatch(/closed-set.*restate.*re-ask.*record nothing/is);
    expect(section).toMatch(/free-text empty or multi-line.*re-ask.*record nothing/is);
  });

  it('infers a test-command default from common project tooling and re-asks an uninferred empty answer', async () => {
    const section = await configSection();
    for (const item of ['package.json', 'pyproject.toml', 'pytest.ini', 'Gemfile', 'Rakefile', 'go.mod', 'Cargo.toml']) expect(section).toContain(item);
    expect(section).toMatch(/no command can be inferred.*answer is empty.*re-ask/is);
  });

  it('records, reports, and safely skips machine identity as required', async () => {
    const skill = await readFile(skillPath, 'utf8');
    const identity = skill.slice(skill.indexOf('### 1b-ii. Operator Identity'), skill.indexOf('### 1c.'));
    for (const text of ['ai-conductor config read spec_owner', 'gh api user -q .login', 'ai-conductor config set spec_owner <login>', 'already set: spec_owner', 'Operator\nidentity unresolved', 'engineer land', 'spec handoff', 'daemon builds']) expect(identity).toContain(text);
    expect(identity).toMatch(/auto mode.*skip.*no `config set`/is);
    expect(identity).toMatch(/setup incomplete/is);
  });

  it('reports established project settings without re-asking and still invokes the no-clobber writer', async () => {
    const section = await configSection();
    expect(section).toContain('ai-conductor config read <key>');
    expect(section).toContain('already set: <key> = <value>');
    expect(section).toMatch(/ask none.*still invoke `config init`/is);
    expect(section).toContain('ai-conductor config init --test-suite-mode <aggregate|scoped>');
  });

  it('keeps auto-mode configuration question-free and uses the default-preserving invocation', async () => {
    const section = await configSection();
    expect(section).toContain('ai-conductor config init --test-suite-mode aggregate --test-suite-drift-budget strict');
    expect(section).toMatch(/auto mode, do not prompt/is);
  });
});
