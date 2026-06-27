// Shared acceptance helpers for Phase 9.3b intake specs.
// A fake `gh` runner: parses the argv it is given and returns canned JSON.
// No network. Mirrors the real GhRunner shape: (args, {cwd}) => Promise<{stdout}>.

export interface FakeIssue {
  repo: string; // "owner/repo"
  number: number;
  title: string;
  body: string;
  labels?: string[];
}

export interface FakePr {
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt: string | null;
}

export interface FakeGhState {
  issuesByRepo: Record<string, FakeIssue[]>;
  prs: Record<string, FakePr>; // keyed by pr url
  comments: Array<{ ref: string; body: string }>;
  appliedLabels: Array<{ ref: string; label: string }>;
  createdLabels: Array<{ repo: string; label: string }>;
  failRepos?: Set<string>; // repos whose `issue list` should error
}

export function makeFakeGh(state: FakeGhState) {
  const calls: string[][] = [];
  const gh = async (args: string[], _opts: { cwd: string }): Promise<{ stdout: string }> => {
    calls.push(args);
    // gh issue list --assignee @me --state open --json ... (per repo via -R or cwd)
    if (args[0] === 'issue' && args[1] === 'list') {
      const repo = repoFromArgs(args, _opts.cwd);
      if (state.failRepos?.has(repo)) {
        const err: any = new Error(`gh: not authenticated for ${repo}`);
        err.code = 1;
        throw err;
      }
      const issues = state.issuesByRepo[repo] ?? [];
      return { stdout: JSON.stringify(issues.map((i) => ({ number: i.number, title: i.title, body: i.body, labels: (i.labels ?? []).map((l) => ({ name: l })) }))) };
    }
    if (args[0] === 'issue' && args[1] === 'comment') {
      state.comments.push({ ref: refFromArgs(args), body: bodyFromArgs(args) });
      return { stdout: '' };
    }
    if (args[0] === 'issue' && args[1] === 'edit') {
      // label add
      const li = args.indexOf('--add-label');
      if (li >= 0) state.appliedLabels.push({ ref: refFromArgs(args), label: args[li + 1] });
      const lr = args.indexOf('--remove-label');
      if (lr >= 0) {
        const ref = refFromArgs(args);
        const label = args[lr + 1];
        const idx = state.appliedLabels.findIndex((a) => a.ref === ref && a.label === label);
        if (idx >= 0) state.appliedLabels.splice(idx, 1);
      }
      return { stdout: '' };
    }
    if (args[0] === 'label' && args[1] === 'create') {
      state.createdLabels.push({ repo: repoFromArgs(args, _opts.cwd), label: args[2] });
      return { stdout: '' };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const url = args[2];
      const pr = state.prs[url];
      if (!pr) {
        const err: any = new Error('no pr');
        err.code = 1;
        throw err;
      }
      return { stdout: JSON.stringify({ state: pr.state, mergedAt: pr.mergedAt }) };
    }
    return { stdout: '' };
  };
  return { gh, calls };
}

function repoFromArgs(args: string[], cwd: string): string {
  const ri = args.indexOf('-R');
  if (ri >= 0) return args[ri + 1];
  const ri2 = args.indexOf('--repo');
  if (ri2 >= 0) return args[ri2 + 1];
  // fall back to last path segment(s) of cwd
  return cwd.split('/').slice(-2).join('/');
}
function refFromArgs(args: string[]): string {
  // `issue comment <number> -R <repo>` or a full ref; reconstruct owner/repo#n
  const repo = repoFromArgs(args, '');
  const num = args[2];
  return `${repo}#${num}`;
}
function bodyFromArgs(args: string[]): string {
  const bi = args.indexOf('--body');
  return bi >= 0 ? args[bi + 1] : '';
}

/** A registry reader stub returning the given repo descriptors. */
export function fakeRegistry(repos: Array<{ name: string; path: string }>) {
  return { list: async () => repos };
}

/** Deterministic clock + id for reproducible Envelopes. */
export function fixedClock(seedIso = '2026-06-27T00:00:00.000Z') {
  let n = 0;
  return {
    now: () => new Date(Date.parse(seedIso) + n++ * 1000).toISOString(),
    id: () => `env-${n}`,
  };
}
