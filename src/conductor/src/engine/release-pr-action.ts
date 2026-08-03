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
  findOpenReleasePullRequest(): Promise<{ number: number } | undefined>;
  createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number }>;
  updatePullRequest(input: { number: number; title: string; body: string }): Promise<void>;
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
  const existingFiles = await input.git.readBranchFiles(input.config.branch);
  const branchUpdated = !sameGeneratedFiles(existingFiles, input.generatedFiles);
  if (branchUpdated) {
    await input.git.pushGeneratedBranch({
      branch: input.config.branch,
      base: input.config.base,
      files: input.generatedFiles,
      message: `chore(release): prepare ${releaseVersion(input.generatedFiles.VERSION)}`,
    });
  }

  const existingPullRequest = await input.github.findOpenReleasePullRequest();
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
