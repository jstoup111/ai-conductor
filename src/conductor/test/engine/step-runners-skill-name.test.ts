// Covers: task:2
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function skillRoot(frontmatter: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'step-skill-name-'));
  roots.push(root);
  const directory = join(root, 'skills', 'explore');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), frontmatter);
  return root;
}

describe('DefaultStepRunner skill-name root', () => {
  it('renders a built-in invocation from the served skill frontmatter', async () => {
    const root = await skillRoot('---\nname: ac-explore\n---\n');
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const runner = new DefaultStepRunner({ invoke }, 'skill-name', root, {
      providerKey: 'codex',
      skillNameRoot: root,
    });

    await runner.run('explore', {});

    expect(invoke.mock.calls[0]?.[0].prompt).toBe('$ac-explore');
  });

  it('falls back to the directory name when the root is null', async () => {
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const runner = new DefaultStepRunner({ invoke }, 'skill-name', '/project', { providerKey: 'codex' });

    await runner.run('explore', {});

    expect(invoke.mock.calls[0]?.[0].prompt).toBe('$explore');
  });

  it('reports a missing served skill without invoking the provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'step-skill-name-missing-'));
    roots.push(root);
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const result = await new DefaultStepRunner({ invoke }, 'skill-name', root, {
      providerKey: 'codex',
      skillNameRoot: root,
    }).run('explore', {});

    expect({ success: result.success, output: result.output, calls: invoke.mock.calls.length }).toEqual({
      success: false,
      output: expect.stringMatching(new RegExp(`step explore.*${join(root, 'skills', 'explore', 'SKILL.md')}`)),
      calls: 0,
    });
  });

  it('reports unclosed served frontmatter without invoking the provider', async () => {
    const root = await skillRoot('---\nname: ac-explore\n');
    const invoke = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }));
    const result = await new DefaultStepRunner({ invoke }, 'skill-name', root, {
      providerKey: 'codex',
      skillNameRoot: root,
    }).run('explore', {});

    expect({ success: result.success, output: result.output, calls: invoke.mock.calls.length }).toEqual({
      success: false,
      output: expect.stringMatching(/step explore.*Unclosed SKILL\.md frontmatter/),
      calls: 0,
    });
  });
});
