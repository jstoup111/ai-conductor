/**
 * The provider catalog constructs adapters, while the git guard reaches
 * routing state. Every adapter resolves the guard through this one lazy
 * boundary at dispatch time, so catalog loading stays pure.
 */
export async function ensureGitGuardForDispatch(cwd: string | undefined): Promise<string | null> {
  const guard = await import('../engine/git-guard.js');
  return guard.ensureGitGuardForDispatch(cwd);
}
