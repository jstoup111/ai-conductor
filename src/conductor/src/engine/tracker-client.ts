/**
 * Canonical tracker-client seam — the single module through which all real
 * `gh` CLI invocations for tracker/PR operations must flow.
 *
 * Design constraints:
 *   - `assertRealExecAllowed` is the one guard; every production runner
 *     factory (in this module or elsewhere) must call it before spawning.
 *   - `GhRunner` is the canonical injectable shape — other modules re-export
 *     it rather than defining their own copy.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFileCb);

/**
 * Injectable runner for `gh` CLI commands.
 */
export type GhRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/**
 * Test kill-switch. When `AI_CONDUCTOR_NO_REAL_EXEC` is set (the vitest global setup
 * sets it — see `test/setup.ts`), the production `gh`/`git` runners refuse to
 * shell out. This is a belt-and-suspenders guard: every test is supposed to inject
 * a fake runner, but if one ever reaches a real runner (e.g. a daemon-mode test
 * that forgets to stub escalation), this prevents it from mutating real GitHub —
 * the exact failure mode that once labeled + commented on a live PR.
 */
export function assertRealExecAllowed(bin: string): void {
  if (process.env.AI_CONDUCTOR_NO_REAL_EXEC) {
    throw new Error(
      `tracker-client: real '${bin}' exec blocked under AI_CONDUCTOR_NO_REAL_EXEC (test env). ` +
        `Inject a fake runner instead of using makeProduction${bin === 'gh' ? 'Gh' : 'Git'}().`,
    );
  }
}

/** Construct the real gh runner used in production. */
export function makeProductionGh(): GhRunner {
  return async (args: string[], opts: { cwd: string }) => {
    assertRealExecAllowed('gh');
    const result = await execFileP('gh', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

/** Minimal shape of an assigned issue as returned by `gh issue list ... --json`. */
export interface AssignedIssue {
  number: number;
  title: string;
  body: string;
  labels: unknown;
}

/**
 * Canonical seam for tracker/PR read+write operations. GitHub is the only
 * implementation today; the interface is backend-agnostic so future trackers
 * can implement it without touching call sites.
 *
 * Only READ ops are defined here (Task 2); write ops land in Task 3.
 */
export interface TrackerClient {
  /** `gh api repos/<owner>/<repo>/issues/<number>` — returns label names. */
  getIssueLabels(repo: string, number: number, cwd: string): Promise<string[]>;
  /** `gh issue view <owner/repo#number> --json state` — raw stdout JSON. */
  viewIssue(slug: string, cwd: string): Promise<{ state: string }>;
  /** `gh issue view <owner/repo#number> --json state` — uppercased state string. */
  getIssueState(slug: string, cwd: string): Promise<string>;
  /** `gh api user --jq .login` — normalized viewer login. */
  viewerIdentity(cwd: string): Promise<string>;
  /** `gh api repos/<repo>/issues/<number>/dependencies/blocked_by` — raw JSON. */
  getBlockedBy(repo: string, number: number, cwd: string): Promise<unknown>;
  /** `gh issue list --assignee @me --state open --json ... -R <repo>` — assigned issues. */
  listAssignedIssues(repo: string, cwd: string): Promise<AssignedIssue[]>;
}

/** Construct a `TrackerClient` backed by the GitHub `gh` CLI via the given runner. */
export function createGithubTrackerClient(runner: GhRunner): TrackerClient {
  return {
    async getIssueLabels(repo, number, cwd) {
      const { stdout } = await runner(['api', `repos/${repo}/issues/${number}`], { cwd });
      const data = JSON.parse(stdout) as { labels?: Array<{ name: string }> | null };
      return (data.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
    },

    async viewIssue(slug, cwd) {
      const { stdout } = await runner(['issue', 'view', slug, '--json', 'state'], { cwd });
      return JSON.parse(stdout) as { state: string };
    },

    async getIssueState(slug, cwd) {
      const { state } = await this.viewIssue(slug, cwd);
      return String(state ?? '').toUpperCase();
    },

    async viewerIdentity(cwd) {
      const { stdout } = await runner(['api', 'user', '--jq', '.login'], { cwd });
      return stdout.trim();
    },

    async getBlockedBy(repo, number, cwd) {
      const { stdout } = await runner(
        ['api', `repos/${repo}/issues/${number}/dependencies/blocked_by`],
        { cwd },
      );
      return JSON.parse(stdout);
    },

    async listAssignedIssues(repo, cwd) {
      const { stdout } = await runner(
        [
          'issue',
          'list',
          '--assignee',
          '@me',
          '--state',
          'open',
          '--json',
          'number,title,body,labels',
          '-R',
          repo,
        ],
        { cwd },
      );
      return JSON.parse(stdout || '[]') as AssignedIssue[];
    },
  };
}
