import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const smokeCapability = 'toolchain';
void smokeCapability;

const probeToken = 'github-bot-credential-smoke-probe';
const storedToken = 'operator-store-token-must-not-win';
const execFileP = promisify(execFile);

function hasBinary(binary: string): boolean {
  try {
    execFileSync('which', [binary], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const unavailableBinaries = ['gh', 'git'].filter((binary) => !hasBinary(binary));

function ghWriteEnvironment(home: string, root: string): NodeJS.ProcessEnv {
  // Matches makeProductionGh's configured write child environment.
  return { ...process.env, HOME: home, TMPDIR: root, GH_TOKEN: probeToken };
}

function gitWriteEnvironment(home: string, root: string, globalConfig: string): NodeJS.ProcessEnv {
  // Matches makeProductionGit/makeGitRunner's configured HTTPS write child environment.
  return {
    ...process.env,
    HOME: home,
    TMPDIR: root,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GH_TOKEN: probeToken,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_1: '!gh auth git-credential',
  };
}

function gitCredentialFill(cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`git credential fill failed: ${stderr}`)));
    child.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}

describe.skipIf(unavailableBinaries.length > 0)('real gh/git bot credential child environments', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function configureIsolatedCredentialHome(): Promise<{ home: string; globalConfig: string }> {
    root = await mkdtemp(join(tmpdir(), 'github-bot-credential-smoke-'));
    const home = join(root, 'home');
    const tokenFile = join(root, 'bot-token');
    const globalConfig = join(root, 'gitconfig');
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(tokenFile, `${probeToken}\n`);
    await writeFile(join(home, '.ai-conductor', 'config.yml'), `github_bot:\n  token_file: ${tokenFile}\n`);
    // The production child environment must reset this operator helper before
    // installing `gh auth git-credential` for the bot token.
    await writeFile(globalConfig, '[credential]\n\thelper = store\n');
    await writeFile(join(home, '.git-credentials'), `https://operator:${storedToken}@github.com\n`);

    return { home, globalConfig };
  }

  it('uses the gh write-path child token instead of ambient gh credentials', async () => {
    const { home } = await configureIsolatedCredentialHome();

    const result = await execFileP('gh', ['auth', 'token'], {
      cwd: home,
      env: ghWriteEnvironment(home, root!),
    });

    expect(String(result.stdout).trim()).toBe(probeToken);
  });

  it('uses the forced gh credential helper instead of the isolated global store', async () => {
    const { home, globalConfig } = await configureIsolatedCredentialHome();

    const result = await gitCredentialFill(home, gitWriteEnvironment(home, root!, globalConfig));

    expect(result).toContain(`password=${probeToken}`);
    expect(result).not.toContain(storedToken);
  });
});

describe.skipIf(unavailableBinaries.length === 0)('real gh/git bot credential child environments', () => {
  it(`skips with named reason: missing ${unavailableBinaries.join(', ')}`, () => {
    // This assertion gives the smoke runner attributable execution while the
    // real-binary scenarios above are deliberately skipped.
    expect(unavailableBinaries).not.toHaveLength(0);
  });
});
