"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IdentitySwitcher } from "@/components/identity-switcher";
import type { Account } from "@/lib/api";

/**
 * El orden es el del negocio: la red primero, lo mío al final, la plomería aparte.
 *
 * Todo lo que se puede hacer tiene que ser alcanzable desde acá. Un botón que
 * solo aparece dentro de un desplegable es un botón que no existe.
 */
const links = [
  { href: "/", label: "La red" },
  { href: "/inmuebles", label: "Inmuebles" },
  { href: "/comisiones", label: "Comisiones" },
  { href: "/brokers", label: "Brokers" },
  { href: "/perfil", label: "Mi cuenta" },
];

export function Nav({
  brokers,
  active,
}: {
  brokers: Account[];
  active: Account | null;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-6 place-items-center rounded-md bg-brand text-[0.6875rem] font-bold text-white">
            PB
          </span>
          <span className="hidden text-[0.9375rem] font-semibold tracking-tight text-ink sm:block">
            Property Broker
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : link.href === "/brokers"
                  ? pathname === "/brokers"
                  : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-muted hover:bg-canvas hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {/* Discreto y al margen: el usuario no entra por acá. */}
          <Link
            href="/integridad"
            className={`hidden text-xs transition-colors sm:block ${
              pathname.startsWith("/integridad")
                ? "text-brand"
                : "text-faint hover:text-muted"
            }`}
          >
            Bajo el capó
          </Link>
          <IdentitySwitcher brokers={brokers} active={active} />
        </div>
      </div>
    </header>
  );
}
