import { startOperatorEventSpine } from './event-persister.js';
import { makeProductionGh, makeProductionGit, type GhRunner, type GitRunner } from './pr-labels.js';
import { runTrackerAmbientRead } from './tracker-client.js';
import { applyOpenPullRequestDeferral, docsPruneEvent, DocsPruneRefusal, publishDocsPrune, renderDocsPruneReport, resolveDocsPruneSelection, commitDocsPruneDeletion, type DocsPrunePublisher } from './docs-prune.js';
import { listPullRequestsWithFiles } from './pull-request-files.js';

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
    const outcome = applyOpenPullRequestDeferral(selection, prs, operatorLogin);
    let pullRequestUrl: string | undefined;
    if (outcome.removable.length) {
      const startPoint = (await git(['rev-parse', 'origin/main'], { cwd })).stdout.trim();
      const commit = await commitDocsPruneDeletion({ repoDir: cwd, startPoint, removable: outcome.removable, git });
      if (!deps.publish) throw new DocsPruneRefusal('docs-prune publication refused: guarded publisher is unavailable');
      const published = await deps.publish({ repoDir: cwd, repository: '', operatorLogin, branch: `docs-prune/${new Date().toISOString().slice(0, 10)}`, commit, outcome, openPullRequests: prs });
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
