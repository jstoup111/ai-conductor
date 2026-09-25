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
import { makeProductionGh } from './engine/pr-labels.js';
import { createIntakeFilingOperations, fileIntakeIssue, type FileIntakeIssueOpts } from './engine/engineer/intake/file-issue.js';
import { describeRedactions } from './engine/engineer/intake/sanitize.js';
import { runTrackerRead, type GhRunner } from './engine/tracker-client.js';
import { makeMachineOwnerResolver } from './engine/owner-gate/machine-identity.js';
import { ConductorEventEmitter } from './ui/events.js';
import { EventPersister } from './engine/event-persister.js';
import { join } from 'node:path';

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
  // `gh repo view` resolves the checkout-selected repository. It still enters
  // the closed read interface; the placeholder is only the typed discovery
  // subject and is replaced by GitHub's canonical nameWithOwner response.
  const stdout = await runTrackerRead(
    gh,
    cwd,
    'repository.read',
    process.env.GITHUB_REPOSITORY ?? 'github/current-repository',
    { kind: 'repository' },
    ['repo', 'view', '--json', 'nameWithOwner'],
  );
  const discovered = canonicalRepository((JSON.parse(stdout || '{}') as { nameWithOwner?: unknown }).nameWithOwner);
  if (!discovered) throw new Error('could not resolve the filing repository; pass --repo owner/repo');
  return discovered;
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
  let persister: EventPersister | undefined;
  try {
    const gh = makeProductionGh();
    const cwd = '.';
    const repository = await resolveFilingRepository(gh, opts.repo, cwd);
    const resolveActor = makeMachineOwnerResolver(gh, cwd);
    const events = new ConductorEventEmitter();
    persister = new EventPersister(join(cwd, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const result = await fileIntakeIssue({ ...opts, repo: repository }, {
      prompt: rl ? (question: string) => rl.question(`${question} `) : undefined,
      creation: {
        authority: { resolveActor, intent: { kind: 'explicit-intake', repository } },
        operations: createIntakeFilingOperations(gh, cwd, {
          resolveActor,
          intent: { kind: 'explicit-intake', repository },
        }, events),
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
    persister?.stop();
    rl?.close();
  }
}

main().catch((error) => {
  // Only a hard failure (issue create itself failing, or an argument error)
  // reaches here — per-dep and label failures are warnings inside fileIntakeIssue.
  console.error(`[intake-file] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
