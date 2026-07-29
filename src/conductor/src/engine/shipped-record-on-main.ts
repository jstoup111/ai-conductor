type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export async function shippedRecordOnMain(
  repoCwd: string,
  slug: string,
  git: GitRunner,
): Promise<'present' | 'absent'> {
  await git(['fetch', 'origin', 'main'], { cwd: repoCwd });
  try {
    await git(
      ['cat-file', '-e', `origin/main:.docs/shipped/${slug}.md`],
      { cwd: repoCwd },
    );
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 128
      && 'stdout' in error
      && error.stdout === ''
      && 'stderr' in error
      && typeof error.stderr === 'string'
      && error.stderr.startsWith('fatal: path ')
      && error.stderr.includes(" does not exist in 'origin/main'")
    ) {
      return 'absent';
    }
    throw error;
  }
  return 'present';
}
