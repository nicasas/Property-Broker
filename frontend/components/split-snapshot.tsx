"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

/**
 * Guarda los saldos previos a aprobar, POR ENCIMA del tablero.
 *
 * Antes esta foto vivía en el estado de la tarjeta, y funcionaba porque la lista
 * era una sola: al aprobar, la tarjeta conservaba posición y clave, no se
 * desmontaba, y podía mostrar el "antes → después".
 *
 * Con el tablero por columnas la tarjeta CAMBIA de columna al aprobarse, así que
 * React la desmonta y la vuelve a montar: el estado local se perdería y el
 * resultado del reparto desaparecería justo en el momento que hay que mostrar.
 *
 * Subir la foto a un contexto montado sobre las columnas la hace sobrevivir al
 * movimiento. La lógica de aprobación no cambia en nada —mismo endpoint, misma
 * clave de idempotencia, mismo refresh—; lo único que cambia es DÓNDE se guarda
 * el estado de presentación.
 */

type Snapshot = Record<string, number>;

type SplitSnapshotContext = {
  snapshotFor: (commissionId: string) => Snapshot | null;
  remember: (commissionId: string, balances: Snapshot) => void;
  forget: (commissionId: string) => void;
};

const Context = createContext<SplitSnapshotContext | null>(null);

export function SplitSnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});

  const snapshotFor = useCallback(
    (commissionId: string) => snapshots[commissionId] ?? null,
    [snapshots],
  );

  const remember = useCallback((commissionId: string, balances: Snapshot) => {
    setSnapshots((current) => ({ ...current, [commissionId]: balances }));
  }, []);

  const forget = useCallback((commissionId: string) => {
    setSnapshots((current) => {
      const next = { ...current };
      delete next[commissionId];
      return next;
    });
  }, []);

  return (
    <Context.Provider value={{ snapshotFor, remember, forget }}>
      {children}
    </Context.Provider>
  );
}

export function useSplitSnapshots(): SplitSnapshotContext {
  const context = useContext(Context);
  if (!context) {
    throw new Error(
      "useSplitSnapshots requiere <SplitSnapshotProvider> por encima.",
    );
  }
  return context;
}
