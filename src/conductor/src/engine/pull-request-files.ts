import { setTimeout as delay } from 'node:timers/promises';
import { runTrackerAmbientRead, runTrackerGraphqlRead, type GhRunner } from './tracker-client.js';

export interface PullRequestWithFiles { number: number; url: string; body: string; headSha: string; headRef: string; mergedAt?: string; author: string; changedPaths: string[] }
export interface PullRequestFilesOptions { runGh: GhRunner; cwd: string; state: 'OPEN' | 'MERGED' }
const MAX_PAGES = 10_000;

/** Read the complete changed-file set for every PR.  Cursor defects are refusals. */
export async function listPullRequestsWithFiles(options: PullRequestFilesOptions): Promise<PullRequestWithFiles[]> {
  const repo = JSON.parse(await runTrackerAmbientRead(
    options.runGh,
    options.cwd,
    'ambient.repository.read',
    ['repo', 'view', '--json', 'nameWithOwner'],
  )) as { nameWithOwner?: string };
  const [owner, name] = (repo.nameWithOwner ?? '').split('/');
  if (!owner || !name) throw new Error('repository name is malformed for pull-request enumeration');
  const out: PullRequestWithFiles[] = []; let cursor: string | null = null; const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await query(options, `query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){pullRequests(states:${options.state},first:10,after:$endCursor){nodes{number url body mergedAt headRefOid headRefName author{login} files(first:100){nodes{path} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}`, { owner, name, ...(cursor ? { endCursor: cursor } : {}) });
    const connection = object(object(object(result, 'pull-request enumeration').data, 'data').repository, 'repository').pullRequests;
    const record = object(connection, 'pull-request connection');
    for (const raw of array(record.nodes, 'pull-request nodes')) {
      const node = object(raw, 'pull-request node'); const files = object(node.files, 'pull-request files');
      const number = numberOf(node.number, 'pull-request number');
      const changedPaths = array(files.nodes, 'changed-file nodes').map((f) => stringOf(object(f, 'changed file').path, 'changed-file path'));
      changedPaths.push(...await remaining(options, owner, name, number, pageInfo(files.pageInfo, `changed-file enumeration for #${number}`)));
      out.push({ number, url: stringOf(node.url, 'pull-request url'), body: typeof node.body === 'string' ? node.body : '', headSha: stringOf(node.headRefOid, 'pull-request head SHA'), headRef: typeof node.headRefName === 'string' ? node.headRefName : '', author: typeof object(node.author ?? {}, 'pull-request author').login === 'string' ? object(node.author ?? {}, 'pull-request author').login as string : '', ...(typeof node.mergedAt === 'string' ? { mergedAt: node.mergedAt } : {}), changedPaths });
    }
    const info = pageInfo(record.pageInfo, 'pull-request pagination'); if (!info.hasNextPage) return out;
    cursor = next(info, seen, 'pull-request enumeration');
  }
  throw new Error('pull-request enumeration exceeded pagination limit');
}

async function remaining(o: PullRequestFilesOptions, owner: string, name: string, number: number, info: { hasNextPage: boolean; endCursor: string | null }): Promise<string[]> {
  const paths: string[] = []; const seen = new Set<string>(); let cursor = info.hasNextPage ? next(info, seen, `changed-file enumeration for #${number}`) : null;
  for (let page = 0; cursor !== null && page < MAX_PAGES; page += 1) { const result = await query(o, 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){files(first:100,after:$endCursor){nodes{path} pageInfo{hasNextPage endCursor}}}}}', { owner, name, number, endCursor: cursor }); const files = object(object(object(object(result, 'changed-file enumeration').data, 'data').repository, 'repository').pullRequest, 'pull request').files; const record = object(files, 'files'); paths.push(...array(record.nodes, 'changed-file nodes').map((f) => stringOf(object(f, 'changed file').path, 'changed-file path'))); const nextInfo = pageInfo(record.pageInfo, `changed-file pagination for #${number}`); if (!nextInfo.hasNextPage) return paths; cursor = next(nextInfo, seen, `changed-file enumeration for #${number}`); }
  if (cursor !== null) throw new Error(`changed-file enumeration for #${number} pagination is incomplete`); return paths;
}
async function query(o: PullRequestFilesOptions, queryText: string, variables: Record<string, string | number>): Promise<unknown> { let last: unknown; for (let i = 0; i < 3; i += 1) try { return JSON.parse(await runTrackerGraphqlRead(o.runGh, o.cwd, { query: queryText, variables })); } catch (error) { last = error; if (i < 2) await delay(250 * (i + 1)); } throw new Error(`pull-request GraphQL read failed: ${String(last)}`); }
function pageInfo(v: unknown, c: string) { const r = object(v, c); if (typeof r.hasNextPage !== 'boolean' || (r.endCursor !== null && typeof r.endCursor !== 'string') || (r.hasNextPage && !r.endCursor)) throw new Error(`${c} is incomplete`); return { hasNextPage: r.hasNextPage, endCursor: r.endCursor as string | null }; }
function next(i: { hasNextPage: boolean; endCursor: string | null }, seen: Set<string>, c: string) { if (!i.hasNextPage || !i.endCursor) throw new Error(`${c} is incomplete pagination`); if (seen.has(i.endCursor)) throw new Error(`${c} incomplete pagination cursor repeated`); seen.add(i.endCursor); return i.endCursor; }
function object(v: unknown, c: string): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${c} is malformed`); return v as Record<string, unknown>; }
function array(v: unknown, c: string): unknown[] { if (!Array.isArray(v)) throw new Error(`${c} is malformed`); return v; }
function stringOf(v: unknown, c: string): string { if (typeof v !== 'string' || !v) throw new Error(`${c} is malformed`); return v; }
function numberOf(v: unknown, c: string): number { if (typeof v !== 'number') throw new Error(`${c} is malformed`); return v; }
