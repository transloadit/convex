const raw =
  process.env.GITHUB_HEAD_REF ??
  process.env.GITHUB_REF_NAME ??
  process.env.VERCEL_GIT_COMMIT_REF ??
  '';

const slug = raw
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

if (!slug) {
  throw new Error('Missing branch name to slugify');
}

process.stdout.write(slug);
