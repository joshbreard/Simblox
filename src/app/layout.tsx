import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Simblox",
  description: "3D Physics Simulation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, overflow: "hidden" }}>{children}</body>
    </html>
  );
}
