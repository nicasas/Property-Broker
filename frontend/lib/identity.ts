/**
 * Piezas de identidad que corren en LOS DOS LADOS.
 *
 * Vive separado de `session.ts` porque aquel importa `next/headers`, que solo
 * existe en el servidor: si el switcher —que es un componente cliente— importara
 * de ahí, Next intentaría meter código de servidor en el bundle del navegador y
 * la aplicación no compila.
 */

export const ACTIVE_BROKER_COOKIE = "pb_active_broker";

/** Si el broker activo participa de la comisión, con cualquier rol. */
export function involvesBroker(
  commission: {
    reported_by_account_id: string;
    listing_broker_account_id: string;
    selling_broker_account_id: string;
  },
  brokerId: string | undefined,
): boolean {
  if (!brokerId) return false;
  return (
    commission.reported_by_account_id === brokerId ||
    commission.listing_broker_account_id === brokerId ||
    commission.selling_broker_account_id === brokerId
  );
}
