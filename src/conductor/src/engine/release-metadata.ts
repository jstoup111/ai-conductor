export type ReleaseCategory = 'Added' | 'Changed' | 'Deprecated' | 'Removed' | 'Fixed' | 'Security';
export type ReleaseSemver = 'major' | 'minor' | 'patch';

export type ReleaseDisposition =
  | {
      disposition: 'note';
      category: ReleaseCategory;
      semver: ReleaseSemver;
      note: string;
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

/** Parse the machine-readable release declaration embedded in an implementation PR body. */
export function parseReleaseDisposition(body: string): ReleaseDisposition {
  const fields = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const match = /^Release-([A-Za-z]+):\s*(.*)$/.exec(line);
    if (match) fields.set(match[1]!, match[2]!.trim());
  }

  const disposition = fields.get('Disposition');
  if (disposition === 'no-note') return { disposition };

  const category = fields.get('Category');
  const semver = fields.get('Semver');
  const note = fields.get('Note');
  if (
    disposition === 'note' &&
    category !== undefined &&
    categories.has(category as ReleaseCategory) &&
    semver !== undefined &&
    semverImpacts.has(semver as ReleaseSemver) &&
    note !== undefined
  ) {
    return {
      disposition,
      category: category as ReleaseCategory,
      semver: semver as ReleaseSemver,
      note,
    };
  }

  throw new Error('Invalid release disposition');
}
