import type { Metadata } from "next";
import { Inter, Poppins, Geist_Mono } from "next/font/google";
import "./globals.css";

// Body — clean, neutral. Self-hosted by next/font (CSP-safe: served from the app origin).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

// Display — geometric + bold, matching the ProITbridge corporate voice.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// Mono — money with Indian digit grouping, Transaction IDs.
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ProITbridge — Payment & Enrollment Automation",
  description:
    "Internal three-stage payment workflow: Sales → Data Management (L1 audit) → Finance.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (password managers / form fillers)
          stamp attributes like `__processed_…` onto <body> before React hydrates, which is a
          benign server/client diff outside our control. This suppresses that one-level warning
          only — it does not hide real mismatches in the app tree. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
