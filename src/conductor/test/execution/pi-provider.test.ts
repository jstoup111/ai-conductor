import { dispatchGitGuard } from '../fixtures/dispatch-git-guard.js';

// Covers: task:2, task:3, task:4, task:6, task:7, task:8, task:9, task:10, task:13, task:15, task:16, task:17, task:18
// Covers: task:4
import { mkdir, mkdtemp, readFile, readdir, rm, stat as fileStat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';
import { classifyMetering } from '../../src/engine/metering.js';
import {
  parsePiModelId,
  parsePiModelListing,
  PiProvider,
  resolvePiSkill,
  type PiEnvironment,
} from '../../src/execution/pi-provider.js';
import { DAEMON_SESSION_MARKER } from '../../src/execution/daemon-session.js';
import { providerDescriptor } from '../../src/execution/provider-catalog.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';
import { STEP_SKILL_INVOCATIONS, renderSkillInvocation } from '../../src/engine/skill-invocation.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { createProviderRuntimeSet } from '../../src/engine/provider-runtime.js';

type PiSubprocessFactory = (
  file: string,
  args: readonly string[],
  options: ExecaOptions,
) => Promise<ExecaResult>;

const invokeOptions: InvokeOptions = {
  prompt: 'Implement the requested change.',
  sessionId: 'caller-session',
  resume: false,
  cwd: '/workspace/project',
  model: 'anthropic/claude-opus-4-5',
  effort: 'xhigh',
};

const readFixture = (name: string) => readFile(new URL(`../fixtures/pi/${name}`, import.meta.url), 'utf8');

describe('parsePiModelListing', () => {
  it('parses the captured Pi 0.84.3 listing into canonical provider/model ids', async () => {
    const listing = parsePiModelListing(await readFile(
      new URL('../fixtures/pi-list-models-0.84.3.txt', import.meta.url),
      'utf8',
    ));

    expect(listing).toEqual({
      kind: 'parsed',
      modelIds: [
        'anthropic/claude-opus-4-5',
        'cline/google/gemma-4-31b-it:free',
        'openai/gpt-5',
      ],
    });
  });

  it('locates provider and model columns by their header names rather than their positions', () => {
    expect(parsePiModelListing([
      'model                    context  provider',
      'google/gemma-4-31b-it:free  128K     cline',
    ].join('\n'))).toEqual({
      kind: 'parsed',
      modelIds: ['cline/google/gemma-4-31b-it:free'],
    });
  });

  it('returns the first line when no provider and model header is available', () => {
    expect(parsePiModelListing('Pi failed to load models\ntry again later')).toEqual({
      kind: 'unparseable',
      firstLine: 'Pi failed to load models',
    });
  });
});

function fakePiEnvironment(options: {
  files?: readonly string[];
  directories?: readonly string[];
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  cwd?: string;
  stat?: PiEnvironment['stat'];
  access?: PiEnvironment['access'];
} = {}): { environment: PiEnvironment; stat: ReturnType<typeof vi.fn> } {
  const files = new Set(options.files ?? []);
  const directories = new Set(options.directories ?? []);
  const stat = vi.fn(async (path: string) => {
    if (options.stat) return options.stat(path);
    if (files.has(path)) return { isFile: () => true, isDirectory: () => false };
    if (directories.has(path)) return { isFile: () => false, isDirectory: () => true };
    if (path.includes('ai-conductor-pi-system-prompt-')) return fileStat(path);
    const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
  return {
    environment: {
      stat,
      access: options.access ?? (async () => {}),
      env: options.env ?? {},
      homeDir: () => options.homeDir ?? '/home/agent',
      cwd: () => options.cwd ?? '/workspace/project',
    },
    stat,
  };
}

/** A fake environment that satisfies Pi's HARNESS.md dispatch precondition. */
function harnessedPiEnvironment(): PiEnvironment {
  return fakePiEnvironment({ files: ['/home/agent/.agents/skills/HARNESS.md'] }).environment;
}

describe('resolvePiSkill', () => {
  const skillName = 'pipeline';
  const homeSkillsRoot = '/home/agent/.agents/skills';
  const configuredPiRoot = '/configured/pi-agent/skills';
  const defaultPiRoot = '/home/agent/.pi/agent/skills';
  const projectSkillsRoot = '/workspace/project/.agents/skills';

  it.each([
    ['the agent catalog', `${homeSkillsRoot}/${skillName}/SKILL.md`, {}, [homeSkillsRoot, defaultPiRoot, projectSkillsRoot]],
    ['the configured Pi agent catalog', `${configuredPiRoot}/${skillName}/SKILL.md`, { PI_CODING_AGENT_DIR: '/configured/pi-agent' }, [homeSkillsRoot, configuredPiRoot, projectSkillsRoot]],
    ['the default Pi agent catalog', `${defaultPiRoot}/${skillName}/SKILL.md`, {}, [homeSkillsRoot, defaultPiRoot, projectSkillsRoot]],
    ['the project catalog', `${projectSkillsRoot}/${skillName}/SKILL.md`, {}, [homeSkillsRoot, defaultPiRoot, projectSkillsRoot]],
  ])('finds SKILL.md in %s', async (_source, skillPath, env, searchedRoots) => {
    const { environment, stat } = fakePiEnvironment({ files: [skillPath], env });

    await expect(resolvePiSkill(skillName, environment)).resolves.toEqual({
      found: true,
      skillPath,
      searchedRoots,
    });
    expect(stat.mock.calls.flat().every((path) => path.endsWith('/SKILL.md'))).toBe(true);
    expect(stat.mock.calls.flat().at(-1)).toBe(skillPath);
  });

  it.each([
    ['the retired PI_HOME catalog', '/legacy/pi-home/skills/pipeline/SKILL.md', { PI_HOME: '/legacy/pi-home' }],
    ['the retired project .pi catalog', '/workspace/project/.pi/skills/pipeline/SKILL.md', {}],
    ['a skill directory without SKILL.md', '/home/agent/.agents/skills/pipeline', {}],
  ])('rejects a skill found only in %s', async (_source, legacyPath, env) => {
    const { environment, stat } = fakePiEnvironment({
      env,
      files: legacyPath.endsWith('/SKILL.md') ? [legacyPath] : [],
      directories: legacyPath.endsWith('/SKILL.md') ? [] : [legacyPath],
    });

    await expect(resolvePiSkill(skillName, environment)).resolves.toEqual({
      found: false,
      searchedRoots: [homeSkillsRoot, defaultPiRoot, projectSkillsRoot],
    });
    expect(stat.mock.calls.flat()).toEqual([
      `${homeSkillsRoot}/${skillName}/SKILL.md`,
      `${defaultPiRoot}/${skillName}/SKILL.md`,
      `${projectSkillsRoot}/${skillName}/SKILL.md`,
    ]);
  });

  it('reads the configured variable and default home from the Pi catalog and only stats SKILL.md', async () => {
    const { environment, stat } = fakePiEnvironment({
      env: { PI_CODING_AGENT_DIR: '/configured/pi-agent' },
    });

    await resolvePiSkill(skillName, environment);

    expect(stat.mock.calls.flat()).toEqual([
      `${homeSkillsRoot}/${skillName}/SKILL.md`,
      `${configuredPiRoot}/${skillName}/SKILL.md`,
      `${projectSkillsRoot}/${skillName}/SKILL.md`,
    ]);
    expect(stat.mock.calls.flat().every((path) => path.endsWith('/SKILL.md'))).toBe(true);
  });
});

describe('Pi frontmatter-named catalog entries', () => {
  const harnessPath = '/home/agent/.agents/skills/HARNESS.md';
  const spawn = vi.fn<PiSubprocessFactory>();

  beforeEach(() => {
    vi.clearAllMocks();
    spawn.mockResolvedValue({
      stdout: JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Pi completed.' }] },
      }),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);
  });

  it('resolves only the frontmatter name used as the catalog entry key', async () => {
    const { environment } = fakePiEnvironment({
      files: [harnessPath, '/home/agent/.agents/skills/ac-explore/SKILL.md'],
    });
    const provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);

    await expect(provider.invoke({ ...invokeOptions, prompt: '/skill:ac-explore\nExplore it.' }))
      .resolves.toMatchObject({ success: true });
    await expect(provider.invoke({ ...invokeOptions, prompt: '/skill:explore\nExplore it.' }))
      .resolves.toMatchObject({
        success: false,
        commandUnresolved: true,
        commandUnresolvedName: 'explore',
      });

    expect(spawn).toHaveBeenCalledOnce();
  });

  it('keeps the shipped pipeline catalog entry and rendered build prompt unchanged', async () => {
    const { environment } = fakePiEnvironment({
      files: [harnessPath, '/home/agent/.agents/skills/pipeline/SKILL.md'],
    });
    const provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);
    const prompt = renderSkillInvocation(STEP_SKILL_INVOCATIONS.build!, 'pi');

    expect(prompt).toBe('/skill:pipeline');
    await expect(provider.invoke({ ...invokeOptions, prompt: `${prompt}\nBuild it.` }))
      .resolves.toMatchObject({ success: true });
    expect(spawn).toHaveBeenCalledOnce();
  });
});

describe('PiProvider', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  let provider: PiProvider;
  let environment: PiEnvironment;
  let stat: ReturnType<typeof vi.fn>;
  const harnessPath = '/home/agent/.agents/skills/HARNESS.md';

  beforeEach(() => {
    vi.clearAllMocks();
    spawn.mockResolvedValue({
      stdout: JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Pi completed.' }] },
      }),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);
    ({ environment, stat } = fakePiEnvironment({ files: [harnessPath] }));
    provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);
  });

  it('spawns a resolved Pi executable headlessly with its configured provider, model, and thinking effort', async () => {
    await provider.invoke(invokeOptions);

    expect(spawn).toHaveBeenCalledWith(
      '/resolved/pi',
      [
        '-p', '-na', '--no-session', '--mode', 'json', '--append-system-prompt', harnessPath,
        '--provider', 'anthropic',
        '--model', 'claude-opus-4-5',
        '--thinking', 'xhigh',
      ],
      expect.objectContaining({
        input: invokeOptions.prompt,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: invokeOptions.cwd,
        reject: false,
      }),
    );
    expect(spawn.mock.calls[0]?.[1]).not.toContain('claude-opus-4-5:xhigh');
  });

  // Covers: task:10
  it.each([
    ['no system prompt', {}],
    ['an empty system prompt', { systemPrompt: '' }],
  ])('does not create a system-prompt file for %s', async (_caseName, systemPromptOptions) => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'ai-conductor-pi-no-system-prompt-'));
    const previousTempRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = tempRoot;
    try {
      await expect(provider.invoke({ ...invokeOptions, ...systemPromptOptions })).resolves.toMatchObject({ success: true });

      const args = spawn.mock.calls[0]![1];
      const appendIndices = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      expect({
        appendPrompts: appendIndices.map((index) => args[index + 1]),
        tempEntries: (await readdir(tempRoot)).filter((entry) => entry.startsWith('ai-conductor-pi-system-prompt-')),
      }).toEqual({ appendPrompts: [harnessPath], tempEntries: [] });
    } finally {
      if (previousTempRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousTempRoot;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:10
  it.each([
    ['no system prompt', {}],
    ['an empty system prompt', { systemPrompt: '' }],
  ])('spawns without trying to create a system-prompt file for %s when the temp root is invalid', async (_caseName, systemPromptOptions) => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'ai-conductor-pi-invalid-temp-root-'));
    const blockingFile = join(fixtureRoot, 'not-a-directory');
    const previousTempRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    await writeFile(blockingFile, 'file blocks mkdtemp parent');
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = join(blockingFile, 'child');
    try {
      const result = await provider.invoke({ ...invokeOptions, ...systemPromptOptions });

      expect({
        spawned: spawn.mock.calls.length,
        systemPromptPreparationFailed: result.output.includes('could not prepare the system prompt for delivery'),
      }).toEqual({ spawned: 1, systemPromptPreparationFailed: false });
    } finally {
      if (previousTempRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousTempRoot;
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:8
  it('appends the engine system prompt after HARNESS.md and delivers it through its file', async () => {
    const systemPrompt = 'RETRY: fix the lint error\n[Conduct step 7/20]';
    let delivered: string | undefined;
    spawn.mockImplementationOnce(async (_file, args) => {
      const flags = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      const path = args[flags[1]! + 1]!;
      delivered = await readFile(path, 'utf8');
      await rm(dirname(path), { recursive: true, force: true });
      return { stdout: assistantEnd, stderr: '', exitCode: 0 } as ExecaResult;
    });

    await provider.invoke({ ...invokeOptions, systemPrompt });

    const args = spawn.mock.calls[0]![1];
    const flags = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
    expect({
      harnessFirst: flags[0]! < flags[1]!,
      harness: args[flags[0]! + 1],
      delivered,
    }).toEqual({ harnessFirst: true, harness: harnessPath, delivered: systemPrompt });
  });

  // Covers: task:8
  it('keeps a remediate prompt unchanged while delivering adjudication context through the appended file', async () => {
    const systemPrompt = 'RETRY: Adjudicate findings\n{"currentFindings":["A"]}';
    let delivered: string | undefined;
    spawn.mockImplementationOnce(async (_file, args) => {
      const flags = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      const path = args[flags[1]! + 1]!;
      delivered = await readFile(path, 'utf8');
      await rm(dirname(path), { recursive: true, force: true });
      return { stdout: assistantEnd, stderr: '', exitCode: 0 } as ExecaResult;
    });

    await provider.invoke({ ...invokeOptions, prompt: '/remediate', systemPrompt });

    expect({ input: spawn.mock.calls[0]![2].input, delivered }).toEqual({ input: '/remediate', delivered: systemPrompt });
  });

  // Covers: task:8
  it('keeps a skill-shaped system prompt out of Pi argv and stdin', async () => {
    const systemPrompt = '/skill:remediate\nDo not turn this into the dispatch prompt.';
    let delivered: string | undefined;
    spawn.mockImplementationOnce(async (_file, args) => {
      const flags = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      const path = args[flags[1]! + 1]!;
      delivered = await readFile(path, 'utf8');
      await rm(dirname(path), { recursive: true, force: true });
      return { stdout: assistantEnd, stderr: '', exitCode: 0 } as ExecaResult;
    });

    await provider.invoke({ ...invokeOptions, systemPrompt });

    const [, args, options] = spawn.mock.calls[0]!;
    expect({
      input: options.input,
      delivered,
      inArgv: args.some((value) => value.includes(systemPrompt)),
      inStdin: String(options.input).includes(systemPrompt),
    }).toEqual({ input: invokeOptions.prompt, delivered: systemPrompt, inArgv: false, inStdin: false });
  });

  // Covers: task:11
  it('refuses Pi before spawn when its system-prompt file cannot be prepared or verified', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'ai-conductor-pi-system-prompt-refusal-'));
    const blockingFile = join(fixtureRoot, 'not-a-directory');
    const previousTempRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    await writeFile(blockingFile, 'blocks mkdtemp');
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = join(blockingFile, 'child');
    try {
      const preparationFailure = await provider.invoke({ ...invokeOptions, systemPrompt: 'S' });
      expect({ spawned: spawn.mock.calls.length, output: preparationFailure.output }).toEqual({
        spawned: 0,
        output: expect.stringMatching(/Pi could not prepare the system prompt for delivery/),
      });

      process.env.AI_CONDUCTOR_TEST_TMP_ROOT = fixtureRoot;
      let preparedPath: string | undefined;
      ({ environment } = fakePiEnvironment({
        stat: async (path) => {
          if (path === harnessPath) return { isFile: () => true, isDirectory: () => false };
          if (path.includes('ai-conductor-pi-system-prompt-')) {
            preparedPath = path;
            return { isFile: () => false, isDirectory: () => false };
          }
          throw new Error(`ENOENT: ${path}`);
        },
      }));
      provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);
      const verificationFailure = await provider.invoke({ ...invokeOptions, systemPrompt: 'S' });
      expect({
        spawned: spawn.mock.calls.length,
        namesPath: verificationFailure.output.includes(preparedPath!),
        output: verificationFailure.output,
      }).toEqual({ spawned: 0, namesPath: true, output: expect.stringMatching(/Pi.*is not a readable regular file/) });
    } finally {
      if (previousTempRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousTempRoot;
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:11
  it('refuses Pi before spawn when its regular system-prompt file is unreadable', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'ai-conductor-pi-system-prompt-unreadable-'));
    const previousTempRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = tempRoot;
    let preparedPath: string | undefined;
    const readabilityCheck = vi.fn(async (path: string) => {
      preparedPath = path;
      throw new Error('EACCES');
    });
    try {
      ({ environment } = fakePiEnvironment({
        files: [harnessPath],
        access: readabilityCheck,
      }));
      provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);

      const result = await provider.invoke({ ...invokeOptions, systemPrompt: 'S' });

      expect({
        spawned: spawn.mock.calls.length,
        success: result.success,
        output: result.output,
        disposed: (await readdir(tempRoot)).filter((entry) => entry.startsWith('ai-conductor-pi-system-prompt-')),
      }).toEqual({
        spawned: 0,
        success: false,
        output: expect.stringMatching(/Pi.*is not a readable regular file/),
        disposed: [],
      });
      expect(result.output).toContain(preparedPath!);
      expect(readabilityCheck).toHaveBeenCalledWith(preparedPath, constants.R_OK);
    } finally {
      if (previousTempRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousTempRoot;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:12
  it.each([
    ['a 300 KiB prompt', 'x'.repeat(300 * 1024)],
    ['a multi-byte UTF-8 prompt', 'é → 🚀'.repeat(4096)],
    ['the 128 KiB argument boundary', 'x'.repeat(128 * 1024)],
    ['a multi-line prompt', 'first line\nsecond line\nthird line'],
  ])('delivers %s through the appended file only', async (_caseName, systemPrompt) => {
    let delivered: Buffer | undefined;
    spawn.mockImplementationOnce(async (_file, args) => {
      const indices = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      delivered = await readFile(args[indices[1]! + 1]!);
      return { stdout: assistantEnd, stderr: '', exitCode: 0 } as ExecaResult;
    });

    await provider.invoke({ ...invokeOptions, systemPrompt });

    const args = spawn.mock.calls[0]![1];
    expect({
      containsText: args.some((value) => value.includes(systemPrompt)),
      containsSlice: args.some((value) => value.includes(systemPrompt.slice(0, 64))),
      everyArgUnderLimit: args.every((value) => Buffer.byteLength(value) < 131_072),
      noPromptLineIsArg: systemPrompt.split('\n').every((line) => !args.includes(line)),
      bytes: delivered,
    }).toEqual({
      containsText: false,
      containsSlice: false,
      everyArgUnderLimit: true,
      noPromptLineIsArg: true,
      bytes: Buffer.from(systemPrompt, 'utf8'),
    });
  });

  // Covers: task:13
  it('uses distinct private files and removes them after success, failure, abort, and ENOENT', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'ai-conductor-pi-system-prompt-cleanup-'));
    const previousTempRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
    process.env.AI_CONDUCTOR_TEST_TMP_ROOT = tempRoot;
    const paths: string[] = [];
    try {
      for (const result of [
        { stdout: assistantEnd, stderr: '', exitCode: 0 },
        { stdout: '', stderr: '', exitCode: 1 },
        { stdout: '', stderr: '', exitCode: undefined, code: 'ENOENT' },
      ]) {
        spawn.mockImplementationOnce(async (_file, args) => {
          const indices = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
          const path = args[indices[1]! + 1]!;
          paths.push(path);
          expect((await fileStat(path)).mode & 0o777).toBe(0o600);
          return result as ExecaResult;
        });
        await provider.invoke({ ...invokeOptions, systemPrompt: `prompt-${paths.length}` });
      }

      const controller = new AbortController();
      let resolveProcess: (result: ExecaResult) => void;
      const process = Object.assign(new Promise<ExecaResult>((resolve) => { resolveProcess = resolve; }), {
        kill: vi.fn(() => resolveProcess({ stdout: '', stderr: '', exitCode: 1 } as ExecaResult)),
      });
      spawn.mockImplementationOnce((_file, args) => {
        const indices = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
        paths.push(args[indices[1]! + 1]!);
        return process as ReturnType<PiSubprocessFactory>;
      });
      const aborted = provider.invoke({ ...invokeOptions, systemPrompt: 'abort', abortSignal: controller.signal });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(4));
      controller.abort();
      await expect(aborted).resolves.toMatchObject({ output: 'Pi invocation aborted.' });

      expect(await Promise.all(paths.flatMap((path) => [
        fileStat(path).then(() => true, () => false),
        fileStat(dirname(path)).then(() => true, () => false),
      ]))).toEqual(Array(paths.length * 2).fill(false));

      const preSpawnController = new AbortController();
      let preSpawnPath: string | undefined;
      ({ environment } = fakePiEnvironment({
        stat: async (path) => {
          if (path === harnessPath) return { isFile: () => true, isDirectory: () => false };
          if (path.includes('ai-conductor-pi-system-prompt-')) {
            preSpawnPath = path;
            preSpawnController.abort();
            return { isFile: () => true, isDirectory: () => false };
          }
          throw new Error(`ENOENT: ${path}`);
        },
      }));
      provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);
      const callsBeforePreSpawnAbort = spawn.mock.calls.length;
      await expect(provider.invoke({ ...invokeOptions, systemPrompt: 'pre-spawn abort', abortSignal: preSpawnController.signal }))
        .resolves.toMatchObject({ output: 'Pi invocation aborted.' });
      expect({
        spawned: spawn.mock.calls.length - callsBeforePreSpawnAbort,
        fileExists: await fileStat(preSpawnPath!).then(() => true, () => false),
        tempEntries: (await readdir(tempRoot)).filter((entry) => entry.startsWith('ai-conductor-pi-system-prompt-')),
      }).toEqual({ spawned: 0, fileExists: false, tempEntries: [] });

      const concurrentPaths: string[] = [];
      const concurrentContents: string[] = [];
      spawn.mockImplementation(async (_file, args) => {
        const indices = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
        const path = args[indices[1]! + 1]!;
        concurrentPaths.push(path);
        concurrentContents.push(await readFile(path, 'utf8'));
        return { stdout: assistantEnd, stderr: '', exitCode: 0 } as ExecaResult;
      });
      await Promise.all([provider.invoke({ ...invokeOptions, systemPrompt: 'A' }), provider.invoke({ ...invokeOptions, systemPrompt: 'B' })]);
      expect({ paths: concurrentPaths, contents: concurrentContents }).toEqual({
        paths: expect.arrayContaining([expect.any(String), expect.any(String)]),
        contents: expect.arrayContaining(['A', 'B']),
      });
      expect(new Set(concurrentPaths).size).toBe(2);
    } finally {
      if (previousTempRoot === undefined) delete process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
      else process.env.AI_CONDUCTOR_TEST_TMP_ROOT = previousTempRoot;
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:8
  it('delivers a system prompt through the guarded Pi runtime', async () => {
    let delivered: string | undefined;
    spawn.mockImplementationOnce(async (_file, args) => {
      const flags = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      const path = args[flags[1]! + 1]!;
      delivered = await readFile(path, 'utf8');
      await rm(dirname(path), { recursive: true, force: true });
      return { stdout: assistantEnd, stderr: '', exitCode: 0 } as ExecaResult;
    });
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'pi', provider);
    registry.markInitialized();

    await createProviderRuntimeSet(registry).get('pi').provider.invoke({
      ...invokeOptions,
      prompt: '/x',
      systemPrompt: 'S',
    });

    expect({ spawned: spawn.mock.calls.length, delivered }).toEqual({ spawned: 1, delivered: 'S' });
  });

  it.each([
    ['the installed agent catalog', '/home/agent/.agents/skills/pipeline/SKILL.md', {}],
    ['the configured Pi catalog', '/configured/pi-agent/skills/pipeline/SKILL.md', { PI_CODING_AGENT_DIR: '/configured/pi-agent' }],
    ['the default Pi catalog', '/home/agent/.pi/agent/skills/pipeline/SKILL.md', {}],
    ['the project catalog', '/workspace/project/.agents/skills/pipeline/SKILL.md', {}],
  ])('invokes a /skill: command found in %s', async (_source, skillPath, env) => {
    ({ environment } = fakePiEnvironment({ files: [harnessPath, skillPath], env }));
    provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);

    await expect(provider.invoke({ ...invokeOptions, prompt: '/skill:pipeline\nBuild it.' })).resolves.toMatchObject({ success: true });

    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[1]).toContain('-na');
  });

  it('does not resolve a skill when the prompt does not begin with a Pi skill command', async () => {
    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({ success: true });

    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[1]).toContain('-na');
    expect(stat.mock.calls.flat().filter((path) => String(path).endsWith('/pipeline/SKILL.md'))).toEqual([]);
  });

  it.each([
    ['a blank first line', '\n/skill:pipeline\nBuild it.'],
    ['whitespace before the first-line command', ' /skill:pipeline\nBuild it.'],
  ])('does not resolve a skill when the prompt has %s', async (_source, prompt) => {
    await expect(provider.invoke({ ...invokeOptions, prompt })).resolves.toMatchObject({ success: true });

    expect(spawn).toHaveBeenCalledOnce();
    expect(stat.mock.calls.flat().filter((path) => String(path).endsWith('/pipeline/SKILL.md'))).toEqual([]);
  });

  // Covers: task:8
  it.each([
    ['no skill catalog entry', [], []],
    ['only the retired PI_HOME catalog', ['/legacy/pi-home/skills/pipeline/SKILL.md'], []],
    ['only the retired project .pi catalog', ['/workspace/project/.pi/skills/pipeline/SKILL.md'], []],
    ['a directory without SKILL.md', [], ['/home/agent/.agents/skills/pipeline']],
  ])('refuses an unresolvable Pi command found in %s without spawning the provider', async (_source, extraFiles, directories) => {
    ({ environment } = fakePiEnvironment({
      files: [harnessPath, ...extraFiles],
      directories,
      env: { PI_HOME: '/legacy/pi-home' },
    }));
    provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);

    await expect(provider.invoke({ ...invokeOptions, prompt: '/skill:pipeline\nBuild it.' })).resolves.toMatchObject({
      success: false,
      commandUnresolved: true,
      commandUnresolvedName: 'pipeline',
      executionDisposition: 'not-started',
      output: expect.stringContaining('pipeline'),
    });

    const result = await provider.invoke({ ...invokeOptions, prompt: '/skill:pipeline' });
    expect(result.output).toContain('/home/agent/.agents/skills');
    expect(result.output).toContain('/home/agent/.pi/agent/skills');
    expect(result.output).toContain('/workspace/project/.agents/skills');
    expect(result).not.toHaveProperty('providerUnavailable');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does not reject an explicit-only skill whose SKILL.md exists', async () => {
    ({ environment } = fakePiEnvironment({
      files: [harnessPath, '/home/agent/.agents/skills/fixture/SKILL.md'],
    }));
    provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);

    await expect(provider.invoke({ ...invokeOptions, prompt: '/skill:fixture\nBuild it.' })).resolves.toMatchObject({ success: true });

    expect(spawn).toHaveBeenCalledOnce();
  });

  // Covers: task:8
  it.each([
    ['missing', [], []],
    ['a dangling symlink', [], []],
  ])('refuses Pi dispatch when HARNESS.md is %s or subagents are unavailable', async (_source, files, directories) => {
    ({ environment } = fakePiEnvironment({ files, directories }));
    provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: false,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: expect.stringMatching(/HARNESS\.md.*bin\/install/),
      executionDisposition: 'not-started',
    });

    expect(spawn).not.toHaveBeenCalled();

    const packageUnavailable = await new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, harnessedPiEnvironment()).invoke({
      ...invokeOptions,
      subagents: true,
    });

    expect(packageUnavailable).toMatchObject({
      success: false,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      executionDisposition: 'not-started',
    });
    expect(packageUnavailable.output).toContain('pi install npm:pi-subagents');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['a project skills directory', ['/workspace/project/.agents/skills'], ['-p', '-na', '--no-session', '--mode', 'json', '--append-system-prompt', harnessPath, '--skill', '/workspace/project/.agents/skills']],
    ['no project skills path', [], ['-p', '-na', '--no-session', '--mode', 'json', '--append-system-prompt', harnessPath]],
    ['a project skills file', [], ['-p', '-na', '--no-session', '--mode', 'json', '--append-system-prompt', harnessPath]],
  ])('loads %s only when it is a directory and never trusts it', async (_source, directories, expectedArgs) => {
    const files = _source === 'a project skills file'
      ? [harnessPath, '/workspace/project/.agents/skills']
      : [harnessPath];
    ({ environment } = fakePiEnvironment({ files, directories }));
    provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({ success: true });

    expect(spawn).toHaveBeenCalledWith('/resolved/pi', [
      ...expectedArgs,
      '--provider', 'anthropic',
      '--model', 'claude-opus-4-5',
      '--thinking', 'xhigh',
    ], expect.anything());
    expect(spawn.mock.calls[0]?.[1]).toContain('-na');
    expect(spawn.mock.calls[0]?.[1]).not.toContain('--approve');
    expect(spawn.mock.calls[0]?.[1]).not.toContain('-a');
  });

  it('stamps the daemon marker and masks tmux targets after the self-host env overlay', async () => {
    await provider.invoke({
      ...invokeOptions,
      selfHost: {
        executable: '/isolated/pi',
        env: {
          PI_HOME: '/isolated/home',
          [DAEMON_SESSION_MARKER]: 'not-a-daemon-session',
          TMUX: '/tmp/tmux-1000/default,1234,0',
          TMUX_PANE: '%7',
        },
        args: [],
        teardown: async () => {},
      },
    });

    expect(spawn.mock.calls[0]?.[2].env).toEqual({
      PI_HOME: '/isolated/home',
      [DAEMON_SESSION_MARKER]: '1',
      TMUX: undefined,
      TMUX_PANE: undefined,
    });
  });

  it('creates a marked and tmux-scrubbed env for an empty self-host overlay', async () => {
    await provider.invoke({
      ...invokeOptions,
      selfHost: {
        executable: '/isolated/pi',
        env: {},
        args: [],
        teardown: async () => {},
      },
    });

    expect(spawn.mock.calls[0]?.[2].env).toEqual({
      [DAEMON_SESSION_MARKER]: '1',
      TMUX: undefined,
      TMUX_PANE: undefined,
    });
  });

  it('keeps retries in fresh no-session invocations and exposes only invoke dispatch', async () => {
    await provider.invoke(invokeOptions);
    await provider.invoke({ ...invokeOptions, resume: true, sessionId: 'retry-session' });

    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
      [
        '-p', '-na', '--no-session', '--mode', 'json', '--append-system-prompt', harnessPath,
        '--provider', 'anthropic',
        '--model', 'claude-opus-4-5',
        '--thinking', 'xhigh',
      ],
      [
        '-p', '-na', '--no-session', '--mode', 'json', '--append-system-prompt', harnessPath,
        '--provider', 'anthropic',
        '--model', 'claude-opus-4-5',
        '--thinking', 'xhigh',
      ],
    ]);
    expect(provider.supportsSessionResume).toBe(false);
    expect(provider.lifecycleCapability).toEqual({ synchronousSpawnPermit: true });
    expect(Object.getOwnPropertyNames(PiProvider.prototype)).toEqual(['constructor', 'resolveSelfHostExecutable', 'prepareSelfHostAuth', 'invoke']);
  });

  // Covers: task:5
  it('resolves its self-host executable from the constructed adapter', async () => {
    expect(await provider.resolveSelfHostExecutable()).toBe('/resolved/pi');
  });

  // Covers: task:5
  it('resolves the candidate provider key into its isolated self-host auth file', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'pi-provider-self-host-'));
    const runner = vi.fn(async () => ({ stdout: 'K' }));
    const selfHostProvider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, environment, undefined, undefined, runner);

    try {
      await selfHostProvider.prepareSelfHostAuth({ provider: 'pi', homeDir, model: 'deepseek/x' });

      expect({
        call: runner.mock.calls[0],
        auth: JSON.parse(await readFile(join(homeDir, 'auth.json'), 'utf8')),
      }).toEqual({
        call: [
          '/resolved/pi',
          ['auth', 'print-api-key', '--provider', 'deepseek'],
          expect.objectContaining({ cwd: homeDir, timeout: 30_000 }),
        ],
        auth: { deepseek: { type: 'api_key', key: 'K' } },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('preserves a nested Pi model suffix and supplies exactly one separate thinking flag', async () => {
    await provider.invoke({
      ...invokeOptions,
      model: 'cline/google/gemma-4-31b-it:free',
      effort: 'high',
    });

    const args = spawn.mock.calls[0]?.[1] ?? [];
    expect(args).toEqual(expect.arrayContaining([
      '--provider', 'cline',
      '--model', 'google/gemma-4-31b-it:free',
      '--thinking', 'high',
    ]));
    expect(args.filter((arg) => arg === '--thinking')).toHaveLength(1);
    expect(args).not.toContain('google/gemma-4-31b-it:free:high');
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'passes Pi thinking effort %s unchanged',
    async (effort) => {
      await provider.invoke({ ...invokeOptions, effort });

      const args = spawn.mock.calls[0]?.[1] ?? [];
      expect(args[args.indexOf('--thinking') + 1]).toBe(effort);
      expect(args).not.toContain('--thinking off');
      expect(args).not.toContain('--thinking minimal');
    },
  );

  it('declares Pi without deferred capabilities and requires configured models', async () => {
    const pi = providerDescriptor('pi');

    expect(pi).toMatchObject({
      defaultExecutable: 'pi',
      executableOverrideEnv: 'PI_EXECUTABLE',
      versionArgv: ['--version'],
      capabilities: {},
    });
    expect(pi.modelPolicy.requiresConfiguredModels).toBe(true);
    expect(pi.modelPolicy.modelFallbackLadder).toEqual([]);
    expect(Object.values(pi.modelPolicy.stepModels)).toEqual(
      expect.arrayContaining(['']),
    );

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({ success: true });
  });

  it('returns the terminal assistant message and its message usage as cost-unmetered', async () => {
    spawn.mockResolvedValue({
      stdout: await readFixture('terminal-assistant.jsonl'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({
      success: true,
      output: 'Implemented the requested change.',
      tokenUsage: { input: 144, output: 21, cacheRead: 55, cacheCreation: 8 },
    });
    expect(classifyMetering(result.tokenUsage)).toBe('cost-unmetered');
  });

  it('counts terminal assistant turns and accepts usage on a terminal event', async () => {
    spawn.mockResolvedValue({
      stdout: [
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', content: 'First turn.', usage: { input: 9, output: 4 } },
        }),
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', content: 'Second turn.' },
        }),
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      output: 'Second turn.',
      tokenUsage: { input: 9, output: 4, numTurns: 2 },
    });
  });

  it('ignores a malformed JSONL line and still returns the terminal assistant message', async () => {
    spawn.mockResolvedValue({
      stdout: await readFixture('malformed-before-terminal.jsonl'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: true,
      output: 'The valid terminal message survives.',
    });
  });

  it('fails an exit-zero stream without a terminal assistant message', async () => {
    spawn.mockResolvedValue({
      stdout: await readFixture('no-terminal-assistant.jsonl'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      output: expect.stringContaining('missing terminal assistant message'),
    });
  });

  it('classifies an anchored exit-zero authentication error stop', async () => {
    spawn.mockResolvedValue({
      stdout: await readFile(new URL('../fixtures/pi-error-stop-stream.jsonl', import.meta.url), 'utf8'),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({
      success: false,
      exitCode: 0,
      output: 'Pi authentication failed: the upstream provider credential is missing or was rejected.',
    });
    expect(result).toHaveProperty('authFailure', true);
    expect(result).not.toHaveProperty('rateLimited');
    expect(result).not.toHaveProperty('modelUnavailable');
  });

  it('fails an exit-zero error stop without an error message', async () => {
    spawn.mockResolvedValue({
      stdout: JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [], stopReason: 'error' },
      }),
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      output: 'Pi reported an error stop with no message',
    });
  });

  it('retains an error stop before a malformed trailing JSONL line', async () => {
    const errorStop = await readFile(new URL('../fixtures/pi-error-stop-stream.jsonl', import.meta.url), 'utf8');
    spawn.mockResolvedValue({
      stdout: `${errorStop}\nnot JSON`,
      stderr: '',
      exitCode: 0,
    } as ExecaResult);

    await expect(provider.invoke(invokeOptions)).resolves.toMatchObject({
      success: false,
      exitCode: 0,
      output: 'Pi authentication failed: the upstream provider credential is missing or was rejected.',
    });
  });

  // Covers: task:8
  it('keeps a post-spawn abort invoked without reporting a provider failure signal', async () => {
    const controller = new AbortController();
    let resolveProcess: (result: ExecaResult) => void;
    const process = Object.assign(
      new Promise<ExecaResult>((resolve) => { resolveProcess = resolve; }),
      {
        kill: vi.fn(() => resolveProcess({ stdout: '', stderr: '', exitCode: 1 } as ExecaResult)),
      },
    );
    spawn.mockImplementationOnce(() => process as ReturnType<PiSubprocessFactory>);

    const invocation = provider.invoke({
      ...invokeOptions,
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    controller.abort();

    const result = await invocation;

    expect(process.kill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: false, output: 'Pi invocation aborted.', exitCode: 1 });
    expect(result).not.toHaveProperty('providerUnavailable');
    expect(result).not.toHaveProperty('modelUnavailable');
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('rateLimited');
    expect(result).not.toHaveProperty('executionDisposition');
  });

  it('records a SIGTERM without inventing an exit code for an unclassified Pi failure', async () => {
    const diagnosticLog = vi.fn();
    spawn.mockResolvedValue({ stdout: '', stderr: '', exitCode: null, signal: 'SIGTERM' } as unknown as ExecaResult);

    const result = await provider.invoke({ ...invokeOptions, diagnosticLog });

    expect(result).toMatchObject({
      success: false,
      output: '',
      exitCode: 1,
      exitFacts: { signal: 'SIGTERM', stdoutBytes: 0, stderrBytes: 0 },
    });
    expect(diagnosticLog.mock.calls.filter(([message]) =>
      String(message).startsWith('pi subprocess exited without a classifiable result:'),
    )).toEqual([[
      'pi subprocess exited without a classifiable result: signal=SIGTERM stdoutBytes=0 stderrBytes=0',
    ]]);
  });

  // Covers: task:8
  it('marks an abort during asynchronous preflight as not started without spawning', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(provider.invoke({ ...invokeOptions, abortSignal: controller.signal })).resolves.toMatchObject({
      success: false,
      output: 'Pi invocation aborted.',
      exitCode: 1,
      executionDisposition: 'not-started',
    });

    expect(spawn).not.toHaveBeenCalled();
  });

  // Covers: task:8
  it.each([
    [
      'a structural ENOENT',
      { stdout: '', stderr: '', exitCode: undefined, code: 'ENOENT' },
      { providerUnavailable: true, providerUnavailableScope: 'run' },
    ],
    [
      'exit 127',
      { stdout: '', stderr: 'shell could not execute command', exitCode: 127 },
      { providerUnavailable: true, providerUnavailableScope: 'run' },
    ],
    [
      'the verified unknown-model diagnostic',
      { stdout: '', stderr: 'Error: Model "x" not found. Use --list-models to see available models.', exitCode: 1 },
      { modelUnavailable: true },
    ],
    [
      'an unmatched non-zero failure',
      { stdout: '', stderr: 'Pi encountered an unexpected transport failure.', exitCode: 1 },
      {},
    ],
    [
      'authentication-style output',
      { stdout: '', stderr: 'Authentication required. Please log in.', exitCode: 1 },
      {},
    ],
    [
      'rate-limit-style output',
      { stdout: '', stderr: 'Error 429: rate limit exceeded.', exitCode: 1 },
      {},
    ],
  ])('classifies %s without inferring unsupported Pi recovery signals', async (_name, response, expected) => {
    spawn.mockResolvedValue(response as ExecaResult);

    const result = await provider.invoke(invokeOptions);

    expect(result).toMatchObject({ success: false, exitCode: response.exitCode ?? 1, ...expected });
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('rateLimited');
    if (!('providerUnavailable' in expected)) {
      expect(result).not.toHaveProperty('providerUnavailable');
      expect(result).not.toHaveProperty('providerUnavailableScope');
    }
    if (!('modelUnavailable' in expected)) expect(result).not.toHaveProperty('modelUnavailable');
    if (Object.keys(expected).length > 0) expect(result).not.toHaveProperty('exitFacts');
    expect(result).not.toHaveProperty('executionDisposition');
  });
});

describe('PiProvider captured failure classification', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  const provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, harnessedPiEnvironment());
  const invoke = () => provider.invoke(invokeOptions);
  const errorStream = (message: string) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: '', stopReason: 'error', errorMessage: message } });
  const textStream = (text: string) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: text, stopReason: 'stop' } });

  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['pi-1.0.0-e6-rate-limit.jsonl', { rateLimited: true }],
    ['pi-1.0.0-e8-rate-limit-anthropic.jsonl', { rateLimited: true }],
    ['pi-1.0.0-e7-usage-exhausted.jsonl', { rateLimited: true, usageExhausted: true, waitSeconds: 3600 }],
  ])('classifies terminal %s safely', async (name, expected) => {
    spawn.mockResolvedValue({ stdout: await readFixture(name), stderr: '', exitCode: 0 } as ExecaResult);
    const result = await invoke();
    expect(result).toMatchObject({ success: false, ...expected });
    if (name !== 'pi-1.0.0-e7-usage-exhausted.jsonl') {
      for (const property of ['usageExhausted', 'authFailure', 'modelUnavailable', 'waitSeconds']) expect(result).not.toHaveProperty(property);
    }
  });

  /** The E6 capture's retried error stops, then a terminal `stopReason: "stop"` text message. */
  const e6EarlierErrorStopsThenStop = async (text: string) => {
    const lines = (await readFixture('pi-1.0.0-e6-rate-limit.jsonl')).trim().split('\n');
    const isAssistantEnd = (line: string) => {
      const event = JSON.parse(line) as { type?: string; message?: { role?: string } };
      return event.type === 'message_end' && event.message?.role === 'assistant';
    };
    const terminal = lines.length - 1 - [...lines].reverse().findIndex(isAssistantEnd);
    const earlier = lines.slice(0, terminal);
    expect(earlier.filter((line) => line.includes('"stopReason":"error"') && line.includes('429: {\\"message\\":\\"Rate limit reached for requests'))).toHaveLength(3);
    return [...earlier, textStream(text), JSON.stringify({ type: 'agent_end', willRetry: false }), JSON.stringify({ type: 'auto_retry_end', success: true, attempt: 3 })].join('\n');
  };

  it('uses a sanitized rate-limit result and classifies only terminal error stops', async () => {
    spawn.mockResolvedValueOnce({ stdout: await readFixture('pi-1.0.0-e6-rate-limit.jsonl'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: await readFixture('pi-1.0.0-e9-server-error.jsonl'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: errorStream('upstream said 429: busy'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: textStream('HTTP 429: rate limit reached'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: await e6EarlierErrorStopsThenStop('completed after earlier errors'), stderr: '', exitCode: 0 } as ExecaResult);
    const rateLimited = await invoke();
    expect(rateLimited.output).toBe('Pi request was rate-limited by its upstream provider.');
    for (const forbidden of ['Rate limit reached for requests', 'rate_limit_exceeded', '{"message"']) expect(rateLimited.output).not.toContain(forbidden);
    for (const result of [await invoke(), await invoke()]) {
      expect(result).not.toHaveProperty('rateLimited');
      expect(result).not.toHaveProperty('usageExhausted');
      expect(result).not.toHaveProperty('authFailure');
    }
    for (const result of [await invoke(), await invoke()]) {
      expect(result).toMatchObject({ success: true });
      expect(result).not.toHaveProperty('rateLimited');
    }
  });

  it('requires an anchored 429 and quota vocabulary for usage exhaustion', async () => {
    spawn.mockResolvedValueOnce({ stdout: errorStream('429: Monthly usage limit reached'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: errorStream('500: insufficient_quota'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: errorStream('402: Insufficient Balance'), stderr: '', exitCode: 0 } as ExecaResult);
    const exhausted = await invoke();
    expect(exhausted).toMatchObject({ usageExhausted: true, rateLimited: true, waitSeconds: 3600, output: 'Pi upstream provider usage is exhausted.' });
    for (const forbidden of ['insufficient_quota', 'billing details']) expect(exhausted.output).not.toContain(forbidden);
    for (const result of [await invoke(), await invoke()]) {
      expect(result).not.toHaveProperty('usageExhausted');
      expect(result).not.toHaveProperty('rateLimited');
    }
  });

  it('classifies Pi authentication from stderr and an error stop', async () => {
    const stderr = await readFixture('pi-1.0.0-e1-no-api-key.stderr.txt');
    spawn.mockResolvedValueOnce({ stdout: '', stderr, exitCode: 1 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: '', stderr: `Warning: Model "x" not found for provider "deepseek". Using custom model id.\n${stderr}`, exitCode: 1 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: errorStream('No API key for provider: cline'), stderr: '', exitCode: 0 } as ExecaResult);
    const expected = { provider: 'pi', source: 'cached-login', state: 'missing' };
    for (const result of [await invoke(), await invoke(), await invoke()]) {
      expect(result.authFailure).toBe(true);
      expect(result.authentication).toEqual(expected);
    }
  });

  it('classifies each captured rejected credential without leaking its diagnostic', async () => {
    const authFixtures = ['pi-1.0.0-e2-invalid-key-deepseek.jsonl', 'pi-1.0.0-e3-invalid-key-openrouter.jsonl', 'pi-1.0.0-e4-invalid-key-anthropic.jsonl', 'pi-1.0.0-e5-oauth-refresh-failed.jsonl'];
    for (const name of authFixtures) spawn.mockResolvedValueOnce({ stdout: await readFixture(name), stderr: '', exitCode: 0 } as ExecaResult);
    spawn.mockResolvedValueOnce({ stdout: '', stderr: 'Authentication failed for "anthropic". Credentials may have expired', exitCode: 1 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: textStream('401: Unauthorized'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: errorStream('403: Forbidden'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: '', stderr: 'Error: Model "nonexistent-model-xyz" not found. Use --list-models to see available models.', exitCode: 1 } as ExecaResult);
    const results = await Promise.all(authFixtures.map(() => invoke()));
    for (const result of results) expect(result).toMatchObject({ authFailure: true, authentication: { provider: 'pi', source: 'cached-login', state: 'unusable' } });
    expect(results[0]?.output).toBe('Pi authentication failed: the upstream provider credential is missing or was rejected.');
    for (const forbidden of ['****0000', 'request_id', 'Authentication Fails', '{"message"', 'invalid_grant', 'platform.claude.com', 'stack=']) expect(results.flatMap((result) => [result.output]).join('\n')).not.toContain(forbidden);
    expect(await invoke()).toMatchObject({ authFailure: true, authentication: { state: 'unusable' } });
    for (const result of [await invoke(), await invoke()]) {
      expect(result).toMatchObject({ success: result.output === '401: Unauthorized' });
      expect(result).not.toHaveProperty('authFailure');
    }
    const unavailable = await invoke();
    expect(unavailable).toMatchObject({ modelUnavailable: true });
    expect(unavailable).not.toHaveProperty('authFailure');
  });

  it('leaves unanchored failures ordinary', async () => {
    spawn.mockResolvedValue({ stdout: errorStream('upstream said 429: busy'), stderr: '', exitCode: 0 } as ExecaResult);
    const result = await invoke();
    expect(result).not.toHaveProperty('rateLimited');
    expect(result).not.toHaveProperty('authFailure');
  });

  it('keeps unmatched stderr and warning-prefixed error stops as ordinary failures', async () => {
    spawn.mockResolvedValueOnce({ stdout: '', stderr: 'boom: tool crashed', exitCode: 1 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: await readFixture('error-stop-live-capture.jsonl'), stderr: '', exitCode: 0 } as ExecaResult)
      .mockResolvedValueOnce({ stdout: errorStream('Warning: 429 retries scheduled'), stderr: '', exitCode: 0 } as ExecaResult);
    const crashed = await invoke();
    expect(crashed.exitFacts).toBeDefined();
    for (const property of ['authFailure', 'rateLimited', 'usageExhausted', 'modelUnavailable', 'providerUnavailable']) expect(crashed).not.toHaveProperty(property);
    const captured = await invoke();
    expect(captured).toMatchObject({ success: false, output: 'Free tier request failed.' });
    expect(captured).not.toHaveProperty('authFailure');
    expect((await invoke())).not.toHaveProperty('rateLimited');
  });
});

describe('parsePiModelId', () => {
  it.each([
    ['anthropic/claude-opus-4-5', { provider: 'anthropic', model: 'claude-opus-4-5' }],
    ['cline/google/gemma-4-31b-it:free', { provider: 'cline', model: 'google/gemma-4-31b-it:free' }],
  ])('splits canonical id %s at its first separator only', (modelId, expected) => {
    expect(parsePiModelId(modelId)).toEqual(expected);
  });

  it.each([
    ['claude-opus-4-5', 'missing-separator'],
    ['anthropic/', 'empty-model'],
    ['/claude-opus-4-5', 'empty-provider'],
    ['anthropic/claude opus-4-5', 'whitespace'],
  ] as const)('rejects invalid Pi id %j with reason %s', (modelId, reason) => {
    expect(parsePiModelId(modelId)).toEqual({ reason });
  });
});

/**
 * Captured-style Pi `--mode json` records. `tool_execution_end` mirrors
 * pi-agent-core agent-loop emitToolExecutionEnd: `{ toolCallId, toolName, result, isError }`,
 * where a tool's thrown error becomes `isError: true` with empty details.
 */
const piLine = (event: Record<string, unknown>) => JSON.stringify(event);
const assistantEnd = piLine({
  type: 'message_end',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Submitted.' }], stopReason: 'stop' },
});
const submitEnd = (details: unknown, isError = false) => piLine({
  type: 'tool_execution_end',
  toolCallId: `call-${Math.random().toString(36).slice(2)}`,
  toolName: 'submit_result',
  result: { content: [{ type: 'text', text: isError ? 'validation failed' : 'Result submitted.' }], details },
  isError,
});

describe('PiProvider native output schema', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  const materializeExtension = vi.fn(async () => '/engine-home/.ai-conductor/pi/harness-extension-0123456789abcdef.ts');
  const schema = { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] };
  let worktree: string;
  let scratchHome: string;
  let provider: PiProvider;

  const respond = (lines: string[]) => spawn.mockResolvedValue({ stdout: lines.join('\n'), stderr: '', exitCode: 0 } as ExecaResult);
  const schemaInvoke = (overrides: Partial<InvokeOptions> = {}) => provider.invoke({
    ...invokeOptions,
    cwd: worktree,
    nativeSchema: schema,
    nativeSchemaScratchHome: scratchHome,
    nativeSchemaScratchRoot: worktree,
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    worktree = await mkdtemp(join(tmpdir(), 'pi-native-schema-'));
    scratchHome = join(worktree, '.daemon', 'scratch', 'run-1', 'pi');
    await mkdir(scratchHome, { recursive: true });
    provider = new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, harnessedPiEnvironment(), materializeExtension);
    respond([submitEnd({ verdict: 'pass' }), assistantEnd]);
  });
  afterEach(async () => { await rm(worktree, { recursive: true, force: true }); });

  it('writes a self-host schema when the invocation cwd is a review checkout other than the home owner', async () => {
    const reviewCheckout = await mkdtemp(join(tmpdir(), 'pi-self-host-schema-review-checkout-'));
    try {
      await schemaInvoke({
        cwd: reviewCheckout,
        nativeSchemaScratchHome: undefined,
        nativeSchemaScratchRoot: undefined,
        selfHost: { executable: '/resolved/pi', args: [], teardown: async () => {}, env: { PI_HOME: scratchHome }, scratchRoot: worktree },
      });

      expect(JSON.parse(await readFile(join(scratchHome, 'output-schema.json'), 'utf8'))).toEqual(schema);
    } finally {
      await rm(reviewCheckout, { recursive: true, force: true });
    }
  });

  it('writes the schema into the scratch home and passes -e «asset» plus the schema flag', async () => {
    await schemaInvoke();

    const schemaPath = join(scratchHome, 'output-schema.json');
    expect(JSON.parse(await readFile(schemaPath, 'utf8'))).toEqual(schema);
    const args = spawn.mock.calls[0]![1];
    expect(args[args.indexOf('-e') + 1]).toBe('/engine-home/.ai-conductor/pi/harness-extension-0123456789abcdef.ts');
    expect(args[args.indexOf('--conduct-output-schema') + 1]).toBe(schemaPath);
    expect(args.filter((arg) => arg === '-e')).toHaveLength(1);
    expect(provider.nativeSchemaCapability.nativeOutputSchema).toBe(true);
  });

  it('passes no schema flag, no harness asset and no submit_result tool without a native schema', async () => {
    respond([assistantEnd]);

    await provider.invoke(invokeOptions);

    const args = spawn.mock.calls[0]![1];
    expect(args).not.toContain('--conduct-output-schema');
    expect(args).not.toContain('-e');
    expect(args.join(' ')).not.toContain('submit_result');
    expect(materializeExtension).not.toHaveBeenCalled();
  });

  it('reports a terminal E6 rate limit before checking for a structured result', async () => {
    spawn.mockResolvedValue({ stdout: await readFixture('pi-1.0.0-e6-rate-limit.jsonl'), stderr: '', exitCode: 0 } as ExecaResult);

    const result = await schemaInvoke();

    expect(result).toMatchObject({ success: false, rateLimited: true });
    expect(result.output).not.toContain('missing structured result');
  });

  // Covers: task:8
  it('marks a native-schema setup failure as not started before spawning pi', async () => {
    const missingHome = join(worktree, '.daemon', 'scratch', 'run-1', 'absent');

    const result = await schemaInvoke({ nativeSchemaScratchHome: missingHome });

    expect(result.success).toBe(false);
    expect(result.executionDisposition).toBe('not-started');
    expect(result.output).toContain(join(missingHome, 'output-schema.json'));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns the details of the last successful submit_result as finalStructuredResult', async () => {
    const result = await schemaInvoke();

    expect(result).toMatchObject({ success: true, finalStructuredResult: { verdict: 'pass' } });
  });

  it('takes the last of two successful submit_result calls', async () => {
    respond([submitEnd({ verdict: 'fail' }), submitEnd({ verdict: 'pass' }), assistantEnd]);

    const result = await schemaInvoke();

    expect(result.finalStructuredResult).toEqual({ verdict: 'pass' });
  });

  it('ignores a later failed submit_result after a successful one', async () => {
    respond([submitEnd({ verdict: 'pass' }), submitEnd({}, true), assistantEnd]);

    const result = await schemaInvoke();

    expect(result.finalStructuredResult).toEqual({ verdict: 'pass' });
  });

  it('fails naming the missing structured result when no submit_result ends', async () => {
    respond([assistantEnd]);

    const result = await schemaInvoke();

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing structured result/);
    expect(result).not.toHaveProperty('finalStructuredResult');
  });

  it('fails naming the missing structured result when the only submit_result is an error', async () => {
    respond([submitEnd({}, true), assistantEnd]);

    const result = await schemaInvoke();

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing structured result/);
    expect(result).not.toHaveProperty('finalStructuredResult');
  });
});

describe('PiProvider trust_project_files', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  beforeEach(() => {
    vi.clearAllMocks();
    spawn.mockResolvedValue({
      stdout: assistantEnd,
      stderr: '',
      exitCode: 0,
    } as ExecaResult);
  });

  it.each([
    ['absent', undefined],
    ['false', false],
  ] as const)('passes -na and never -a/--approve/--no-extensions when trust is %s', async (_label, trustProjectFiles) => {
    await new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, harnessedPiEnvironment()).invoke({ ...invokeOptions, trustProjectFiles });

    const args = spawn.mock.calls[0]![1];
    expect(args).toContain('-na');
    expect(args).not.toContain('-a');
    expect(args).not.toContain('--approve');
    expect(args).not.toContain('--no-extensions');
  });

  it('omits -na and --no-extensions when trust_project_files opts in', async () => {
    await new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, harnessedPiEnvironment()).invoke({ ...invokeOptions, trustProjectFiles: true });

    const args = spawn.mock.calls[0]![1];
    expect(args).not.toContain('-na');
    expect(args).not.toContain('--no-extensions');
  });
});

describe('PiProvider subagents', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  const packageDir = '/home/agent/.pi/agent/npm/node_modules/pi-subagents';
  let isolatedHome: string;
  const installed = () => fakePiEnvironment({ files: ['/home/agent/.agents/skills/HARNESS.md', `${packageDir}/package.json`] }).environment;

  beforeEach(async () => {
    vi.clearAllMocks();
    spawn.mockResolvedValue({ stdout: assistantEnd, stderr: '', exitCode: 0 } as ExecaResult);
    isolatedHome = await mkdtemp(join(tmpdir(), 'pi-subagents-home-'));
  });
  afterEach(async () => {
    await rm(isolatedHome, { recursive: true, force: true });
  });

  it('loads the installed extension, seeds the isolated home, and scopes its temp root there', async () => {
    await new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, installed()).invoke({
      ...invokeOptions,
      subagents: true,
      selfHost: { executable: '/resolved/pi', args: [], teardown: async () => {}, env: { PI_CODING_AGENT_DIR: isolatedHome } },
    });

    const [, args, options] = spawn.mock.calls[0]!;
    expect(args.join(' ')).toContain(`-e ${packageDir} --exclude-tools subagents_enable`);
    expect(JSON.parse(await readFile(join(isolatedHome, 'extensions', 'subagent', 'config.json'), 'utf8')))
      .toEqual({ asyncByDefault: false, toolActivation: 'eager', maxSubagentDepth: 1 });
    expect(JSON.parse(await readFile(join(isolatedHome, 'settings.json'), 'utf8')))
      .toEqual({ subagents: { agentOverrides: { delegate: { model: 'inherit' } }, defaultThinking: 'xhigh' } });
    expect((options.env as NodeJS.ProcessEnv).PI_SUBAGENTS_TEMP_ROOT).toBe(join(isolatedHome, 'subagents-tmp'));
  });

  it.each([
    ['disabled', { subagents: false }],
    ['a read-only review', { subagents: true, readOnlyReview: true }],
    ['a schema-constrained dispatch', { subagents: true, nativeSchema: { name: 'x', schema: { type: 'object' } } }],
  ])('does not load the extension when %s', async (_label, extra) => {
    await new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, installed(), vi.fn(async () => '/asset.ts')).invoke({
      ...invokeOptions,
      ...extra,
      nativeSchemaScratchHome: isolatedHome,
      selfHost: { executable: '/resolved/pi', args: [], teardown: async () => {}, env: { PI_CODING_AGENT_DIR: isolatedHome } },
    });

    const args = spawn.mock.calls[0]?.[1] ?? [];
    expect(args).not.toContain(packageDir);
    expect(args).not.toContain('subagents_enable');
  });

  // Covers: task:8
  it('marks a missing subagents package as not started before spawning', async () => {
    const result = await new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, harnessedPiEnvironment()).invoke({ ...invokeOptions, subagents: true });

    expect(result).toMatchObject({
      success: false,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      executionDisposition: 'not-started',
    });
    expect(result.output).toContain('pi install npm:pi-subagents');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('never writes into the operator agent dir when no isolated home is in force', async () => {
    await new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, installed()).invoke({ ...invokeOptions, subagents: true });

    const [, args, options] = spawn.mock.calls[0]!;
    expect(args).toContain(packageDir);
    expect((options.env as NodeJS.ProcessEnv).PI_SUBAGENTS_TEMP_ROOT).toBeUndefined();
  });
});

describe('PiProvider read-only review argv', () => {
  const spawn = vi.fn<PiSubprocessFactory>();
  const asset = '/engine-home/.ai-conductor/pi/harness-extension-0123456789abcdef.ts';
  const materializeExtension = vi.fn(async () => asset);
  let worktree: string;
  let scratchHome: string;

  const toolsValue = (args: readonly string[]) => args[args.indexOf('--tools') + 1];
  const invokeReadOnly = (overrides: Partial<InvokeOptions> = {}) =>
    new PiProvider(dispatchGitGuard, '/resolved/pi', spawn, harnessedPiEnvironment(), materializeExtension).invoke({ ...invokeOptions, cwd: worktree, readOnlyReview: true, ...overrides });

  beforeEach(async () => {
    vi.clearAllMocks();
    worktree = await mkdtemp(join(tmpdir(), 'pi-read-only-'));
    scratchHome = join(worktree, '.daemon', 'scratch', 'run-1', 'pi');
    await mkdir(scratchHome, { recursive: true });
    spawn.mockResolvedValue({ stdout: [submitEnd({ verdict: 'pass' }), assistantEnd].join('\n'), stderr: '', exitCode: 0 } as ExecaResult);
  });
  afterEach(async () => { await rm(worktree, { recursive: true, force: true }); });

  it('restricts tools to read,grep,find,ls,git_read and loads only the harness asset', async () => {
    await invokeReadOnly();

    const args = spawn.mock.calls[0]![1];
    expect(args).toContain('--no-extensions');
    expect(args).toContain('-na');
    expect(args).toContain('--conduct-git-read');
    expect(toolsValue(args)).toBe('read,grep,find,ls,git_read');
    expect(args[args.indexOf('-e') + 1]).toBe(asset);
    expect(asset.startsWith('/')).toBe(true);
  });

  // Covers: task:9
  it('appends the system prompt after HARNESS.md without changing read-only restrictions', async () => {
    await invokeReadOnly();
    const baselineArgs = spawn.mock.calls[0]![1];
    let delivered: string | undefined;
    spawn.mockImplementationOnce(async (_file, args) => {
      const appendIndices = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
      const systemPromptPath = args[appendIndices[1]! + 1]!;
      delivered = await readFile(systemPromptPath, 'utf8');
      await rm(dirname(systemPromptPath), { recursive: true, force: true });
      return { stdout: [submitEnd({ verdict: 'pass' }), assistantEnd].join('\n'), stderr: '', exitCode: 0 } as ExecaResult;
    });

    await invokeReadOnly({ systemPrompt: 'S' });

    const args = spawn.mock.calls[1]![1];
    const appendIndices = args.flatMap((value, index) => value === '--append-system-prompt' ? [index] : []);
    expect({
      harnessFirst: appendIndices[0]! < appendIndices[1]!,
      harness: args[appendIndices[0]! + 1],
      delivered,
      noExtensions: args.includes('--no-extensions'),
      tools: toolsValue(args),
      conductGitRead: args.includes('--conduct-git-read'),
    }).toEqual({
      harnessFirst: true,
      harness: '/home/agent/.agents/skills/HARNESS.md',
      delivered: 'S',
      noExtensions: baselineArgs.includes('--no-extensions'),
      tools: toolsValue(baselineArgs),
      conductGitRead: baselineArgs.includes('--conduct-git-read'),
    });
  });

  it('adds submit_result to the tools when a native schema is requested', async () => {
    await invokeReadOnly({ nativeSchema: { type: 'object' }, nativeSchemaScratchHome: scratchHome, nativeSchemaScratchRoot: worktree });

    expect(toolsValue(spawn.mock.calls[0]![1])).toBe('read,grep,find,ls,git_read,submit_result');
  });

  it('never names a write or shell tool', async () => {
    await invokeReadOnly();
    await invokeReadOnly({ nativeSchema: { type: 'object' }, nativeSchemaScratchHome: scratchHome, nativeSchemaScratchRoot: worktree });

    for (const [, args] of spawn.mock.calls) {
      const tools = toolsValue(args)!.split(',');
      for (const forbidden of ['bash', 'edit', 'write', 'powershell']) expect(tools).not.toContain(forbidden);
    }
  });

  it('loads exactly one extension, the harness asset, even when the cwd has .pi/extensions', async () => {
    await mkdir(join(worktree, '.pi', 'extensions'), { recursive: true });
    await writeFile(join(worktree, '.pi', 'extensions', 'evil.ts'), 'export default () => {}');

    await invokeReadOnly();

    const args = spawn.mock.calls[0]![1];
    expect(args).toContain('-na');
    expect(args).toContain('--no-extensions');
    expect(args.filter((arg) => arg === '-e' || arg === '--extension')).toHaveLength(1);
    expect(args[args.indexOf('-e') + 1]).toBe(asset);
  });

  it('keeps -na when trust_project_files opts in', async () => {
    await invokeReadOnly({ trustProjectFiles: true });

    expect(spawn.mock.calls[0]![1]).toContain('-na');
  });
});
