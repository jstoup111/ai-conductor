import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  classifyShipmentAssociation,
} from './shipment-association.js';
import {
  evaluateShipmentEvidence,
  type ShipmentEvidenceDependencies,
  type ShipmentEvidenceInput,
} from './shipment-evidence.js';
import {
  makeProductionGh,
  makeProductionGit,
  type GhRunner,
  type GitRunner,
} from './pr-labels.js';

export type ShipmentEvidenceCommand =
  | { kind: 'check'; pr: string }
  | { kind: 'guide' };

export const SHIPMENT_EVIDENCE_USAGE =
  'conduct shipment-evidence --pr <implementation-pr-url>';

export interface ShipmentEvidenceRunners {
  runGh?: GhRunner;
  runGit?: GitRunner;
  listPlanStems?: (cwd: string) => Promise<string[]>;
  evaluateEvidence?: (
    input: ShipmentEvidenceInput,
    dependencies: ShipmentEvidenceDependencies,
  ) => ReturnType<typeof evaluateShipmentEvidence>;
  report?: (message: string) => void;
  reportError?: (message: string) => void;
}

interface PullRequestEvidenceMetadata {
  url: string;
  body: string;
  changedPaths: string[];
  headRefOid: string;
}

export function detectShipmentEvidenceCommand(argv: string[]): ShipmentEvidenceCommand | null {
  if (argv[2] !== 'shipment-evidence') return null;
  const prIndex = argv.indexOf('--pr', 3);
  const pr = prIndex === -1 ? undefined : argv[prIndex + 1];
  return pr && !pr.startsWith('--') ? { kind: 'check', pr } : { kind: 'guide' };
}

/**
 * Report shipment evidence for every pull request. Only an exact implementation
 * association reaches the strict evaluator; all other PR classes are an
 * explicit successful not-applicable result.
 */
export async function dispatchShipmentEvidence(
  cmd: ShipmentEvidenceCommand,
  cwd: string,
  runners: ShipmentEvidenceRunners = {},
): Promise<number> {
  const report = runners.report ?? console.log;
  const reportError = runners.reportError ?? console.error;
  if (cmd.kind === 'guide') {
    reportError(SHIPMENT_EVIDENCE_USAGE);
    return 1;
  }

  try {
    const runGh = runners.runGh ?? makeProductionGh();
    const runGit = runners.runGit ?? makeProductionGit();
    const metadata = await readPullRequestEvidenceMetadata(runGh, cwd, cmd.pr);
    if (metadata.url !== cmd.pr) {
      throw new Error(`implementation PR binding mismatch: expected ${cmd.pr}, got ${metadata.url || 'empty'}`);
    }

    const planStems = await (runners.listPlanStems ?? listPlanStems)(cwd);
    const association = classifyShipmentAssociation({
      planStems,
      pr: {
        metadataPlanStems: extractPlanStems(metadata.body),
        changedPaths: metadata.changedPaths,
      },
    });
    if (association.kind === 'not-applicable') {
      report(`shipped-record: not applicable (${association.classification})`);
      return 0;
    }

    const candidateCommit = (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    const evidence = await (runners.evaluateEvidence ?? evaluateShipmentEvidence)(
      {
        repoDir: cwd,
        slug: association.slug,
        implementationPr: cmd.pr,
        candidateCommit,
      },
      {
        gitRunner: async (args) => (await runGit(args, { cwd })).stdout,
        githubRunner: async (implementationPr) => {
          if (implementationPr !== cmd.pr) {
            throw new Error(`implementation PR binding mismatch: expected ${cmd.pr}, got ${implementationPr}`);
          }
          return { url: metadata.url, headRefOid: metadata.headRefOid };
        },
      },
    );
    if (evidence.kind === 'valid') {
      report(`shipped-record: valid ${evidence.recordPath}`);
      return 0;
    }
    if (evidence.kind === 'not-applicable') {
      reportError(`shipped-record: ${evidence.reason}`);
      return 1;
    }

    reportError(`shipped-record: ${evidence.code}`);
    return 1;
  } catch (error) {
    reportError(`shipped-record: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function readPullRequestEvidenceMetadata(
  runGh: GhRunner,
  cwd: string,
  pr: string,
): Promise<PullRequestEvidenceMetadata> {
  const { stdout } = await runGh(
    ['pr', 'view', pr, '--json', 'url,body,files,headRefOid'],
    { cwd },
  );
  const value = JSON.parse(stdout) as {
    url?: unknown;
    body?: unknown;
    files?: unknown;
    headRefOid?: unknown;
  };
  return {
    url: typeof value.url === 'string' ? value.url : '',
    body: typeof value.body === 'string' ? value.body : '',
    changedPaths: Array.isArray(value.files)
      ? value.files.flatMap((file) => {
        const path = (file as { path?: unknown }).path;
        return typeof path === 'string' ? [path] : [];
      })
      : [],
    headRefOid: typeof value.headRefOid === 'string' ? value.headRefOid : '',
  };
}

async function listPlanStems(cwd: string): Promise<string[]> {
  const entries = await readdir(join(cwd, '.docs', 'plans'));
  return entries
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.slice(0, -'.md'.length));
}

function extractPlanStems(metadata: string): string[] {
  return [...metadata.matchAll(/\.docs\/plans\/([^/\s`]+)\.md/g)].map((match) => match[1]);
}
