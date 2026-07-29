type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export async function shippedRecordOnMain(
  repoCwd: string,
  slug: string,
  git: GitRunner,
): Promise<'present'> {
  await git(['fetch', 'origin', 'main'], { cwd: repoCwd });
  await git(
    ['cat-file', '-e', `origin/main:.docs/shipped/${slug}.md`],
    { cwd: repoCwd },
  );
  return 'present';
}
