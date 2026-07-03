// `conduct-ts engineer migrate-issue-deps` CLI primitive (Task 25).
//
// Wires the one-time prose→link migration (issue-dep-migration.ts) as an
// engineer-cli subcommand: dry-run by default (prints the proposal, writes
// nothing), `--confirm` applies via the GET-before-POST writer.

import { describe, it, expect } from 'vitest';
import {
  detectEngineerCommand,
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';

const argv = (...rest: string[]) => ['node', 'conduct-ts', 'engineer', ...rest];

function captureOut() {
  const out: string[] = [];
  const err: string[] = [];
  const opts = (extra: Partial<DispatchEngineerOpts>): DispatchEngineerOpts => ({
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    ...extra,
  });
  return { out, err, opts };
}

describe('detectEngineerCommand: migrate-issue-deps grammar', () => {
  it('parses `engineer migrate-issue-deps` (bare) as a dry run', () => {
    expect(detectEngineerCommand(argv('migrate-issue-deps'))).toEqual({
      kind: 'migrate-issue-deps',
      confirm: false,
    });
  });

  it('parses `engineer migrate-issue-deps --confirm` as confirmed', () => {
    expect(detectEngineerCommand(argv('migrate-issue-deps', '--confirm'))).toEqual({
      kind: 'migrate-issue-deps',
      confirm: true,
    });
  });
});

describe('engineer migrate-issue-deps (Task 25 wiring)', () => {
  // Fake gh modeled on the LIVE API contract (verified 2026-07-03, #260):
  //  - GET  repos/<r>/issues/<n>                          → issue JSON with a database `id`
  //  - GET  repos/<r>/issues/<n>/dependencies/blocked_by  → blocking issues (number + repository_url)
  //  - POST repos/<r>/issues/<n>/dependencies/blocked_by  -F issue_id=<database id>
  // The database id is derived as 1_000_000 + number so the fake can map it back.
  function makeGh(repo: string, issues: Array<{ number: number; body: string }>) {
    const calls: string[][] = [];
    const linked = new Set<string>();
    const idOf = (n: number) => 1_000_000 + n;
    const gh = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'repo' && args[1] === 'view') {
        return { stdout: JSON.stringify({ nameWithOwner: repo }) };
      }
      if (args[0] === 'issue' && args[1] === 'list') {
        return { stdout: JSON.stringify(issues.map((i) => ({ number: i.number, body: i.body }))) };
      }
      const depPath = args.find((a) => a.includes('/dependencies/blocked_by'));
      const isPost = args.includes('POST');
      if (depPath && !isPost) {
        const sourceMatch = depPath.match(/issues\/(\d+)\/dependencies/);
        const sourceRef = `${repo}#${sourceMatch?.[1]}`;
        const targets = [...linked].filter((l) => l.startsWith(`${sourceRef}->`)).map((l) => l.split('->')[1]);
        return {
          stdout: JSON.stringify(
            targets.map((t) => ({ number: Number(t.split('#')[1]), repository_url: `https://api.github.com/repos/${repo}` })),
          ),
        };
      }
      if (depPath && isPost) {
        const sourceMatch = depPath.match(/issues\/(\d+)\/dependencies/);
        const sourceRef = `${repo}#${sourceMatch?.[1]}`;
        const idField = args.find((a) => a.startsWith('issue_id='))?.split('=')[1];
        if (idField === undefined) throw new Error(`fake gh: POST without issue_id= (live API rejects this): ${args.join(' ')}`);
        const targetNumber = Number(idField) - 1_000_000;
        linked.add(`${sourceRef}->${repo}#${targetNumber}`);
        return { stdout: '' };
      }
      const issuePath = args.find((a) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(a));
      if (issuePath) {
        const n = Number(issuePath.split('/').pop());
        return { stdout: JSON.stringify({ id: idOf(n), number: n }) };
      }
      return { stdout: '' };
    };
    return { gh, calls };
  }

  it('dry run (no --confirm): prints the proposal and issues zero POST calls', async () => {
    const { gh, calls } = makeGh('acme/app', [{ number: 230, body: 'Gated on #217 landing first.' }]);
    const { out, opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'migrate-issue-deps', confirm: false }, opts({ gh }));

    expect(code).toBe(0);
    expect(calls.some((c) => c.includes('POST'))).toBe(false);
    const printed = out.join('\n');
    expect(printed).toContain('acme/app#217');
  });

  it('--confirm: writes the missing edge via POST', async () => {
    const { gh, calls } = makeGh('acme/app', [{ number: 230, body: 'Gated on #217 landing first.' }]);
    const { opts } = captureOut();

    const code = await dispatchEngineer({ kind: 'migrate-issue-deps', confirm: true }, opts({ gh }));

    expect(code).toBe(0);
    const posts = calls.filter((c) => c.includes('POST'));
    expect(posts.length).toBe(1);
    // Live contract (#260): the payload is the blocking issue's database id.
    expect(posts[0]).toContain('issue_id=1000217');
    expect(posts[0].some((a) => a.startsWith('issue='))).toBe(false);
  });

  it('--confirm re-run: already-linked edges produce zero additional POSTs (idempotent)', async () => {
    const { gh, calls } = makeGh('acme/app', [{ number: 230, body: 'Gated on #217 landing first.' }]);
    const { opts } = captureOut();

    await dispatchEngineer({ kind: 'migrate-issue-deps', confirm: true }, opts({ gh }));
    calls.length = 0;
    const code = await dispatchEngineer({ kind: 'migrate-issue-deps', confirm: true }, opts({ gh }));

    expect(code).toBe(0);
    expect(calls.some((c) => c.includes('POST'))).toBe(false);
  });
});
