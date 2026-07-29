interface GithubResponse<T> {
  data: T;
}

interface GithubClient {
  rest: {
    pulls: {
      get(input: { owner: string; repo: string; pull_number: number }): Promise<GithubResponse<{
        number: number;
        html_url: string;
        merged: boolean;
        merge_commit_sha: string | null;
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

  return {
    async getImplementationPullRequest({ pullNumber }: { pullNumber: number }) {
      const { data } = await client.rest.pulls.get({ owner, repo, pull_number: pullNumber });
      return {
        number: data.number,
        url: data.html_url,
        merged: data.merged,
        mergeCommitSha: data.merge_commit_sha,
        headSha: data.head.sha,
      };
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

    async findOrCreateRepairPullRequest({
      branch,
      base,
      title,
      body,
    }: {
      branch: string;
      base: string;
      title: string;
      body: string;
    }) {
      const existing = await client.rest.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:${branch}`,
        base,
        per_page: 100,
      });
      const pullRequest = existing.data[0] ?? (await client.rest.pulls.create({
        owner,
        repo,
        head: branch,
        base,
        title,
        body,
      })).data;
      return { number: pullRequest.number, url: pullRequest.html_url };
    },

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
