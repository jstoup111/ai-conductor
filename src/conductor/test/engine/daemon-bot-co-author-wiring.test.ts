// Covers: task:5
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

type SourceMap = Readonly<Record<string, string>>;

const BOT_INSTALL = 'installDaemonBotCoAuthor(';
const PROCESS_INSTALL = 'installDaemonProcessServices(';
const BOOTSTRAP = 'src/engine/daemon-process-bootstrap.ts';
const BOT_CO_AUTHOR = 'src/engine/bot-co-author.ts';
const DAEMON_CLI = 'src/daemon-cli.ts';
const EXECUTOR_CHILD = 'src/engine/executor-child-runtime.ts';

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function requiredSource(sources: SourceMap, path: string): string {
  const source = sources[path];
  if (source === undefined) throw new Error(`missing source file: ${path}`);
  return source;
}

function assertDaemonCoAuthorWiring(sources: SourceMap): void {
  const botInstallFiles = Object.entries(sources)
    .filter(([, source]) => source.includes(BOT_INSTALL))
    .map(([path]) => path);
  for (const path of botInstallFiles) {
    if (path !== BOT_CO_AUTHOR && path !== BOOTSTRAP) {
      throw new Error(`unexpected ${BOT_INSTALL} in ${path}`);
    }
  }
  for (const path of [BOT_CO_AUTHOR, BOOTSTRAP]) {
    if (occurrences(requiredSource(sources, path), BOT_INSTALL) !== 1) {
      throw new Error(`missing ${BOT_INSTALL} in ${path}`);
    }
  }

  const processInstallFiles = Object.entries(sources)
    .filter(([, source]) => source.includes(PROCESS_INSTALL))
    .map(([path]) => path);
  for (const path of processInstallFiles) {
    if (path !== BOOTSTRAP && path !== DAEMON_CLI && path !== EXECUTOR_CHILD) {
      throw new Error(`unexpected ${PROCESS_INSTALL} in ${path}`);
    }
  }

  const daemonCli = requiredSource(sources, DAEMON_CLI);
  if (occurrences(daemonCli, PROCESS_INSTALL) !== 1) {
    throw new Error(`missing ${PROCESS_INSTALL} in ${DAEMON_CLI}`);
  }
  if (daemonCli.indexOf(PROCESS_INSTALL) >= daemonCli.indexOf('makeRunFeature(')) {
    throw new Error(`${PROCESS_INSTALL} must precede makeRunFeature( in ${DAEMON_CLI}`);
  }

  const executorChild = requiredSource(sources, EXECUTOR_CHILD);
  const childRun = executorChild.indexOf('export function makeExecutorChildRun(');
  const processInstall = executorChild.indexOf(PROCESS_INSTALL);
  const runFeature = executorChild.indexOf('runFeature(', childRun);
  if (occurrences(executorChild, PROCESS_INSTALL) !== 1) {
    throw new Error(`missing ${PROCESS_INSTALL} in ${EXECUTOR_CHILD}`);
  }
  if (childRun < 0 || processInstall < childRun || runFeature < 0 || processInstall >= runFeature) {
    throw new Error(`${PROCESS_INSTALL} must precede runFeature( in makeExecutorChildRun in ${EXECUTOR_CHILD}`);
  }
}

async function readProductionSources(): Promise<Record<string, string>> {
  const sourceRoot = join(process.cwd(), 'src');
  const entries = await readdir(sourceRoot, { recursive: true });
  const files = entries.filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'));
  return Object.fromEntries(await Promise.all(files.map(async (entry) => {
    const path = join(sourceRoot, entry);
    return [relative(process.cwd(), path), await readFile(path, 'utf8')];
  })));
}

function validFixture(): SourceMap {
  return {
    [BOT_CO_AUTHOR]: 'export function installDaemonBotCoAuthor() {}',
    [BOOTSTRAP]: 'installDaemonBotCoAuthor();\nexport function installDaemonProcessServices() {}',
    [DAEMON_CLI]: 'installDaemonProcessServices();\nmakeRunFeature();',
    [EXECUTOR_CHILD]: 'export function makeExecutorChildRun() {\ninstallDaemonProcessServices();\nrunFeature();\n}',
  };
}

describe('daemon bot co-author wiring', () => {
  it('pins every daemon entry point to the shared bootstrap', async () => {
    assertDaemonCoAuthorWiring(await readProductionSources());
  });

  it('names malformed bootstrap wiring fixtures', () => {
    expect(() => assertDaemonCoAuthorWiring({
      ...validFixture(),
      'src/engine/foo.ts': 'installDaemonBotCoAuthor();',
    })).toThrow('src/engine/foo.ts');

    expect(() => assertDaemonCoAuthorWiring({
      ...validFixture(),
      [DAEMON_CLI]: 'makeRunFeature();',
    })).toThrow(DAEMON_CLI);

    expect(() => assertDaemonCoAuthorWiring({
      ...validFixture(),
      [EXECUTOR_CHILD]: 'export function makeExecutorChildRun() { runFeature(); }',
    })).toThrow(EXECUTOR_CHILD);
  });

  it('keeps default rebase-resolution and CI-fix preparation on the installed resolver path', async () => {
    const root = join(process.cwd(), 'src/engine');
    const [autoresolve, ciFix, prepare] = await Promise.all([
      readFile(join(root, 'autoresolve.ts'), 'utf8'),
      readFile(join(root, 'ci-fix.ts'), 'utf8'),
      readFile(join(root, 'worktree-prepare.ts'), 'utf8'),
    ]);

    expect(autoresolve).toContain('const prepare = prepareWorktree ?? defaultPrepareWorktree;');
    expect(ciFix).toContain('}, deps.prepareWorktree, deps.liveness ?? {});');
    expect(prepare).toContain('await refreshWorktreeCoAuthor(worktreePath, opts?.events, { dispatch: opts?.dispatchStart === true });');
  });
});
