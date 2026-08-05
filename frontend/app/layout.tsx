import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/nav";
import { getAccounts } from "@/lib/api";
import { getActiveBroker } from "@/lib/session";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Property Broker — Red de brokers inmobiliarios",
  description:
    "Red de brokers inmobiliarios que liquidan comisiones compartidas.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // La identidad activa se resuelve en el layout para que TODA la aplicación
  // comparta la misma perspectiva sin que cada pantalla la vuelva a calcular.
  let brokers: Awaited<ReturnType<typeof getAccounts>> = [];
  try {
    brokers = (await getAccounts()).filter((a) => a.account_type === "BROKER");
  } catch {
    // Si la API no responde, la barra se degrada sin switcher en vez de tumbar
    // la aplicación entera.
  }
  const active = await getActiveBroker(brokers);

  return (
    <html lang="es" className={inter.variable}>
      <body className="min-h-screen antialiased">
        <Nav brokers={brokers} active={active} />
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
