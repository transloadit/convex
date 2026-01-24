import "@uppy/core/css/style.css";
import "@uppy/dashboard/css/style.css";
import "./globals.css";

export const metadata = {
  title: "Wedding Uploads · Transloadit + Convex",
  description: "Guest uploads with Transloadit, Convex, and Uppy",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
