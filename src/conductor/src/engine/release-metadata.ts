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
const migrationSectionRe = /(?:^|\n)###?\s+Migration\s*\n([\s\S]*?)(?=\n##\s|$)/;
const runnableMigrationFenceRe = /^```bash migration\s*\n[\s\S]*?```$/;

function invalidReleaseDisposition(field: string): never {
  throw new Error(`Invalid release disposition: ${field}`);
}

/** True only for the exact fence syntax that `bin/migrate` executes. */
export function isRunnableMigrationBlock(value: string): boolean {
  return runnableMigrationFenceRe.test(value);
}

function parseMigrationBlock(body: string): string | undefined {
  const section = body.match(migrationSectionRe);
  if (!section) return undefined;

  const migration = section[1]!.trim();
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
