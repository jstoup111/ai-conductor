/** A behavior reference declared by a test's `Covers:` marker. */
export type CoversReference =
  | { readonly kind: 'fr'; readonly id: string }
  | { readonly kind: 'criterion'; readonly id: string }
  | { readonly kind: 'task'; readonly id: string };

const COVERS_MARKER = /\bCovers\s*:\s*([^\r\n]*)/g;
const FR_REFERENCE = /^FR-\d+$/;
const CRITERION_REFERENCE = /^S\d+\.\d+$/;
const TASK_REFERENCE = /^task:([A-Za-z0-9._-]+)$/;

/**
 * Parses behavior references declared in `Covers:` comment lines or suite
 * titles. The marker is intentionally text-only: callers need no knowledge of
 * a source file's language, comment syntax, or test framework.
 */
export function parseCoversMarkers(text: string): CoversReference[] {
  const references: CoversReference[] = [];

  for (const marker of text.matchAll(COVERS_MARKER)) {
    for (const rawToken of marker[1].split(',')) {
      const token = rawToken.trim();

      if (FR_REFERENCE.test(token)) {
        references.push({ kind: 'fr', id: token });
      } else if (CRITERION_REFERENCE.test(token)) {
        references.push({ kind: 'criterion', id: token });
      } else {
        const task = token.match(TASK_REFERENCE);
        if (task) {
          references.push({ kind: 'task', id: task[1] });
        } else {
          throw new Error(`Invalid Covers reference: ${token}`);
        }
      }
    }
  }

  return references;
}
