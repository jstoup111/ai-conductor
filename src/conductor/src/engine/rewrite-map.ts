import type { FlattenedReplayPlan, GitRunner } from './rebase.js';

/** Result of matching pre-image commits to their post-replay counterparts. */
export interface RewriteMapResult {
  /** Old sha (full and seven-character) to new full sha. */
  map: Record<string, string>;
  /** Full pre-image shas with no patch-id match post-replay. */
  residue: string[];
}

const SHORT_SHA_LEN = 7;

type GitRunnerWithInput = (
  args: string[],
  opts?: { input?: string },
) => Promise<{ stdout: string }>;

function parseShaList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function patchIdFor(git: GitRunnerWithInput, sha: string): Promise<string> {
  const diffText = (await git(['show', sha])).stdout;
  const [id] = (await git(['patch-id', '--stable'], { input: diffText })).stdout.trim().split(/\s+/);
  return id ?? '';
}

async function buildRewriteMapBetweenRanges(
  git: GitRunner,
  preImageBase: string,
  origHead: string,
  postImageBase: string,
  head: string,
  flatten?: FlattenedReplayPlan,
): Promise<RewriteMapResult> {
  const gitAny = git as unknown as GitRunnerWithInput;
  const [preResult, postResult] = await Promise.all([
    gitAny(['rev-list', `${preImageBase}..${origHead}`]),
    gitAny(['rev-list', `${postImageBase}..${head}`]),
  ]);
  const preShas = parseShaList(preResult.stdout);
  const postByPatchId = new Map<string, string>();
  for (const postSha of parseShaList(postResult.stdout)) {
    const id = await patchIdFor(gitAny, postSha);
    if (id) postByPatchId.set(id, postSha);
  }

  const map: Record<string, string> = {};
  const residue: string[] = [];
  for (const preSha of preShas) {
    const id = await patchIdFor(gitAny, preSha);
    const postSha = id ? postByPatchId.get(id) : undefined;
    if (postSha) {
      map[preSha] = postSha;
      map[preSha.slice(0, SHORT_SHA_LEN)] = postSha;
    } else {
      residue.push(preSha);
    }
  }

  if (flatten) {
    const add = (from: string, to: string) => {
      if (map[from] !== undefined || map[from.slice(0, SHORT_SHA_LEN)] !== undefined) return;
      map[from] = to;
      map[from.slice(0, SHORT_SHA_LEN)] = to;
      const index = residue.indexOf(from);
      if (index >= 0) residue.splice(index, 1);
    };
    for (const pair of flatten.pairs) {
      const id = await patchIdFor(gitAny, pair.to);
      const post = id ? postByPatchId.get(id) : undefined;
      if (post) add(pair.from, post);
    }
    for (const point of flatten.absorptionPoints) {
      const post = map[point.to] ?? map[point.to.slice(0, SHORT_SHA_LEN)];
      if (post) add(point.from, post);
    }
  }
  return { map, residue };
}

export async function buildRewriteMap(
  git: GitRunner,
  onto: string,
  origHead: string,
  head: string,
  flatten?: FlattenedReplayPlan,
): Promise<RewriteMapResult> {
  return buildRewriteMapBetweenRanges(git, onto, origHead, onto, head, flatten);
}

/** Builds a correspondence where the replay's pre- and post-image bases differ. */
export async function buildRewriteMapForRanges(
  git: GitRunner,
  preImageBase: string,
  origHead: string,
  postImageBase: string,
  head: string,
  flatten?: FlattenedReplayPlan,
): Promise<RewriteMapResult> {
  return buildRewriteMapBetweenRanges(git, preImageBase, origHead, postImageBase, head, flatten);
}
