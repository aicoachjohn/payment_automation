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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
