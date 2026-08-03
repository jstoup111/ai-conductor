import type { ReleaseCategory, ReleaseDisposition, ReleaseSemver } from './release-metadata.js';

const categoryOrder: readonly ReleaseCategory[] = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
];

const semverRank: Record<ReleaseSemver, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

export interface ReleaseRenderCandidate {
  number: number;
  disposition: ReleaseDisposition;
}

export interface ReleaseRenderInput {
  currentVersion: string;
  date: string;
  changelog: string;
  candidates: readonly ReleaseRenderCandidate[];
  repositoryUrl?: string;
}

export interface RenderedReleaseCandidate {
  version: string;
  changelog: string;
}

/** A candidate's review disposition as rendered on the bot-owned release PR. */
export type ReleaseAuditDisposition =
  | ReleaseDisposition
  | { disposition: 'excluded'; reason: string };

export interface ReleaseAuditCandidate {
  number: number;
  mergeSha: string;
  disposition: ReleaseAuditDisposition;
}

/** Return the most significant declared impact, rejecting values outside the metadata contract. */
function aggregateReleaseSemver(impacts: readonly string[]): ReleaseSemver {
  let highest: ReleaseSemver | undefined;
  for (const impact of impacts) {
    if (!(impact in semverRank)) throw new Error(`Invalid release semver: ${impact}`);
    const typedImpact = impact as ReleaseSemver;
    if (highest === undefined || semverRank[typedImpact] > semverRank[highest]) highest = typedImpact;
  }
  if (highest === undefined) throw new Error('Cannot render a release without a note');
  return highest;
}

/**
 * Render the bot-owned candidate section while retaining the empty pending section and all
 * published history byte-for-byte. Candidate order is authoritative for both notes and migrations.
 */
export function renderReleaseCandidate(input: ReleaseRenderInput): RenderedReleaseCandidate {
  const notedCandidates = input.candidates.filter(
    (candidate): candidate is ReleaseRenderCandidate & { disposition: Extract<ReleaseDisposition, { disposition: 'note' }> } =>
      candidate.disposition.disposition === 'note',
  );
  const impact = aggregateReleaseSemver(notedCandidates.map((candidate) => candidate.disposition.semver));
  const version = bumpVersion(input.currentVersion, impact);
  const releaseSection = renderReleaseSection({
    version,
    date: input.date,
    candidates: notedCandidates,
    repositoryUrl: input.repositoryUrl ?? 'https://github.com/jstoup111/ai-conductor',
  });

  return {
    version,
    changelog: insertReleaseSection(input.changelog, releaseSection),
  };
}

/** Render every candidate for PR review while the changelog stays reader-facing. */
export function renderReleaseCandidateAudit(candidates: readonly ReleaseAuditCandidate[]): string {
  const lines = [
    '## Release candidate audit',
    '',
    '| Implementation PR | Merge commit | Disposition | Reason |',
    '| --- | --- | --- | --- |',
  ];

  for (const candidate of candidates) {
    const disposition = candidate.disposition;
    const [outcome, reason] = disposition.disposition === 'note'
      ? ['included', disposition.note]
      : disposition.disposition === 'no-note'
        ? ['no-note', 'Explicit no-note disposition.']
        : ['excluded', disposition.reason];
    lines.push(`| #${candidate.number} | \`${escapeTableCell(candidate.mergeSha)}\` | ${outcome} | ${escapeTableCell(reason)} |`);
  }

  return lines.join('\n');
}

function escapeTableCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll(/\r?\n/g, '<br>');
}

function bumpVersion(currentVersion: string, impact: ReleaseSemver): string {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(currentVersion);
  if (!match) throw new Error(`Invalid current version: ${currentVersion}`);

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (impact === 'major') return `${major + 1}.0.0`;
  if (impact === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function renderReleaseSection(input: {
  version: string;
  date: string;
  candidates: readonly (ReleaseRenderCandidate & { disposition: Extract<ReleaseDisposition, { disposition: 'note' }> })[];
  repositoryUrl: string;
}): string {
  const lines = [`## [${input.version}] - ${input.date}`, ''];

  for (const category of categoryOrder) {
    const candidates = input.candidates.filter((candidate) => candidate.disposition.category === category);
    if (candidates.length === 0) continue;

    lines.push(`### ${category}`, '');
    for (const candidate of candidates) {
      lines.push(`- ${candidate.disposition.note} ([implementation PR #${candidate.number}](${input.repositoryUrl}/pull/${candidate.number})).`);
    }
    lines.push('');
  }

  const migrations = input.candidates.flatMap((candidate) =>
    candidate.disposition.migration === undefined ? [] : [candidate.disposition.migration],
  );
  if (migrations.length > 0) {
    lines.push('## Migration', '');
    for (const migration of migrations) lines.push(migration, '');
  }

  return lines.join('\n');
}

function insertReleaseSection(changelog: string, releaseSection: string): string {
  const match = /^([\s\S]*?^## \[Unreleased\]\n)(\n*)([\s\S]*)$/m.exec(changelog);
  if (!match) throw new Error('CHANGELOG.md is missing an [Unreleased] section');

  const [, prefix, spacing, history] = match;
  if (history.startsWith('### ')) throw new Error('CHANGELOG.md [Unreleased] must be empty before rendering');
  return `${prefix}${spacing}${releaseSection}\n${history}`;
}
