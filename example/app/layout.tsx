import "@uppy/core/css/style.css";
import "@uppy/dashboard/css/style.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "Wedding Uploads · Transloadit + Convex",
  description: "Guest uploads with Transloadit, Convex, and Uppy",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const body = convexUrl ? (
    <Providers convexUrl={convexUrl}>{children}</Providers>
  ) : (
    children
  );

  return (
    <html lang="en">
      <body>{body}</body>
    </html>
  );
}
