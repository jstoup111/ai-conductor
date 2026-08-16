// ── Diff-derived removal evidence (build_review) ──────────────────────────
//
// This deliberately parses the already-assembled review diff. It must not
// inspect the working tree or invoke git: the grader receives evidence from
// precisely the same immutable input it is asked to judge.

/** A conservative inventory of API-shape removals visible in a unified diff. */
export interface BuildReviewRemovalContext {
  readonly deletedFiles: readonly string[];
  readonly removedDeclarations: readonly string[];
  readonly removedMembers: readonly { declaration: string; member: string }[];
  readonly removedTestAssertions?: readonly { path: string; line: string }[];
}

const EMPTY_REMOVALS = (): BuildReviewRemovalContext => ({
  deletedFiles: [],
  removedDeclarations: [],
  removedMembers: [],
});

const exportedDeclaration = /^\s*export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)\b/;
const exportedType = /^\s*export\s+(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)\b/;
const testPath = /(?:^|\/)(?:test|tests|__tests__)\/.+\.(?:[cm]?[jt]sx?)$/;
const activeAssertion = /\b(?:expect|assert)\s*(?:\.|\()/;

function hunkDeclaration(header: string): string | undefined {
  return header.slice(header.lastIndexOf('@@') + 2).match(exportedType)?.[1];
}

function removedMember(line: string): string | undefined {
  // A member has a TypeScript member-shaped prefix. Comments, strings, and
  // free-form mentions intentionally do not qualify as API evidence.
  if (/^\s*(?:\/\/|\/\*|\*|['"`])/.test(line)) return undefined;
  return line.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(?:\?)?\s*(?::|\(|=|,)/)?.[1];
}

function declarationIdentity(line: string): string | undefined {
  return /^\s*export\s+(?:declare\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*$/.test(line)
    ? undefined
    : line.match(exportedDeclaration)?.[1];
}

/**
 * Only old-side context and removals participate in comment state. Any line
 * touching a block delimiter is intentionally omitted: reconstructing mixed
 * code/comment syntax from a diff would be less reliable than no evidence.
 */
function canReadOldCandidate(line: string, state: { inBlockComment: boolean }): boolean {
  const trimmed = line.trimStart();
  if (state.inBlockComment) {
    const end = trimmed.indexOf('*/');
    if (end === -1) return false;
    state.inBlockComment = false;
    return false;
  }

  const blockStart = trimmed.indexOf('/*');
  const blockEnd = trimmed.indexOf('*/');
  if (blockStart !== -1 || blockEnd !== -1) {
    if (blockStart !== -1 && (blockEnd === -1 || blockEnd < blockStart)) state.inBlockComment = true;
    return false;
  }
  return !/^\/\/|^\*|^['"`]/.test(trimmed);
}

/**
 * Derive removal evidence from unified-diff text. Parsing is deliberately
 * conservative: an unrecognised declaration is omitted rather than guessed.
 */
export function deriveBuildReviewRemovals(diff: string): BuildReviewRemovalContext {
  const result = {
    ...EMPTY_REMOVALS(),
    deletedFiles: [] as string[],
    removedDeclarations: [] as string[],
    removedMembers: [] as Array<{ declaration: string; member: string }>,
    removedTestAssertions: [] as Array<{ path: string; line: string }>,
  };
  let currentPath: string | undefined;
  let renamed = false;
  let scope: string | undefined;
  let oldSyntax = { inBlockComment: false };
  const addedDeclarations = new Set<string>();
  const addedMembers = new Set<string>();

  for (const rawLine of diff.split('\n')) {
    const fileMatch = rawLine.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      currentPath = fileMatch[2];
      renamed = false;
      scope = undefined;
      oldSyntax = { inBlockComment: false };
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
      const context = rawLine.slice(1);
      const candidate = canReadOldCandidate(context, oldSyntax);
      if (!candidate) continue;
      scope = context.match(exportedType)?.[1] ?? (context.trim() === '}' || context.trim() === '};' ? undefined : scope);
      continue;
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      const added = rawLine.slice(1);
      const declaration = declarationIdentity(added);
      if (declaration) addedDeclarations.add(declaration);
      const member = scope && removedMember(added);
      if (scope && member) addedMembers.add(`${scope}\u0000${member}`);
      continue;
    }
    if (!rawLine.startsWith('-') || rawLine.startsWith('---')) continue;

    const removed = rawLine.slice(1);
    if (!canReadOldCandidate(removed, oldSyntax)) continue;
    if (currentPath && !renamed && testPath.test(currentPath) && activeAssertion.test(removed)) {
      result.removedTestAssertions.push({ path: currentPath, line: removed });
    }
    const declaration = declarationIdentity(removed);
    if (declaration) {
      result.removedDeclarations.push(declaration);
      continue;
    }
    const member = scope && removedMember(removed);
    if (scope && member) result.removedMembers.push({ declaration: scope, member });
  }

  return {
    deletedFiles: result.deletedFiles,
    removedDeclarations: result.removedDeclarations.filter((declaration) => !addedDeclarations.has(declaration)),
    removedMembers: result.removedMembers.filter(({ declaration, member }) => !addedMembers.has(`${declaration}\u0000${member}`)),
    ...(result.removedTestAssertions?.length === 0 ? {} : { removedTestAssertions: result.removedTestAssertions }),
  };
}
