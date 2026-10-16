/** Make an auxiliary member safe for use as one filesystem path component. */
export function sanitizeProviderMember(member: string): string {
  return member.replace(/[^A-Za-z0-9._-]/g, '_');
}
