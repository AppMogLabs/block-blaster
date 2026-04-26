import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { BackgroundLogo } from "@/components/BackgroundLogo";
import { ApproveBanner } from "@/components/ApproveBanner";
import { WelcomeModal } from "@/components/WelcomeModal";

export const metadata: Metadata = {
  title: "Block Blaster — The chain never stops",
  description:
    "A real-time onchain arcade game built on MegaETH. Blast blocks before they bury you.",
  manifest: "/manifest.json",
  applicationName: "Block Blaster",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Block Blaster",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: "/icons/icon-192.svg",
    apple: "/icons/icon-192.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#19191A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <BackgroundLogo />
        <Providers>
          <WelcomeModal />
          <ApproveBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
