/**
 * The release-maintenance boundary deliberately accepts only injected Git and
 * GitHub adapters.  Workflow authentication is configured outside this module;
 * this action never reads an ambient token or shells out through a personal CLI.
 */
export interface ReleasePrConfig {
  branch: string;
  base: string;
  appLogin: string;
}

export interface ReleasePrGit {
  readBranchFiles(branch: string): Promise<Record<string, string> | undefined>;
  pushGeneratedBranch(input: {
    branch: string;
    base: string;
    files: Record<string, string>;
    message: string;
  }): Promise<void>;
}

export interface ReleasePrGithub {
  findOpenReleasePullRequest(): Promise<ReleasePullRequest | undefined>;
  createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number }>;
  updatePullRequest(input: { number: number; title: string; body: string }): Promise<void>;
}

/** The complete remote identity required before this action may mutate its branch. */
export interface ReleasePullRequest {
  number: number;
  author: string;
  head: string;
  base: string;
}

export interface ReleasePrActionInput {
  git: ReleasePrGit;
  github: ReleasePrGithub;
  config: ReleasePrConfig;
  generatedFiles: Record<string, string>;
  title: string;
  body: string;
}

export type ReleasePrActionResult = {
  action: 'created' | 'updated';
  pullRequestNumber: number;
  branchUpdated: boolean;
};

/** Create the designated release PR or update its generated release surfaces. */
export async function runReleasePrAction(input: ReleasePrActionInput): Promise<ReleasePrActionResult> {
  assertAppIdentity(input.config.appLogin);
  const existingPullRequest = await input.github.findOpenReleasePullRequest();
  if (existingPullRequest !== undefined) {
    assertOwnedPullRequest(existingPullRequest, input.config);
  }

  const existingFiles = await input.git.readBranchFiles(input.config.branch);
  assertNoForeignBranchFiles(existingFiles, input.generatedFiles);
  const branchUpdated = !sameGeneratedFiles(existingFiles, input.generatedFiles);
  if (branchUpdated) {
    await input.git.pushGeneratedBranch({
      branch: input.config.branch,
      base: input.config.base,
      files: input.generatedFiles,
      message: `chore(release): prepare ${releaseVersion(input.generatedFiles.VERSION)}`,
    });
  }

  if (existingPullRequest === undefined) {
    const created = await input.github.createPullRequest({
      head: input.config.branch,
      base: input.config.base,
      title: input.title,
      body: input.body,
    });
    return { action: 'created', pullRequestNumber: created.number, branchUpdated };
  }

  await input.github.updatePullRequest({
    number: existingPullRequest.number,
    title: input.title,
    body: input.body,
  });
  return { action: 'updated', pullRequestNumber: existingPullRequest.number, branchUpdated };
}

function assertAppIdentity(appLogin: string): void {
  if (appLogin.trim() === '') {
    throw new Error('Release maintenance requires a configured App identity');
  }
}

function assertOwnedPullRequest(pullRequest: ReleasePullRequest, config: ReleasePrConfig): void {
  if (pullRequest.author !== config.appLogin) {
    throw new Error(`Existing release PR owner does not match configured App identity: ${pullRequest.author}`);
  }
  if (pullRequest.base !== config.base) {
    throw new Error(`Existing release PR base does not match configured base: ${pullRequest.base}`);
  }
  if (pullRequest.head !== config.branch) {
    throw new Error(`Existing release PR head does not match configured branch: ${pullRequest.head}`);
  }
}

function assertNoForeignBranchFiles(
  current: Record<string, string> | undefined,
  generated: Record<string, string>,
): void {
  if (current === undefined) return;
  const foreignPaths = Object.keys(current).filter((path) => !(path in generated)).sort();
  if (foreignPaths.length > 0) {
    throw new Error(`Release branch contains foreign edits outside generated surfaces: ${foreignPaths.join(', ')}`);
  }
}

function sameGeneratedFiles(
  current: Record<string, string> | undefined,
  generated: Record<string, string>,
): boolean {
  if (current === undefined) return false;
  const currentPaths = Object.keys(current).sort();
  const generatedPaths = Object.keys(generated).sort();
  return currentPaths.length === generatedPaths.length
    && currentPaths.every((path, index) => path === generatedPaths[index] && current[path] === generated[path]);
}

function releaseVersion(versionFile: string | undefined): string {
  if (versionFile === undefined) return 'candidate';
  const version = versionFile.trim();
  return version === '' ? 'candidate' : version;
}
