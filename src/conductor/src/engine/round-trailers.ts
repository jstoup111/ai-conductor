/**
 * Validates the normalized output of Git's trailer parser for a routed leaf
 * commit. Callers obtain the text with either `interpret-trailers --parse` or
 * the `%(trailers:only,unfold)` pretty-format; both apply Git's trailer
 * grammar before this exact-one check runs.
 */
export function hasExactRoundOwnerTrailers(
  normalizedTrailers: string,
  expected: { readonly roundId: string; readonly owner: string },
): boolean {
  const values = (key: 'Round' | 'Owner') =>
    normalizedTrailers
      .split('\n')
      .flatMap((line) => {
        const match = line.match(new RegExp(`^${key}:\\s*(.*)$`, 'i'));
        return match === null ? [] : [match[1]!];
      });
  const rounds = values('Round');
  const owners = values('Owner');
  return rounds.length === 1 && rounds[0] === expected.roundId && owners.length === 1 && owners[0] === expected.owner;
}
