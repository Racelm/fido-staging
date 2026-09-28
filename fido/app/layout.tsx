import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fido — Espace cabinet & clients",
  description: "La plateforme simple pour collaborer avec vos clients.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
