import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HiWorkflow Consultorio",
  description: "Agenda, expedientes y atención por WhatsApp para consultorios."
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
