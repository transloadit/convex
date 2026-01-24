import WeddingUploadsApp from "./WeddingUploadsApp";

export const dynamic = "force-dynamic";

const slugifyBranch = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const resolvePreviewConvexUrl = () => {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  if (!branch) return null;
  const slug = slugifyBranch(branch);
  if (!slug) return null;
  return `https://${slug}.convex.cloud`;
};

export default async function WeddingUploadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ convexUrl?: string }>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const convexUrl =
    resolvedSearchParams?.convexUrl ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    process.env.CONVEX_URL ??
    resolvePreviewConvexUrl();
  return <WeddingUploadsApp convexUrl={convexUrl} />;
}
