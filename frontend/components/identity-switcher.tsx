"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ACTIVE_BROKER_COOKIE } from "@/lib/identity";
import { formatMoney } from "@/lib/format";
import type { Account } from "@/lib/api";

/**
 * Selector de identidad. NO es un login.
 *
 * Escribe una cookie con el id del broker activo y refresca los Server
 * Components: toda la aplicación se vuelve a renderizar desde la perspectiva de
 * esa persona. Es la pieza que convierte una vista de administrador en un
 * producto con un "yo".
 */
export function IdentitySwitcher({
  brokers,
  active,
}: {
  brokers: Account[];
  active: Account | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function switchTo(id: string) {
    // 30 días. La cookie no está firmada ni es segura a propósito: simula una
    // sesión, no la protege.
    document.cookie = `${ACTIVE_BROKER_COOKIE}=${id}; path=/; max-age=${60 * 60 * 24 * 30}`;
    setOpen(false);
    router.refresh();
  }

  if (!active) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-lg border border-line py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-canvas"
      >
        <span className="grid size-7 place-items-center rounded-md bg-brand text-[0.6875rem] font-semibold text-white">
          {initials(active.name)}
        </span>
        <span className="text-left leading-tight">
          <span className="block text-[0.8125rem] font-medium text-ink">
            {active.name}
          </span>
          {/* El saldo, siempre a la vista: es el dato que un broker quiere
              chequear sin tener que navegar a ningún lado. */}
          <span className="tnum block text-[0.6875rem] font-semibold text-brand">
            {formatMoney(active.balance)}
          </span>
        </span>
        <svg
          viewBox="0 0 12 12"
          className={`size-3 text-faint transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
          />
          <div className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-xs text-faint">Actuando como</span>
              <Link
                href="/perfil"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-brand hover:underline"
              >
                Ver mi cuenta
              </Link>
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {brokers.map((broker) => (
                <li key={broker.id}>
                  <button
                    onClick={() => switchTo(broker.id)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-canvas ${
                      broker.id === active.id ? "bg-brand-soft/50" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="grid size-7 place-items-center rounded-md bg-canvas text-[0.6875rem] font-semibold text-muted">
                        {initials(broker.name)}
                      </span>
                      <span className="text-[0.8125rem] text-ink">
                        {broker.name}
                      </span>
                    </span>
                    {/* Solo el saldo propio. El de los demás es privado, y este
                        desplegable no es una excepción. */}
                    {broker.id === active.id && (
                      <span className="tnum text-xs text-brand">
                        {formatMoney(broker.balance)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-faint">
              Simula una sesión. En producción esta identidad vendría de
              autenticación real.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
