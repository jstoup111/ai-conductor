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
const migrationBlockRe = /(?:\r?\n)?## Migration\s*\r?\n```bash migration\s*\r?\n[\s\S]*?```(?=\r?\n##\s|$)/g;

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
    else if (!inFence && thematicBreakRe.test(trimmed)) break;
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
    const between = body.slice(match.index + block.length, migration.index);
    if (!/^\r?\n(?:\r?\n)?$/.test(between)) return null;
    block += `${between}${migration[0]}`;
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
