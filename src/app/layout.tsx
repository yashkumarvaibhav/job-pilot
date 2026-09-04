import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";

const themeBootstrap = `
try {
  var theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
} catch (error) {}
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://jobpilot.yashkumarvaibhav.me"),
  title: "Job Pilot",
  description: "A personal operating system for an off-campus job search.",
  openGraph: {
    title: "Job Pilot",
    description: "Run your job search from one clear workspace.",
    type: "website",
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Job Pilot — Run your job search from one clear workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Job Pilot",
    description: "Run your job search from one clear workspace.",
    images: ["/og.png"],
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="job-pilot-theme"
          nonce={nonce}
          strategy="beforeInteractive"
        >
          {themeBootstrap}
        </Script>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
