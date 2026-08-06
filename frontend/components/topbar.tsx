"use client";

import { IdentitySwitcher } from "@/components/identity-switcher";
import type { Account } from "@/lib/api";

/**
 * Barra superior fija de 80px, arrancando después del sidebar.
 *
 * En el mockup el bloque derecho es "Broker Principal / Premium Agent" con foto.
 * Acá ese lugar lo ocupa el selector de identidad: cumple la misma función
 * visual —decir quién sos— y además permite cambiar de perspectiva.
 */
export function Topbar({
  brokers,
  active,
}: {
  brokers: Account[];
  active: Account | null;
}) {
  return (
    <header className="fixed left-sidebar-width right-0 top-0 z-40 flex h-20 items-center justify-between bg-surface/80 px-lg backdrop-blur-xl">
      <div />
      <div className="flex items-center gap-lg">
        <IdentitySwitcher brokers={brokers} active={active} />
      </div>
    </header>
  );
}
