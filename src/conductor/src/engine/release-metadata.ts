export type ReleaseCategory = 'Added' | 'Changed' | 'Deprecated' | 'Removed' | 'Fixed' | 'Security';
export type ReleaseSemver = 'major' | 'minor' | 'patch';

export type ReleaseDisposition =
  | {
      disposition: 'note';
      category: ReleaseCategory;
      semver: ReleaseSemver;
      note: string;
      /** Exact runnable fence(s), retained for the release renderer. */
      migration?: string;
    }
  | { disposition: 'no-note' };

const categories = new Set<ReleaseCategory>([
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
]);
const semverImpacts = new Set<ReleaseSemver>(['major', 'minor', 'patch']);
const fieldNames = ['Disposition', 'Category', 'Semver', 'Note'] as const;
type ReleaseFieldName = typeof fieldNames[number];
const releaseFieldNames = new Set<string>(fieldNames);
const migrationSectionRe = /(?:^|\n)###?\s+Migration\s*\n([\s\S]*?)(?=\n##\s|$)/g;
const runnableMigrationFenceRe = /^```bash migration\s*\n[\s\S]*?```$/;
const thematicBreakRe = /^(?:-{3,}|\*{3,}|_{3,})$/;
const fenceDelimiterRe = /^```/;
const releaseMetadataLineRe = /^Release-(?:Disposition|Category|Semver|Note):.*(?:\r?\n|$)/gm;
/**
 * A single release-metadata line, or a GitHub issue-linking trailer — either
 * ends the Migration section (#1396).
 *
 * The trailer arm exists because `injectIssueRef` appends `Refs owner/repo#N`
 * (spec PRs) or `Closes owner/repo#N` (implementation PRs) to the END of a body
 * whose last section is routinely `## Migration` — `DEFAULT_SPEC_RELEASE_BLOCK`
 * closes with exactly `## Migration\n\nnone`, and the PR template promises no
 * separator below it. Without this arm the trailer is swallowed into the
 * section, a correct `none` reads back as `none\n\nRefs …`, and every
 * intake-sourced spec PR fails the required release-metadata check as
 * malformed. Fence tracking in `migrationSectionContent` keeps a linking line
 * INSIDE a runnable block (an echoed commit message, say) from truncating a
 * real migration.
 */
const migrationSectionTerminatorRe =
  /^(?:Release-(?:Disposition|Category|Semver|Note):|(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?)\s+\S*#\d)/i;
// No trailing lookahead. The non-greedy body already ends the match at the
// section's own closing fence, so requiring "next `##` heading or end-of-string"
// added no precision — it only made the strip position-dependent. A Migration
// section followed by anything else (the SHIP draft's `Closes` trailer, say, or
// the blank lines left behind once `mergeReleaseMetadataBlock` removes the
// Release-* lines above it) survived the strip, and the merged body carried the
// section twice (#1396).
const migrationBlockRe = /(?:\r?\n)?## Migration\s*\r?\n```bash migration\s*\r?\n[\s\S]*?```/g;

function invalidReleaseDisposition(field: string): never {
  throw new Error(`Invalid release disposition: ${field}`);
}

/** True only for the exact fence syntax that `bin/migrate` executes. */
export function isRunnableMigrationBlock(value: string): boolean {
  return runnableMigrationFenceRe.test(value);
}

/**
 * The Migration section's OWN content, cut at the first Markdown thematic break
 * (`---`, `***`, `___`) that sits outside a fenced code block.
 *
 * `migrationSectionRe` can only end a section at the next `##`/`###` heading or
 * at end-of-body, and a PR body's Migration section is routinely the LAST
 * heading in it: `shipDraftPrBody` closes every SHIP-entry draft with a `---`
 * rule, the placeholder note, and the injected `Closes owner/repo#N` line, and
 * `release-disposition` writes the template's `## Migration` section above that
 * trailer. Without this cut the whole trailer is swallowed into the section, so
 * a correct `none` reads as prose and the disposition is rejected as malformed.
 *
 * Fence tracking keeps a rule INSIDE a ```bash migration``` block (a heredoc
 * body, say) from truncating a real migration.
 */
function migrationSectionContent(raw: string): string {
  const kept: string[] = [];
  let inFence = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (fenceDelimiterRe.test(trimmed)) inFence = !inFence;
    // The ship-draft template appends an HTML-comment placeholder
    // (`<!-- Closes <owner/repo#N> — … -->`) below the final section, and it
    // survives whenever issue-link injection is skipped (no sourceRef, or no
    // recorded implementation PR). It is annotation, not migration content:
    // swallowing it turned a correct `none` into a malformed disposition at
    // the finish-time release gate. Single-line comments outside fences are
    // ignored; fence tracking still protects a comment echoed inside a
    // runnable block.
    else if (!inFence && /^<!--.*-->$/.test(trimmed)) continue;
    else if (!inFence && thematicBreakRe.test(trimmed)) break;
    // The release metadata block also ends the section (#1396). An authored body
    // may put `## Migration` LAST, with the Release-* block directly below it and
    // no `---` between them — the PR template promises no such separator. Without
    // this the whole block is swallowed into the migration content and a
    // correctly-formed PR is rejected at the finish-time release gate. Fence
    // tracking keeps a `Release-…` line INSIDE a runnable block (an echoed string,
    // say) from truncating a real migration.
    else if (!inFence && migrationSectionTerminatorRe.test(trimmed)) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

function parseMigrationBlock(body: string): string | undefined {
  const sections = [...body.matchAll(migrationSectionRe)];
  if (sections.length === 0) return undefined;
  if (sections.length !== 1) invalidReleaseDisposition('Migration');

  const migration = migrationSectionContent(sections[0]![1]!);
  if (migration === 'none') return undefined;
  if (!isRunnableMigrationBlock(migration)) invalidReleaseDisposition('Migration');
  return migration;
}

/** Parse the machine-readable release declaration embedded in an implementation PR body. */
export function parseReleaseDisposition(body: string): ReleaseDisposition {
  const fields = new Map<ReleaseFieldName, string>();
  for (const line of body.split(/\r?\n/)) {
    const match = /^Release-([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!match) continue;

    const field = match[1]!;
    if (!releaseFieldNames.has(field)) invalidReleaseDisposition(`Release-${field}`);

    const name = field as ReleaseFieldName;
    if (fields.has(name)) invalidReleaseDisposition(name);
    fields.set(name, match[2]!.trim());
  }

  const disposition = fields.get('Disposition');
  if (disposition === undefined || (disposition !== 'note' && disposition !== 'no-note')) {
    invalidReleaseDisposition('Disposition');
  }

  if (disposition === 'no-note') {
    for (const field of fieldNames.slice(1)) {
      if (fields.has(field)) invalidReleaseDisposition(field);
    }
    if (parseMigrationBlock(body) !== undefined) invalidReleaseDisposition('Migration');
    return { disposition };
  }

  const category = fields.get('Category');
  const semver = fields.get('Semver');
  const note = fields.get('Note');
  if (category === undefined || !categories.has(category as ReleaseCategory)) invalidReleaseDisposition('Category');
  if (semver === undefined || !semverImpacts.has(semver as ReleaseSemver)) invalidReleaseDisposition('Semver');
  if (note === undefined || note.length === 0) invalidReleaseDisposition('Note');

  const migration = parseMigrationBlock(body);
  return {
    disposition,
    category: category as ReleaseCategory,
    semver: semver as ReleaseSemver,
    note,
    ...(migration === undefined ? {} : { migration }),
  };
}

/** Return the exact contiguous release block, or null when it cannot be safely preserved. */
export function snapshotReleaseMetadataBlock(body: string): string | null {
  let disposition: ReleaseDisposition;
  try {
    disposition = parseReleaseDisposition(body);
  } catch {
    return null;
  }

  const lineEnd = '\\r?\\n';
  const fields = disposition.disposition === 'note'
    ? [
        'Release-Disposition: note',
        'Release-Category: (?:Added|Changed|Deprecated|Removed|Fixed|Security)',
        'Release-Semver: (?:major|minor|patch)',
        'Release-Note: .+',
      ].join(lineEnd)
    : 'Release-Disposition: no-note';
  const match = new RegExp(`^(${fields})(?=${lineEnd}|$)`, 'm').exec(body);
  if (!match) return null;

  let block = match[1]!;
  if (disposition.disposition === 'note' && disposition.migration !== undefined) {
    // The heading may be separated from its fence by blank lines — that is
    // what the PR template, the release-disposition skill, and the CHANGELOG
    // renderer all emit, and `parseMigrationBlock` trims them before matching.
    // Requiring the fence on the very next line rejected bodies this function
    // had just parsed. Any separator is captured verbatim so the block stays
    // byte-exact and re-snapshotting stays idempotent.
    const migration = new RegExp(
      `^## Migration(?:${lineEnd})+(\`\`\`bash migration${lineEnd}[\\s\\S]*?\`\`\`)`,
      'm',
    ).exec(body);
    if (!migration) return null;
    const blockEnd = match.index + block.length;
    if (migration.index >= blockEnd) {
      // Migration BELOW the metadata: the two are contiguous in the body, so the
      // separator is captured verbatim and the snapshot stays byte-exact.
      const between = body.slice(blockEnd, migration.index);
      if (!/^\r?\n(?:\r?\n)?$/.test(between)) return null;
      block += `${between}${migration[0]}`;
    } else {
      // Migration ABOVE the metadata (#1396). The two halves are not contiguous,
      // so no substring of the body is the metadata block — the snapshot is
      // rendered in canonical order instead. `mergeReleaseMetadataBlock` already
      // strips both halves from the body before appending this, so the merged
      // result is the same either way, and re-snapshotting the canonical form
      // takes the contiguous branch above and returns it unchanged (idempotent).
      //
      // Without this the two parsers contradicted each other: after #1404
      // `parseReleaseDisposition` accepts this ordering while the snapshot
      // rejected it, so a well-formed body failed the finish-time release gate
      // with "release metadata is malformed or non-canonical" and halted the
      // feature needing a human.
      block += `\n\n${migration[0]}`;
    }
  }
  return block;
}

/** Preserve reader content while replacing all structured release metadata with one snapshot. */
export function mergeReleaseMetadataBlock(body: string, snapshot: string): string | null {
  if (snapshotReleaseMetadataBlock(snapshot) !== snapshot) return null;
  const readerContent = body
    .replace(releaseMetadataLineRe, '')
    .replace(migrationBlockRe, '')
    .replace(/(?:\r?\n){3,}/g, '\n\n')
    .trim();
  return readerContent.length > 0 ? `${readerContent}\n\n${snapshot}` : snapshot;
}
