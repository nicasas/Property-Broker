import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
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
      <head>
        {/* Material Symbols, la iconografía de los mockups. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body className="bg-background text-body-md text-on-surface">
        <Sidebar />
        <div className="pl-sidebar-width">
          <Topbar brokers={brokers} active={active} />
          <main className="min-h-screen bg-surface pt-20">{children}</main>
        </div>
      </body>
    </html>
  );
}
