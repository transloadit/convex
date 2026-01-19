import WeddingUploadsClient from "./WeddingUploadsClient";

export const dynamic = "force-dynamic";

export default function WeddingUploadsPage({
  searchParams,
}: {
  searchParams?: { convexUrl?: string };
}) {
  const convexUrl =
    searchParams?.convexUrl ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    process.env.CONVEX_URL ??
    null;
  return <WeddingUploadsClient convexUrl={convexUrl} />;
}
