import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import type { GhRunner } from './pr-labels.js';
import { parseShippedRecord, parseStoriesReference, specHash } from './shipped-record.js';
import { resolveShipmentIdentity } from './shipment-identity.js';

export type ShipmentEvidenceResult =
  | {
      kind: 'valid';
      slug: string;
      pr: string;
      recordPath: string;
      hash: string;
      commit: string;
    }
  | { kind: 'not-applicable'; reason: string }
  | ShipmentEvidenceRefusal;

export type ShipmentEvidenceRefusal = {
  kind: 'refusal';
  code:
    | 'shipment-evidence-inputs-incomplete'
    | 'shipped-record-missing'
    | 'shipped-record-malformed'
    | 'shipped-record-incomplete'
    | 'shipped-record-slug-mismatch'
    | 'shipped-record-pr-mismatch'
    | 'shipped-record-hash-mismatch'
    | 'shipment-plan-missing'
    | 'shipment-plan-ambiguous'
    | 'shipped-record-not-in-candidate'
    | 'shipment-candidate-not-on-implementation-head'
    | 'shipment-candidate-stale'
    | 'shipment-implementation-pr-mismatch'
    | 'shipment-implementation-head-missing'
    | 'shipment-evidence-file-unavailable'
    | 'shipment-evidence-git-unavailable'
    | 'shipment-evidence-github-unavailable';
  expected: string;
  observed: string | null;
};

export interface ShipmentEvidenceInput {
  repoDir: string;
  slug: string;
  implementationPr: string;
  candidateCommit: string;
  /**
   * @deprecated The shared evaluator deliberately ignores caller-supplied
   * heads. It binds reachability to the head returned for implementationPr.
   */
  implementationHead?: string;
}

export interface ImplementationPrBinding {
  url: string;
  headRefOid: string;
}

export interface ShipmentEvidenceDependencies {
  /**
   * Read a repository-relative path out of a committed tree. The commit is an
   * explicit argument because the evaluator may have to inspect more than one
   * tree: the caller's candidate, and — when the branch has legitimately
   * advanced past the head the PR reports — the implementation head itself.
   * Callers that only ever serve one tree may ignore the second parameter.
   */
  readFile?: (path: string, commit: string) => Promise<Buffer | null>;
  gitRunner?: (args: string[]) => Promise<string>;
  githubRunner?: (pr: string) => Promise<ImplementationPrBinding>;
}

/** The durable record proven against one committed tree. */
interface ValidatedShipmentRecord {
  slug: string;
  pr: string;
  recordPath: string;
  hash: string;
}

/**
 * Resolve the immutable implementation PR identity and head through an
 * explicit `gh pr view <url>` request. Callers pass this result to the strict
 * evaluator; a local branch name or candidate SHA is never authoritative.
 */
export async function resolveImplementationPrBinding(
  runGh: GhRunner,
  cwd: string,
  implementationPr: string,
): Promise<ImplementationPrBinding> {
  const { stdout } = await runGh(
    ['pr', 'view', implementationPr, '--json', 'url,headRefOid'],
    { cwd },
  );
  const data = JSON.parse(stdout) as { url?: unknown; headRefOid?: unknown };
  return {
    url: typeof data.url === 'string' ? data.url : '',
    headRefOid: typeof data.headRefOid === 'string' ? data.headRefOid : '',
  };
}

/**
 * Validate the durable shipment record and the spec bytes it attests to from
 * one committed tree. Working-tree files are deliberately never considered.
 */
export async function evaluateShipmentEvidence(
  input: ShipmentEvidenceInput,
  dependencies: ShipmentEvidenceDependencies = {},
): Promise<ShipmentEvidenceResult> {
  const { repoDir, slug, implementationPr, candidateCommit } = input;
  if (!repoDir || !slug || !implementationPr || !candidateCommit) {
    return refusal(
      'shipment-evidence-inputs-incomplete',
      'complete shipment evidence inputs',
      null,
    );
  }

  const readFile: (path: string, commit: string) => Promise<Buffer | null> =
    dependencies.readFile ?? ((path: string, commit: string) => showAtCommit(repoDir, commit, path));
  const gitRunner = dependencies.gitRunner ?? ((args: string[]) => runGit(repoDir, args));

  /**
   * Prove the durable record, its identity, and its spec hash from exactly one
   * committed tree. Working-tree files are deliberately never considered.
   */
  const validateRecordAtCommit = async (
    commit: string,
  ): Promise<ValidatedShipmentRecord | ShipmentEvidenceRefusal> => {
    const exactPlanPath = `.docs/plans/${slug}.md`;
    const exactRecordPath = `.docs/shipped/${slug}.md`;
    // Preserve the strict verifier's established record-first failure surface
    // for ordinary (exact-stem) plans. Date-prefixed fallback only engages when
    // the exact plan is absent, so an I/O failure reading the expected record is
    // never hidden by a later plan lookup.
    const exactRecordContent = await readEvidenceFile(readFile, exactRecordPath, commit);
    if (isRefusal(exactRecordContent)) return exactRecordContent;
    let planBytes = await readEvidenceFile(readFile, exactPlanPath, commit);
    if (isRefusal(planBytes)) return planBytes;

    let identity;
    let recordContent;
    if (planBytes === null) {
      let planPaths: string[];
      try {
        planPaths = await listPlanPathsAtCommit(gitRunner, commit);
      } catch (error) {
        // The ordinary record is already absent. The dated fallback is an
        // optional identity extension, never a reason to obscure that
        // established missing-record failure surface when the candidate tree
        // cannot be enumerated (as in the daemon's synthetic false-ship test).
        if (exactRecordContent === null) {
          return refusal('shipped-record-missing', exactRecordPath, null);
        }
        return unavailable('shipment-evidence-git-unavailable', 'committed plan identity', error);
      }
      const resolution = resolveShipmentIdentity(slug, planPaths);
      if (resolution.kind === 'missing') {
        return refusal('shipment-plan-missing', resolution.expected, null);
      }
      if (resolution.kind === 'ambiguous') {
        return refusal('shipment-plan-ambiguous', resolution.expected, resolution.candidates.join(', '));
      }
      identity = resolution.identity;
      planBytes = await readEvidenceFile(readFile, identity.planPath, commit);
      if (isRefusal(planBytes)) return planBytes;
      if (planBytes === null) return refusal('shipment-plan-missing', identity.planPath, null);
      recordContent = await readEvidenceFile(readFile, identity.recordPath, commit);
      if (isRefusal(recordContent)) return recordContent;
    } else {
      const resolution = resolveShipmentIdentity(slug, [exactPlanPath]);
      if (resolution.kind !== 'resolved') {
        return refusal('shipment-plan-missing', exactPlanPath, null);
      }
      identity = resolution.identity;
      recordContent = exactRecordContent;
    }

    const { recordPath } = identity;
    if (recordContent === null) {
      const workingTreeRecord = await existsInWorkingTree(repoDir, recordPath);
      if (isRefusal(workingTreeRecord)) return workingTreeRecord;
      if (workingTreeRecord) {
        return refusal(
          'shipped-record-not-in-candidate',
          commit,
          'working-tree-only',
        );
      }
      return refusal(
        'shipped-record-missing',
        recordPath,
        null,
      );
    }

    const recordText = recordContent.toString('utf8');
    const rawFields = readFrontmatterFields(recordText);
    if (rawFields === null) {
      return refusal(
        'shipped-record-malformed',
        'parseable shipped record',
        'malformed',
      );
    }
    for (const field of ['slug', 'spec_hash', 'pr', 'shipped'] as const) {
      if (!rawFields[field]) {
        return refusal(
          'shipped-record-incomplete',
          field,
          null,
        );
      }
    }

    const record = parseShippedRecord(recordText);
    if ('malformed' in record) {
      return refusal(
        'shipped-record-malformed',
        'parseable shipped record',
        'malformed',
      );
    }
    if (record.slug !== identity.slug) {
      return refusal(
        'shipped-record-slug-mismatch',
        identity.slug,
        record.slug,
      );
    }
    if (record.pr !== implementationPr) {
      return refusal(
        'shipped-record-pr-mismatch',
        implementationPr,
        record.pr,
      );
    }

    const storiesBytes = await readStoriesBytes(readFile, identity.slug, planBytes, commit);
    if (isRefusal(storiesBytes)) return storiesBytes;
    const hash = specHash(planBytes, storiesBytes).digest;
    if (record.specHash !== hash) {
      return refusal(
        'shipped-record-hash-mismatch',
        hash,
        record.specHash,
      );
    }

    return { slug: identity.slug, pr: record.pr, recordPath, hash };
  };

  const candidateRecord = await validateRecordAtCommit(candidateCommit);
  if (isRefusal(candidateRecord)) return candidateRecord;

  let binding: ImplementationPrBinding;
  try {
    if (!dependencies.githubRunner) {
      return refusal(
        'shipment-evidence-github-unavailable',
        'implementation PR identity and head binding',
        null,
      );
    }
    binding = await dependencies.githubRunner(implementationPr);
  } catch (error) {
    return unavailable('shipment-evidence-github-unavailable', implementationPr, error);
  }
  if (binding.url !== implementationPr) {
    return refusal('shipment-implementation-pr-mismatch', implementationPr, binding.url || null);
  }
  if (!binding.headRefOid) {
    return refusal('shipment-implementation-head-missing', implementationPr, null);
  }
  const implementationHead = binding.headRefOid;

  let candidateOnHead: string;
  try {
    candidateOnHead = await gitRunner([
      'merge-base',
      '--is-ancestor',
      candidateCommit,
      implementationHead,
    ]);
  } catch (error) {
    return unavailable('shipment-evidence-git-unavailable', 'candidate-tree/head reachability', error);
  }
  if (candidateOnHead.trim() !== 'true') {
    const notOnHead = refusal(
      'shipment-candidate-not-on-implementation-head',
      implementationHead,
      candidateCommit,
    );

    // The branch can legitimately be AHEAD of the head the PR reports. The
    // conductor's post-finish shipped-record refresh commits and pushes after
    // FINISH has already published, and GitHub updates a pull request's
    // `headRefOid` asynchronously after accepting the ref update — so a local
    // checkout ahead of the reported head is an ordering artefact of the ship,
    // not evidence of one. What makes the ship real is unchanged: the commit
    // the pull request will merge must itself carry the durable record. Prove
    // that directly instead of trusting either snapshot's timing.
    //
    // This never softens the guard. A record that was committed but never
    // pushed leaves the same "candidate ahead of head" shape, and the head's
    // own tree has no valid record — so it still refuses. Divergent histories
    // (neither commit reachable from the other) refuse without a second look.
    let headOnCandidate: string;
    try {
      headOnCandidate = await gitRunner([
        'merge-base',
        '--is-ancestor',
        implementationHead,
        candidateCommit,
      ]);
    } catch {
      return notOnHead;
    }
    if (headOnCandidate.trim() !== 'true') return notOnHead;

    const headRecord = await validateRecordAtCommit(implementationHead);
    if (isRefusal(headRecord)) return notOnHead;
    return {
      kind: 'valid',
      slug: headRecord.slug,
      pr: headRecord.pr,
      recordPath: headRecord.recordPath,
      hash: headRecord.hash,
      commit: implementationHead,
    };
  }

  let resolvedHead: string;
  try {
    resolvedHead = await gitRunner(['rev-parse', '--verify', implementationHead]);
  } catch (error) {
    return unavailable('shipment-evidence-git-unavailable', implementationHead, error);
  }
  if (resolvedHead.trim() !== candidateCommit) {
    return refusal('shipment-candidate-stale', implementationHead, candidateCommit);
  }

  return {
    kind: 'valid',
    slug: candidateRecord.slug,
    pr: candidateRecord.pr,
    recordPath: candidateRecord.recordPath,
    hash: candidateRecord.hash,
    commit: candidateCommit,
  };
}

async function listPlanPathsAtCommit(
  gitRunner: (args: string[]) => Promise<string>,
  candidateCommit: string,
): Promise<string[]> {
  const output = await gitRunner([
    'ls-tree',
    '-r',
    '--name-only',
    candidateCommit,
    '--',
    '.docs/plans',
  ]);
  return output.split('\n').filter((path) => path.endsWith('.md'));
}

function refusal(
  code: ShipmentEvidenceRefusal['code'],
  expected: string,
  observed: string | null,
): ShipmentEvidenceRefusal {
  return { kind: 'refusal', code, expected, observed };
}

function unavailable(
  code: ShipmentEvidenceRefusal['code'],
  expected: string,
  error: unknown,
): ShipmentEvidenceRefusal {
  return refusal(code, expected, error instanceof Error ? error.message : String(error));
}

function isRefusal(
  value: Buffer | null | boolean | ValidatedShipmentRecord | ShipmentEvidenceRefusal,
): value is ShipmentEvidenceRefusal {
  return value !== null && typeof value !== 'boolean' && 'kind' in value;
}

function readFrontmatterFields(content: string): Record<string, string> | null {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  const fields: Record<string, string> = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '---') return fields;
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim();
  }
  return null;
}

async function readStoriesBytes(
  readFile: (path: string, commit: string) => Promise<Buffer | null>,
  slug: string,
  planBytes: Buffer,
  commit: string,
): Promise<Buffer | null | ShipmentEvidenceRefusal> {
  const reference = parseStoriesReference(planBytes.toString('utf8'));
  if (reference && !isAbsolute(reference)) {
    const stories = await readEvidenceFile(readFile, reference, commit);
    if (isRefusal(stories)) return stories;
    // A zero-byte read is not the stories file. `git show <commit>:<pathspec>`
    // exits 0 with no output for a reference git resolves as a glob, so
    // length is the only signal that separates "read it" from "matched
    // nothing" — and accepting the empty buffer here silently drops the
    // stories half of the spec hash.
    if (stories !== null && stories.length > 0) return stories;
  }
  return readEvidenceFile(readFile, `.docs/stories/${slug}.md`, commit);
}

async function readEvidenceFile(
  readFile: (path: string, commit: string) => Promise<Buffer | null>,
  path: string,
  commit: string,
): Promise<Buffer | null | ShipmentEvidenceRefusal> {
  try {
    return await readFile(path, commit);
  } catch (error) {
    return unavailable('shipment-evidence-file-unavailable', path, error);
  }
}

async function existsInWorkingTree(
  repoDir: string,
  path: string,
): Promise<boolean | ShipmentEvidenceRefusal> {
  try {
    await access(join(repoDir, path));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return refusal('shipment-evidence-file-unavailable', path, null);
  }
}

async function showAtCommit(
  repoDir: string,
  commit: string,
  path: string,
): Promise<Buffer | null> {
  try {
    const result = await execa('git', ['show', `${commit}:${path}`], {
      cwd: repoDir,
      reject: false,
      stripFinalNewline: false,
    });
    return result.exitCode === 0 ? Buffer.from(result.stdout, 'utf8') : null;
  } catch {
    return null;
  }
}

async function runGit(repoDir: string, args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd: repoDir, reject: false });
  if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
    return result.exitCode === 0 ? 'true' : 'false';
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}
