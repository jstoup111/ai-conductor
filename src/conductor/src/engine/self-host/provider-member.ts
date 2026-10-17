/** Make an auxiliary member safe for use as one filesystem path component. */
export function sanitizeProviderMember(member: string): string {
  let encoded = '';
  for (const unit of member) {
    if (/^[A-Za-z0-9._-]$/.test(unit)) {
      encoded += unit;
      continue;
    }
    // Escape UTF-16 code units with a fixed width so the encoding is injective,
    // including for unpaired surrogates that cannot be represented as UTF-8.
    for (let index = 0; index < unit.length; index += 1) {
      encoded += `%${unit.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase()}`;
    }
  }
  return encoded;
}
