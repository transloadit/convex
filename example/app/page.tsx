import WeddingUploadsClient from "./WeddingUploadsClient";

export default function WeddingUploadsPage() {
  const convexUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? null;
  return <WeddingUploadsClient convexUrl={convexUrl} />;
}
