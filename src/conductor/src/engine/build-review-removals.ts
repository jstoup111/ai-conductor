// ── Diff-derived removal evidence (build_review) ──────────────────────────
//
// This deliberately parses the already-assembled review diff. It must not
// inspect the working tree or invoke git: the grader receives evidence from
// precisely the same immutable input it is asked to judge.

/** A conservative inventory of API-shape removals visible in a unified diff. */
export interface BuildReviewRemovalContext {
  deletedFiles: string[];
  removedDeclarations: string[];
  removedMembers: Array<{ declaration: string; member: string }>;
}

const EMPTY_REMOVALS = (): BuildReviewRemovalContext => ({
  deletedFiles: [],
  removedDeclarations: [],
  removedMembers: [],
});

const exportedDeclaration = /^\s*export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)\b/;
const exportedType = /^\s*export\s+(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)\b/;

function hunkDeclaration(header: string): string | undefined {
  return header.slice(header.lastIndexOf('@@') + 2).match(exportedType)?.[1];
}

function removedMember(line: string): string | undefined {
  // A member has a TypeScript member-shaped prefix. Comments, strings, and
  // free-form mentions intentionally do not qualify as API evidence.
  if (/^\s*(?:\/\/|\/\*|\*|['"`])/.test(line)) return undefined;
  return line.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(?:\?)?\s*(?::|\(|=|,)/)?.[1];
}

/**
 * Derive removal evidence from unified-diff text. Parsing is deliberately
 * conservative: an unrecognised declaration is omitted rather than guessed.
 */
export function deriveBuildReviewRemovals(diff: string): BuildReviewRemovalContext {
  const result = EMPTY_REMOVALS();
  let currentPath: string | undefined;
  let renamed = false;
  let scope: string | undefined;

  for (const rawLine of diff.split('\n')) {
    const fileMatch = rawLine.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      currentPath = fileMatch[2];
      renamed = false;
      scope = undefined;
      continue;
    }
    if (/^(?:similarity index|rename from |rename to )/.test(rawLine)) {
      renamed = true;
      continue;
    }
    if (rawLine.startsWith('deleted file mode ')) {
      if (currentPath && !renamed) result.deletedFiles.push(currentPath);
      continue;
    }
    if (rawLine.startsWith('@@')) {
      scope = hunkDeclaration(rawLine);
      continue;
    }
    if (rawLine.startsWith(' ')) {
      scope = rawLine.slice(1).match(exportedType)?.[1] ?? scope;
      continue;
    }
    if (!rawLine.startsWith('-') || rawLine.startsWith('---')) continue;

    const removed = rawLine.slice(1);
    const declaration = /^\s*export\s+(?:declare\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*$/.test(removed)
      ? undefined
      : removed.match(exportedDeclaration)?.[1];
    if (declaration) {
      result.removedDeclarations.push(declaration);
      continue;
    }
    const member = scope && removedMember(removed);
    if (member) result.removedMembers.push({ declaration: scope, member });
  }

  return result;
}
