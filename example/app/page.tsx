import WeddingUploadsApp from "./WeddingUploadsApp";

export const dynamic = "force-dynamic";

export default async function WeddingUploadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ convexUrl?: string }> | { convexUrl?: string };
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const convexUrl =
    resolvedSearchParams?.convexUrl ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    process.env.CONVEX_URL ??
    null;
  return <WeddingUploadsApp convexUrl={convexUrl} />;
}
