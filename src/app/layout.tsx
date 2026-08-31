import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Pilot",
  description: "A personal operating system for an off-campus job search.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
