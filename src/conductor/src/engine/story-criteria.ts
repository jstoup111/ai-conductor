// ── Story structure parsing (shared by stories, plan, and review predicates) ─
//
// Criterion ids (`S<story>.<criterion>`) are POSITIONAL: the stories skill
// never writes literal ids into story files. Every consumer that must resolve
// an `S<n>.<m>` reference derives the id set from the Given/When/Then bullets
// via `extractStoryCriterionIds` — a literal grep of the stories body finds
// nothing but incidental prose.

export interface StoryBlock {
  id?: string;
  text: string;
}

export interface AcceptedStoryReadability {
  stories: readonly {
    id?: string;
    readable: boolean;
  }[];
  firstUnreadableStoryId?: string;
}

/** A criterion accepted by the sealed-story contract, in stable source order. */
export interface SealedStoryCriterion {
  readonly id: string;
  readonly storyId: string;
  readonly kind: 'happy' | 'negative';
  readonly text: string;
}

/** A named reason the sealed-story contract could not derive authoritative criteria. */
export interface SealedStoryCriterionDiagnostic {
  readonly storyId?: string;
  readonly detail: string;
}

export type SealedStoryCriteriaRead =
  | { readonly ok: true; readonly criteria: readonly SealedStoryCriterion[] }
  | { readonly ok: false; readonly diagnostics: readonly SealedStoryCriterionDiagnostic[] };

/**
 * Split a stories file into per-story blocks on `## Story <id>:` headings.
 * Single-story files (no such heading) return one block spanning the file.
 */
export function splitStoryBlocks(content: string): StoryBlock[] {
  const heading = /^##\s+Story\s+([A-Za-z0-9.\-]+)/i;
  const blocks: StoryBlock[] = [];
  let current: { id: string; lines: string[] } | null = null;
  for (const line of content.split('\n')) {
    const m = line.match(heading);
    if (m) {
      if (current) blocks.push({ id: current.id, text: current.lines.join('\n') });
      current = { id: m[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ id: current.id, text: current.lines.join('\n') });
  return blocks.length > 0 ? blocks : [{ text: content }];
}

/**
 * Return the text under the first heading matching `headingRegex`, up to the
 * next heading of the same or higher level, or null if no such heading exists.
 */
export function sectionBody(text: string, headingRegex: RegExp): string | null {
  let capturing = false;
  let level = 0;
  const body: string[] = [];
  for (const line of text.split('\n')) {
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      if (capturing && hm[1].length <= level) break;
      if (!capturing && headingRegex.test(hm[2])) {
        capturing = true;
        level = hm[1].length;
        continue;
      }
    }
    if (capturing) body.push(line);
  }
  return capturing ? body.join('\n') : null;
}

/**
 * Yield each list item's full text with its indented continuation lines
 * joined. Authors hard-wrap long Given/When/Then rows at ~100 columns, so
 * "then" routinely lands on a continuation line; matching only the bullet's
 * first line silently dropped those rows and shifted every later ordinal.
 */
export function listItems(body: string): string[] {
  const items: string[] = [];
  for (const line of body.split('\n')) {
    const bullet = line.match(/^\s*(?:[-*+] |\d+[.)] )(.+?)\s*$/);
    if (bullet) {
      items.push(bullet[1]);
    } else if (items.length > 0 && /^\s+\S/.test(line)) {
      items[items.length - 1] += ' ' + line.trim();
    } else if (line.trim() === '') {
      continue;
    } else {
      // Unindented non-bullet prose ends the current item.
      items.push('');
    }
  }
  return items.filter((item) => item !== '');
}

/**
 * Resolve the authoritative criterion set only when every sealed story is
 * readable. Consumers must use this instead of independently accepting a
 * subset of story blocks or Given/Then-only bullets.
 */
export function readSealedStoryCriteria(storiesText: string): SealedStoryCriteriaRead {
  const criteria: SealedStoryCriterion[] = [];
  const diagnostics: SealedStoryCriterionDiagnostic[] = [];

  for (const block of splitStoryBlocks(storiesText)) {
    if (!block.id) {
      diagnostics.push({ detail: 'story source is missing Story id' });
      continue;
    }

    let ordinal = 0;
    for (const [kind, heading, label] of [
      ['happy', /happy\s*path/i, 'Happy Path'],
      ['negative', /negative\s*paths?/i, 'Negative Paths'],
    ] as const) {
      const body = sectionBody(block.text, heading);
      if (body === null) {
        diagnostics.push({ storyId: block.id, detail: `story ${block.id} is missing ${label} section` });
        continue;
      }
      const items = listItems(body);
      if (items.length === 0) {
        diagnostics.push({ storyId: block.id, detail: `story ${block.id} has an empty ${label} section` });
        continue;
      }
      for (const text of items) {
        ordinal += 1;
        const missing = ['Given', 'When', 'Then'].filter((term) => !new RegExp(`\\b${term}\\b`, 'i').test(text));
        if (missing.length > 0) {
          diagnostics.push({
            storyId: block.id,
            detail: `story ${block.id} ${kind} criterion ${ordinal} lacks ${missing.join(', ')}`,
          });
          continue;
        }
        criteria.push({ id: `S${block.id}.${ordinal}`, storyId: block.id, kind, text });
      }
    }
  }

  return diagnostics.length === 0 ? { ok: true, criteria } : { ok: false, diagnostics };
}

/** Map each authoritative Given/When/Then row to its report-table criterion id. */
export function extractStoryCriterionIds(storiesText: string): string[] {
  const ids: string[] = [];
  for (const block of splitStoryBlocks(storiesText)) {
    // The heading id is carried VERBATIM. Reducing it to its first digit run
    // made stories `5` and `5a` derive the same `S5.<n>` ids (and `2` and
    // `2.1` the same `S2.<n>`), so one story's criteria deduped away against
    // the other's and became unaddressable by any key.
    const story = block.id;
    if (!story) continue;
    let ordinal = 0;
    for (const type of ['happy', 'negative'] as const) {
      const body = sectionBody(
        block.text,
        type === 'happy' ? /happy\s*path/i : /negative\s*paths?/i,
      );
      if (body === null) continue;
      for (const item of listItems(body)) {
        if (!/\bgiven\b/i.test(item) || !/\bthen\b/i.test(item)) continue;
        ordinal += 1;
        ids.push(`S${story}.${ordinal}`);
      }
    }
  }
  return ids;
}

/**
 * Assess whether each accepted story has criteria the engine can derive.
 * Every story needs both a headed Happy Path and a headed Negative Paths
 * section, and each must hold at least one criterion. Every
 * bullet in those sections must have the Given/When/Then shape; silently
 * dropping a malformed bullet would let land seal an unreadable artifact.
 */
export function assessAcceptedStoryReadability(storiesText: string): AcceptedStoryReadability {
  const stories = splitStoryBlocks(storiesText).map((block) => ({
    id: block.id,
    readable: readSealedStoryCriteria(block.text).ok,
  }));

  return {
    stories,
    firstUnreadableStoryId: stories.find((story) => !story.readable)?.id,
  };
}
