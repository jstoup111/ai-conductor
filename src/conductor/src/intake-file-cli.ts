// intake-file-cli.ts — production entry point for `bin/intake-file`.
//
// One atomic filing: create the GitHub intake issue, resolve size/priority
// (given ▸ prompt ▸ infer ▸ default), apply the `priority:`/`size:` labels,
// and record `--depends-on` blocked_by link(s) — delegating entirely to
// `fileIntakeIssue` (src/engine/engineer/intake/file-issue.ts). A label-apply
// or depends-on link failure after a successful issue create is a warning,
// never a filing failure (exit 0). Only a failure to create the issue is fatal.
//
// Usage:
//   intake-file --title <t> --body <b> [--size S|M|L]
//               [--priority critical|high|medium|low]
//               [--depends-on owner/repo#N ...] [--repo owner/repo]

import { createInterface } from 'node:readline/promises';
import { makeProductionGh, restAddLabelArgs } from './engine/pr-labels.js';
import { fileIntakeIssue, type FileIntakeIssueOpts } from './engine/engineer/intake/file-issue.js';
import { describeRedactions } from './engine/engineer/intake/sanitize.js';
import type {
  GithubOperationRunner,
  GithubOperationRequest,
} from './engine/github-operations.js';
import type { GhRunner } from './engine/tracker-client.js';
import { makeMachineOwnerResolver } from './engine/owner-gate/machine-identity.js';

function parseArgs(argv: string[]): FileIntakeIssueOpts | null {
  const opts: Partial<FileIntakeIssueOpts> & { dependsOn: string[] } = { dependsOn: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--title':
        opts.title = next();
        break;
      case '--body':
        opts.body = next();
        break;
      case '--size': {
        const v = next().toUpperCase();
        if (v !== 'S' && v !== 'M' && v !== 'L') throw new Error(`invalid --size "${v}" (S|M|L)`);
        opts.size = v;
        break;
      }
      case '--priority': {
        const v = next().toLowerCase();
        if (v !== 'critical' && v !== 'high' && v !== 'medium' && v !== 'low') {
          throw new Error(`invalid --priority "${v}" (critical|high|medium|low)`);
        }
        opts.priority = v;
        break;
      }
      case '--depends-on':
        opts.dependsOn.push(next());
        break;
      case '--repo':
        opts.repo = next();
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }
  if (!opts.title || !opts.body) return null;
  // Prompt for a missing size/priority only when attached to an interactive TTY.
  opts.interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  return opts as FileIntakeIssueOpts;
}

function canonicalRepository(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(value)) return undefined;
  return value.toLowerCase();
}

async function resolveFilingRepository(gh: GhRunner, requested: string | undefined, cwd: string): Promise<string> {
  const explicit = canonicalRepository(requested);
  if (requested !== undefined) {
    if (!explicit) throw new Error(`invalid --repo "${requested}" (expected owner/repo)`);
    return explicit;
  }
  const { stdout } = await gh(['repo', 'view', '--json', 'nameWithOwner'], { cwd });
  const discovered = canonicalRepository((JSON.parse(stdout || '{}') as { nameWithOwner?: unknown }).nameWithOwner);
  if (!discovered) throw new Error('could not resolve the filing repository; pass --repo owner/repo');
  return discovered;
}

/**
 * The only unguarded process adapter in this command is private to its one
 * creation transaction. `fileIntakeIssue` invokes it only after D3's creation
 * context has admitted the operator and destination, and only emits these
 * three registered operations. Dependency discovery is a read; its result
 * never becomes authority to mutate the referenced issue.
 */
function createIntakeFilingOperations(gh: GhRunner, cwd: string): GithubOperationRunner {
  return {
    async run(request: GithubOperationRequest) {
      switch (request.operation) {
        case 'issue.create': {
          const payload = request.payload as { title?: unknown; body?: unknown } | undefined;
          if (typeof payload?.title !== 'string' || typeof payload.body !== 'string') {
            return { kind: 'refused', reason: 'invalid-payload' } as const;
          }
          const { stdout } = await gh([
            'issue', 'create', '-R', request.target.repository,
            '--title', payload.title,
            '--body', payload.body,
          ], { cwd });
          const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)\/?\s*$/.exec(stdout);
          if (!match || canonicalRepository(match[1]) !== request.target.repository.toLowerCase()) return {};
          return { created: { repository: request.target.repository, kind: 'issue', number: Number(match[2]) } };
        }
        case 'issue.label.add': {
          if (request.target.kind !== 'issue' || !request.payload || !('label' in request.payload)) {
            return { kind: 'refused', reason: 'invalid-target' } as const;
          }
          await gh(restAddLabelArgs(request.target.repository, String(request.target.number), request.payload.label), { cwd });
          return {};
        }
        case 'issue.dependency.add': {
          if (request.target.kind !== 'issue' || !request.payload || !('dependency' in request.payload)) {
            return { kind: 'refused', reason: 'invalid-target' } as const;
          }
          const dependency = request.payload.dependency;
          const { stdout } = await gh(['api', `repos/${dependency.repository}/issues/${dependency.number}`], { cwd });
          const id = (JSON.parse(stdout) as { id?: unknown }).id;
          if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
            return { kind: 'refused', reason: 'invalid-target' } as const;
          }
          await gh([
            'api', '--method', 'POST',
            `repos/${request.target.repository}/issues/${request.target.number}/dependencies/blocked_by`,
            '-F', `issue_id=${id}`,
          ], { cwd });
          return {};
        }
        default:
          return { kind: 'refused', reason: 'unsupported-operation' } as const;
      }
    },
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    console.error(
      'Usage: intake-file --title <t> --body <b> [--size S|M|L] ' +
        '[--priority critical|high|medium|low] [--depends-on owner/repo#N ...] [--repo owner/repo]',
    );
    process.exitCode = 1;
    return;
  }

  const rl = opts.interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    const gh = makeProductionGh();
    const cwd = '.';
    const repository = await resolveFilingRepository(gh, opts.repo, cwd);
    const resolveActor = makeMachineOwnerResolver(gh, cwd);
    const result = await fileIntakeIssue({ ...opts, repo: repository }, {
      gh,
      cwd,
      prompt: rl ? (question: string) => rl.question(`${question} `) : undefined,
      creation: {
        authority: { resolveActor, intent: { kind: 'explicit-intake', repository } },
        operations: createIntakeFilingOperations(gh, cwd),
      },
    });

    if (result.issueUrl) console.log(`[intake-file] filed: ${result.issueUrl}`);
    else console.error('[intake-file] filing did not return a canonical issue URL');
    console.log(`[intake-file] size=${result.size} (${result.sizeSource})`);
    console.log(`[intake-file] priority=${result.priority} (${result.prioritySource})`);
    if (result.dependsOnDecision === 'linked') {
      console.log(`[intake-file] depends-on: ${result.linked.join(', ') || '(none linked)'}`);
    } else {
      console.log('[intake-file] dependencies: none');
    }
    if (result.redactions.length > 0) {
      console.error(
        `[intake-file] redacted before filing: ${describeRedactions(result.redactions)} ` +
          '— review the filed issue and restore any evidence the scrub clipped',
      );
    }
    for (const w of result.warnings) console.error(`[intake-file] warning: ${w}`);
    for (const bad of result.badRefs) console.error(`[intake-file] warning: bad --depends-on ref "${bad}"`);
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  // Only a hard failure (issue create itself failing, or an argument error)
  // reaches here — per-dep and label failures are warnings inside fileIntakeIssue.
  console.error(`[intake-file] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
