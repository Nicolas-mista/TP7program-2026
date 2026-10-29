import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "RutaSur · Torre de control",
  description:
    "Plataforma de seguimiento de envios en tiempo real orientada a eventos: Kafka, MongoDB y Next.js.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
