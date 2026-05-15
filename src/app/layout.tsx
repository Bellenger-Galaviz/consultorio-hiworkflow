import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Control de asistencias y citas",
  description: "Sistema web para clientes, citas, asistencias y recordatorios por WhatsApp."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
