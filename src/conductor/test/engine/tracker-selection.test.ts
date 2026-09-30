// Covers: task:3
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTrackerSelection } from '../../src/engine/tracker-selection.js';

describe('resolveTrackerSelection', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'tracker-selection-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeProjectConfig(contents: string): Promise<void> {
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), contents, 'utf8');
  }

  function expectInvalidConfig(result: unknown): void {
    expect(result).toMatchObject({ ok: false, reason: 'invalid-config' });
    expect(result).toHaveProperty('detail', expect.any(String));
    expect(result).not.toHaveProperty('selection');
  }

  it('defaults to GitHub when the project has no config file', async () => {
    await expect(resolveTrackerSelection(projectRoot)).resolves.toEqual({
      ok: true,
      selection: { backend: 'github' },
    });
  });

  it('defaults to GitHub when config omits tracker', async () => {
    await writeProjectConfig('defaults:\n  effort: medium\n');

    await expect(resolveTrackerSelection(projectRoot)).resolves.toEqual({
      ok: true,
      selection: { backend: 'github' },
    });
  });

  it('ignores an invalid unrelated config key and defaults to GitHub', async () => {
    await writeProjectConfig('not_a_config_key: invalid\n');

    await expect(resolveTrackerSelection(projectRoot)).resolves.toEqual({
      ok: true,
      selection: { backend: 'github' },
    });
  });

  it('fails closed when the project config is unparseable YAML', async () => {
    await writeProjectConfig('tracker:\n  backend: jira\n bad-indent\n');

    const result = await resolveTrackerSelection(projectRoot);

    expectInvalidConfig(result);
  });

  it('fails closed when the project config path cannot be read', async () => {
    await mkdir(join(projectRoot, '.ai-conductor', 'config.yml'), { recursive: true });

    const result = await resolveTrackerSelection(projectRoot);

    expectInvalidConfig(result);
  });

  it('fails closed when the tracker backend is unsupported', async () => {
    await writeProjectConfig('tracker:\n  backend: gitlab\n');

    const result = await resolveTrackerSelection(projectRoot);

    expectInvalidConfig(result);
  });

  it('fails closed when a parseable tracker block is malformed', async () => {
    await writeProjectConfig('tracker:\n  backend: github\n  site: https://example.atlassian.net\n');

    const result = await resolveTrackerSelection(projectRoot);

    expectInvalidConfig(result);
  });

  it('exposes every valid Jira tracker setting unchanged', async () => {
    await writeProjectConfig([
      'tracker:',
      '  backend: jira',
      '  transport: api',
      '  credentials: jira-work',
      '  site: https://example.atlassian.net',
      '  project_key: ENG',
      '',
    ].join('\n'));

    await expect(resolveTrackerSelection(projectRoot)).resolves.toEqual({
      ok: true,
      selection: {
        backend: 'jira',
        transport: 'api',
        credentials: 'jira-work',
        site: 'https://example.atlassian.net',
        project_key: 'ENG',
      },
    });
  });
});
