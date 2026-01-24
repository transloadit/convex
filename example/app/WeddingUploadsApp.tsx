"use client";

import dynamic from "next/dynamic";

const WeddingUploadsClient = dynamic(() => import("./WeddingUploadsClient"), {
  ssr: false,
});

export default function WeddingUploadsApp({
  convexUrl,
}: {
  convexUrl?: string | null;
}) {
  return <WeddingUploadsClient convexUrl={convexUrl} />;
}
