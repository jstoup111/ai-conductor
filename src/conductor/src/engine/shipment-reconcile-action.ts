import { dispatchShipmentEvidence } from './shipment-evidence-cli.js';

interface GithubResponse<T> {
  data: T;
}

interface GithubClient {
  rest: {
    pulls: {
      get(input: { owner: string; repo: string; pull_number: number }): Promise<GithubResponse<{
        number: number;
        html_url: string;
        body?: string | null;
        head: { sha: string };
      }>>;
      listFiles(input: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: 100;
      }): Promise<GithubResponse<Array<{ filename: string; status: string }>>>;
      list(input: {
        owner: string;
        repo: string;
        state: 'open';
        head: string;
        base: string;
        per_page: 100;
      }): Promise<GithubResponse<Array<{ number: number; html_url: string }>>>;
      create(input: {
        owner: string;
        repo: string;
        head: string;
        base: string;
        title: string;
        body: string;
      }): Promise<GithubResponse<{ number: number; html_url: string }>>;
    };
    repos: {
      getBranch(input: {
        owner: string;
        repo: string;
        branch: string;
      }): Promise<GithubResponse<{ name: string; commit: { sha: string } }>>;
      createCommitStatus(input: {
        owner: string;
        repo: string;
        sha: string;
        state: string;
        context: string;
        description: string;
      }): Promise<GithubResponse<{ state: string; context: string }>>;
    };
  };
  paginate?: (method: unknown, input: unknown) => Promise<Array<{ filename: string; status: string }>>;
}

export function createShipmentReconcileGithubAdapter(input: {
  owner: string;
  repo: string;
  client: GithubClient;
}) {
  const { owner, repo, client } = input;

  const listRepairPullRequests = async ({
    branch,
    base,
    state,
    limit,
  }: {
    branch: string;
    base: string;
    state: 'open';
    limit: number;
  }) => {
    const { data } = await client.rest.pulls.list({
      owner,
      repo,
      state,
      head: `${owner}:${branch}`,
      base,
      per_page: 100,
    });
    return data
      .map((pullRequest) => ({ number: pullRequest.number, url: pullRequest.html_url }))
      .slice(0, limit);
  };

  const createRepairPullRequest = async ({
    branch,
    base,
    title,
    body,
  }: {
    branch: string;
    base: string;
    title: string;
    body: string;
  }) => {
    const { data } = await client.rest.pulls.create({ owner, repo, head: branch, base, title, body });
    return { number: data.number, url: data.html_url };
  };

  return {
    async getPullRequestMetadata({ pullNumber }: { pullNumber: number }) {
      const { data } = await client.rest.pulls.get({ owner, repo, pull_number: pullNumber });
      return { url: data.html_url, body: data.body ?? '', headSha: data.head.sha };
    },

    async listImplementationPullRequestFiles({ pullNumber }: { pullNumber: number }) {
      const request = { owner, repo, pull_number: pullNumber, per_page: 100 as const };
      const files = client.paginate
        ? await client.paginate(client.rest.pulls.listFiles, request)
        : (await client.rest.pulls.listFiles(request)).data;
      return files.map((file) => ({ path: file.filename, status: file.status }));
    },

    async getRepairBranch({ branch }: { branch: string }) {
      const { data } = await client.rest.repos.getBranch({ owner, repo, branch });
      return { name: data.name, headSha: data.commit.sha };
    },

    listRepairPullRequests,

    createRepairPullRequest,

    async getPullRequestHead({ pullNumber }: { pullNumber: number }) {
      const { data } = await client.rest.pulls.get({ owner, repo, pull_number: pullNumber });
      return data.head.sha;
    },

    async postCommitStatus({
      sha,
      state,
      context,
      description,
    }: {
      sha: string;
      state: string;
      context: string;
      description: string;
    }) {
      const { data } = await client.rest.repos.createCommitStatus({
        owner,
        repo,
        sha,
        state,
        context,
        description,
      });
      return { state: data.state, context: data.context };
    },
  };
}

type ShipmentReconcileGithubAdapter = ReturnType<typeof createShipmentReconcileGithubAdapter>;

export function createShipmentReconcileGhRunner(input: {
  adapter: ShipmentReconcileGithubAdapter;
  implementationPullRequest: { url: string; number: number };
}) {
  const pullNumbersByUrl = new Map([[input.implementationPullRequest.url, input.implementationPullRequest.number]]);
  const json = (value: unknown) => ({ stdout: JSON.stringify(value ?? {}) });

  const run = async (args: string[], _opts: { cwd: string }): Promise<{ stdout: string }> => {
    const [command, action, target, jsonFlag, fields] = args;

    if (command === 'pr' && action === 'view' && jsonFlag === '--json' && args.length === 5) {
      const pullNumber = target ? pullNumbersByUrl.get(target) : undefined;
      if (pullNumber === undefined) throw new Error(`shipment reconcile gh runner: unknown pull request URL: ${target}`);
      if (target === input.implementationPullRequest.url && fields === 'url,body,files,headRefOid') {
        const [metadata, files] = await Promise.all([
          input.adapter.getPullRequestMetadata({ pullNumber }),
          input.adapter.listImplementationPullRequestFiles({ pullNumber }),
        ]);
        return json({
          url: metadata.url,
          body: metadata.body,
          files: files.map(({ path }) => ({ path })),
          headRefOid: metadata.headSha,
        });
      }
      if (fields === 'url,headRefOid') {
        const headRefOid = await input.adapter.getPullRequestHead({ pullNumber });
        return json({ url: target, headRefOid });
      }
    }

    if (command === 'api' && action?.startsWith('repos/') && action.includes('/git/ref/heads/') && args.length === 2) {
      const branch = action.split('/git/ref/heads/')[1];
      if (branch) {
        const repairBranch = await input.adapter.getRepairBranch({ branch });
        return json({ ref: `refs/heads/${repairBranch.name}`, object: { sha: repairBranch.headSha } });
      }
    }

    if (command === 'pr' && action === 'list' && args.length === 12 && args[2] === '--head' &&
        args[4] === '--base' && args[6] === '--state' && args[8] === '--json' && args[9] === 'url' &&
        args[10] === '--limit') {
      const limit = Number(args[11]);
      if (args[7] === 'open' && Number.isInteger(limit) && limit > 0) {
        const pullRequests = await input.adapter.listRepairPullRequests({
          branch: args[3]!, base: args[5]!, state: 'open', limit,
        });
        pullRequests.forEach(({ url, number }) => pullNumbersByUrl.set(url, number));
        return json(pullRequests.map(({ url }) => ({ url })));
      }
    }

    if (command === 'pr' && action === 'create' && args.length === 10 && args[2] === '--base' &&
        args[4] === '--head' && args[6] === '--title' && args[8] === '--body') {
      const pullRequest = await input.adapter.createRepairPullRequest({
        base: args[3]!, branch: args[5]!, title: args[7]!, body: args[9]!,
      });
      pullNumbersByUrl.set(pullRequest.url, pullRequest.number);
      return { stdout: pullRequest.url };
    }

    if (command === 'api' && action === '--method' && target === 'POST' && args.length === 10 &&
        args[3]?.startsWith('repos/') && args[3].includes('/statuses/') &&
        args[4] === '-f' && args[6] === '-f' && args[8] === '-f') {
      const sha = args[3].split('/statuses/')[1];
      const state = args[5]?.startsWith('state=') ? args[5].slice(6) : '';
      const context = args[7]?.startsWith('context=') ? args[7].slice(8) : '';
      const description = args[9]?.startsWith('description=') ? args[9].slice(12) : '';
      if (sha && state && context && description) {
        return json(await input.adapter.postCommitStatus({ sha, state, context, description }));
      }
    }

    throw new Error(`shipment reconcile gh runner: unsupported or malformed command: gh ${args.join(' ')}`);
  };

  return run;
}

export async function runShipmentReconcileAction(
  input: {
    github: GithubClient;
    context: {
      repo: { owner: string; repo: string };
      payload: {
        pull_request: { number: number; html_url: string; merged_at: string };
      };
    };
    core: { info(message: string): void; error(message: string): void };
    workspace: string;
  },
  deps: { dispatchShipmentEvidence?: typeof dispatchShipmentEvidence } = {},
): Promise<number> {
  const pullRequest = input.context.payload.pull_request;
  const adapter = createShipmentReconcileGithubAdapter({
    ...input.context.repo,
    client: input.github,
  });
  const runGh = createShipmentReconcileGhRunner({
    adapter,
    implementationPullRequest: { url: pullRequest.html_url, number: pullRequest.number },
  });

  const exitCode = await (deps.dispatchShipmentEvidence ?? dispatchShipmentEvidence)(
    { kind: 'reconcile', pr: pullRequest.html_url, shipped: pullRequest.merged_at.slice(0, 10) },
    input.workspace,
    {
      runGh,
      report: (message) => input.core.info(message),
      reportError: (message) => input.core.error(message),
    },
  );

  if (exitCode !== 0) {
    throw new Error(`shipment reconciliation failed with exit code ${exitCode}`);
  }

  return 0;
}
