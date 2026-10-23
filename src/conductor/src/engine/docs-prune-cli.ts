import { startOperatorEventSpine } from './event-persister.js';
import { makeProductionGh, makeProductionGit, type GhRunner, type GitRunner } from './pr-labels.js';
import { runTrackerAmbientRead } from './tracker-client.js';
import { applyOpenPullRequestDeferral, docsPruneEvent, DocsPruneRefusal, publishDocsPrune, renderDocsPruneReport, resolveDocsPruneSelection, commitDocsPruneDeletion, type DocsPrunePublisher } from './docs-prune.js';
import { listPullRequestsWithFiles } from './pull-request-files.js';
import { createGuardedGithubOperationRunner } from './tracker-client.js';
import { executeRemoteGit } from './remote-git-operations.js';
import { requestExplicitGithubOperationApproval, hasExplicitGithubOperationApproval } from './github-operation-approval.js';
import { createTerminalGithubOperationConfirmation } from './github-operation-terminal-confirmation.js';
import { decodeGithubOperationRequest } from './github-operations.js';

export type DocsPruneCommand = { kind: 'run' } | { kind: 'guide' };
export const DOCS_PRUNE_USAGE = 'conduct docs-prune';

export function detectDocsPruneCommand(argv: readonly string[]): DocsPruneCommand | null {
  if (argv[2] !== 'docs-prune') return null;
  return argv.length === 3 ? { kind: 'run' } : { kind: 'guide' };
}

export interface DocsPruneCliDependencies {
  git?: GitRunner;
  gh?: GhRunner;
  publish?: (input: Omit<DocsPrunePublisher, 'push' | 'operations'>) => Promise<{ pullRequestUrl?: string; branch: string }>;
  report?: (message: string) => void;
  reportError?: (message: string) => void;
  /** Testable interactive boundary; production defaults to the terminal prompt. */
  confirmation?: unknown;
}

/** Compose the only production publication path: guarded Git, guarded gh, and exact terminal approval. */
export function makeProductionDocsPrunePublisher(git: GitRunner, gh: GhRunner, cwd: string, confirmation: unknown = createTerminalGithubOperationConfirmation()): NonNullable<DocsPruneCliDependencies['publish']> {
  let approval: Awaited<ReturnType<typeof requestExplicitGithubOperationApproval>> | undefined;
  let repository = '';
  const approve = async (request: unknown): Promise<boolean> => {
    const decoded = decodeGithubOperationRequest(request);
    if (decoded.kind === 'refused') return false;
    approval = await requestExplicitGithubOperationApproval(decoded.request, confirmation);
    return approval.kind === 'approved';
  };
  const operations = createGuardedGithubOperationRunner(gh, {
    cwd,
    creation: {
      authorize: async (request) => {
        if (approval?.kind === 'approved' && hasExplicitGithubOperationApproval(approval.capability, request)) return { url: undefined };
        return { kind: 'refused' as const, reason: 'explicit-authorization-required' as const };
      },
    },
    mutation: undefined,
  });
  return async (input) => {
    repository = input.repository;
    return publishDocsPrune({ ...input, operations, approve, push: async (branch, commit, expectedHead) => {
      const request = approval;
      if (!request || request.kind !== 'approved') return { kind: 'refused', detail: 'explicit approval required' };
      const destination = `refs/heads/${branch}`;
      const push = ['push', 'origin', `${commit}:${destination}`];
      if (expectedHead) push.push(`--force-with-lease=${destination}:${expectedHead}`);
      const result = await executeRemoteGit(push, {
        cwd, config: (args) => git(args, { cwd }), runRemoteGit: git,
        explicitApproval: { capability: request.capability, request: { operation: 'remote-ref.push', access: 'remote-ref-write', target: { repository, kind: 'remote-ref', ref: `refs/heads/${branch}` }, context: { actor: input.operatorLogin } } },
      });
      return result.kind === 'executed' ? { kind: 'executed' as const } : { kind: 'refused' as const, detail: result.kind === 'failed' ? result.error : result.kind === 'refused' ? result.reason : 'not a remote write' };
    } });
  };
}

async function resolveDocsPruneRepository(gh: GhRunner, cwd: string): Promise<string> {
  const raw = await runTrackerAmbientRead(gh, cwd, 'ambient.repository.read', ['repo', 'view', '--json', 'nameWithOwner']);
  const repository = (JSON.parse(raw) as { nameWithOwner?: unknown }).nameWithOwner;
  if (typeof repository !== 'string' || !repository) throw new DocsPruneRefusal('docs-prune publication refused: repository resolution failed');
  return repository;
}

/** Operator-only cleanup orchestration.  All reads precede the temporary commit. */
export async function dispatchDocsPrune(cmd: DocsPruneCommand, cwd: string, deps: DocsPruneCliDependencies = {}): Promise<number> {
  const report = deps.report ?? console.log;
  const reportError = deps.reportError ?? console.error;
  if (cmd.kind === 'guide') { reportError(DOCS_PRUNE_USAGE); return 1; }
  const git = deps.git ?? makeProductionGit();
  const gh = deps.gh ?? makeProductionGh();
  const spine = startOperatorEventSpine(cwd);
  try {
    const selection = await resolveDocsPruneSelection(cwd, git);
    // This guarded complete reader must finish before a worktree or commit exists.
    const prs = await listPullRequestsWithFiles({ runGh: gh, cwd, state: 'OPEN' });
    const operatorLogin = (await runTrackerAmbientRead(gh, cwd, 'ambient.identity.read', ['api', 'user', '--jq', '.login'])).trim();
    const foreign = prs.find((pr) => pr.headRef.startsWith('docs-prune/') && pr.author !== operatorLogin);
    if (foreign) throw new DocsPruneRefusal(`docs-prune publication refused: another operator owns ${foreign.url}`);
    const outcome = applyOpenPullRequestDeferral(selection, prs, operatorLogin);
    let pullRequestUrl: string | undefined;
    if (outcome.removable.length) {
      const ownedPr = prs.find((pr) => pr.headRef.startsWith('docs-prune/') && pr.author === operatorLogin);
      let expectedHead: string | undefined;
      if (ownedPr) {
        await git(['fetch', 'origin', ownedPr.headRef], { cwd });
        expectedHead = (await git(['rev-parse', 'FETCH_HEAD'], { cwd })).stdout.trim();
      }
      // A refresh replaces the old prune commit with the complete selection from
      // current main. FETCH_HEAD protects that replacement only at push time.
      const startPoint = 'origin/main';
      const commit = await commitDocsPruneDeletion({ repoDir: cwd, startPoint, removable: outcome.removable, git });
      const publish = deps.publish ?? makeProductionDocsPrunePublisher(git, gh, cwd, deps.confirmation);
      const repository = await resolveDocsPruneRepository(gh, cwd);
      const published = await publish({ repoDir: cwd, repository, operatorLogin, branch: `docs-prune/${new Date().toISOString().slice(0, 10)}`, commit, expectedHead, outcome, openPullRequests: prs });
      pullRequestUrl = published.pullRequestUrl;
    }
    await spine.events.emitOrThrow(docsPruneEvent(outcome, pullRequestUrl));
    report(renderDocsPruneReport(outcome));
    return 0;
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
    return 1;
  } finally { spine.stop(); }
}

export { publishDocsPrune };
