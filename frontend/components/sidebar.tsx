"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";

/**
 * Navegación lateral fija de 280px, como en los mockups.
 *
 * El orden es el del trabajo de un broker: primero lo que hay para vender, luego
 * lo suyo, después los negocios compartidos y por último su dinero. "Bajo el
 * capó" queda separado abajo: no es parte del flujo, es la prueba de que la
 * contabilidad cuadra.
 */
const links = [
  { href: "/", label: "Inicio", icon: "dashboard" },
  { href: "/inmuebles", label: "Mercado", icon: "explore" },
  { href: "/mis-propiedades", label: "Mis propiedades", icon: "real_estate_agent" },
  { href: "/comisiones", label: "Colaboraciones", icon: "handshake" },
  { href: "/perfil", label: "Mis comisiones", icon: "payments" },
  { href: "/brokers", label: "Brokers", icon: "groups" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-full w-sidebar-width flex-col bg-surface-container-low shadow-[0_0_24px_rgba(0,0,0,0.02)]">
      <div className="mb-md flex h-20 items-center px-lg">
        <span className="mr-sm grid size-8 place-items-center rounded-lg bg-primary text-label-sm-caps font-bold text-on-primary">
          PB
        </span>
        <span className="text-headline-md text-primary">Property Broker</span>
      </div>

      <nav className="flex-1 space-y-base px-md">
        {links.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center rounded-xl px-md py-sm transition-all ${
                active
                  ? "bg-secondary-container font-semibold text-on-secondary-container"
                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              }`}
            >
              <Icon name={link.icon} className="mr-md" />
              <span className="text-label-md">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-md pb-lg">
        <Link
          href="/integridad"
          className={`group flex items-center rounded-xl px-md py-sm transition-all ${
            pathname.startsWith("/integridad")
              ? "bg-surface-container-high text-on-surface"
              : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          }`}
        >
          <Icon name="verified_user" className="mr-md text-[20px]" />
          <span className="text-label-md">Bajo el capó</span>
        </Link>
      </div>
    </aside>
  );
}
