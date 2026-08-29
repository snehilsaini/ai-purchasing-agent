import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Procura | AI Purchasing Agent",
  description: "Explainable, constraint-aware purchasing decisions for retail operations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
