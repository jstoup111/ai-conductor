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
const migrationFenceOpenRe = /^```bash migration\s*$/;
/**
 * A single release-metadata line, a GitHub issue-linking trailer, or a shipment
 * plan declaration — any of which ends the Migration section (#1396).
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
 * real migration. The shipment-plan declaration is appended separately by
 * `upsertShipmentPlanDeclaration`; it is PR bookkeeping rather than migration
 * content, so an otherwise-valid `none` section must stop before it.
 */
const migrationSectionTerminatorRe =
  /^(?:Release-(?:Disposition|Category|Semver|Note):|(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?)\s+\S*#\d|plan:\s+`?\.docs\/plans\/[^/\s`]+\.md`?)/i;

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
 *
 * Returns the section text and the offset in `raw` where the section stops.
 */
function migrationSectionContent(raw: string): { text: string; end: number } {
  const kept: string[] = [];
  let inFence = false;
  let offset = 0;
  let end = raw.length;
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
    else if (!inFence && /^<!--.*-->$/.test(trimmed)) {
      offset += line.length + 1;
      continue;
    }
    // The release metadata block also ends the section (#1396). An authored body
    // may put `## Migration` LAST, with the Release-* block directly below it and
    // no `---` between them — the PR template promises no such separator. Without
    // this the whole block is swallowed into the migration content and a
    // correctly-formed PR is rejected at the finish-time release gate. Fence
    // tracking keeps a `Release-…` line INSIDE a runnable block (an echoed string,
    // say) from truncating a real migration.
    else if (!inFence && (thematicBreakRe.test(trimmed) || migrationSectionTerminatorRe.test(trimmed))) {
      end = offset;
      break;
    }
    kept.push(line);
    offset += line.length + 1;
  }
  return { text: kept.join('\n').trim(), end };
}

/**
 * The RUNNABLE region of a Migration section: the first ```bash migration```
 * opener through the closing delimiter of the last such fence.
 *
 * A migration is a ```bash migration``` fence *inside* a `## Migration` section
 * (`docs/contributing/releases.md`), and `bin/migrate` reads exactly those
 * fences and ignores the surrounding lines — a section routinely opens with a
 * sentence telling the operator what the block does. Treating the whole section
 * as the migration made that legal shape fail `isRunnableMigrationBlock`, whose
 * anchors demand the content BE the fence, and the PR was rejected as
 * "Invalid release disposition: Migration" (observed on PR #1957).
 *
 * Returns null when the section carries no runnable fence, so a `none` section
 * and a prose-only section keep their existing meanings — and an unterminated
 * fence still fails closed. Prose BETWEEN two runnable fences is carried along,
 * exactly as `isRunnableMigrationBlock` has always accepted it; this bounds the
 * region, it does not loosen that check.
 */
function migrationFenceRegion(content: string): { text: string; start: number; end: number } | null {
  let inFence = false;
  let runnable = false;
  let offset = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (fenceDelimiterRe.test(trimmed)) {
      if (inFence) {
        if (runnable) end = offset + line.length;
        runnable = false;
      } else if (migrationFenceOpenRe.test(trimmed)) {
        runnable = true;
        if (start === null) start = offset;
      }
      inFence = !inFence;
    }
    offset += line.length + 1;
  }
  if (start === null || end === null) return null;
  return { text: content.slice(start, end), start, end };
}

function parseMigrationBlock(body: string): string | undefined {
  const sections = [...body.matchAll(migrationSectionRe)];
  if (sections.length === 0) return undefined;
  if (sections.length !== 1) invalidReleaseDisposition('Migration');

  const raw = sections[0]![1]!;
  const section = migrationSectionContent(raw);
  const migration = migrationFenceRegion(raw.slice(0, section.end))?.text ?? section.text;
  if (migration === 'none') return undefined;
  if (!isRunnableMigrationBlock(migration)) invalidReleaseDisposition('Migration');
  return migration;
}

/**
 * The body with every HTML comment outside a code fence removed (lines kept).
 *
 * The PR template documents the note shape and an example ```bash migration```
 * fence inside HTML comments, and engine-seeded draft bodies carry the template
 * verbatim. Commented text is never a declaration: read as one, the example
 * duplicates the live `Release-Disposition` line and the example fence turns a
 * `none` Migration section into a malformed one, halting the self-host release
 * gate. Inside a code fence `<!--` is literal content, not comment syntax.
 */
function withoutHtmlComments(body: string): string {
  const kept: string[] = [];
  let inComment = false;
  let inFence = false;
  for (const line of body.split('\n')) {
    if (!inComment && fenceDelimiterRe.test(line.trim())) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }
    if (inFence) {
      kept.push(line);
      continue;
    }
    let rest = line;
    let out = '';
    for (;;) {
      if (inComment) {
        const close = rest.indexOf('-->');
        if (close === -1) break;
        rest = rest.slice(close + 3);
        inComment = false;
      } else {
        const open = rest.indexOf('<!--');
        if (open === -1) {
          out += rest;
          break;
        }
        out += rest.slice(0, open);
        rest = rest.slice(open + 4);
        inComment = true;
      }
    }
    kept.push(out);
  }
  return kept.join('\n');
}

/** Parse the machine-readable release declaration embedded in an implementation PR body. */
export function parseReleaseDisposition(body: string): ReleaseDisposition {
  body = withoutHtmlComments(body);
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
