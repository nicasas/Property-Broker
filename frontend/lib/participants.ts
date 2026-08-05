import type { Account, Commission } from "@/lib/api";

export type Participant = {
  account: Account;
  /** Una cuenta puede tener varios roles a la vez. */
  roles: string[];
};

/**
 * Las cuentas que toca un split, con sus roles.
 *
 * Se acumulan por cuenta y no por rol, igual que el backend arma las patas del
 * movimiento: si el broker que reporta es también el que captó el inmueble, es
 * UNA cuenta con dos roles y un solo movimiento neto — no dos líneas que se
 * cancelan entre sí.
 */
export function participantsOf(
  commission: Commission,
  accounts: Account[],
): Participant[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const platform = accounts.find((a) => a.account_type === "PLATFORM");

  const roles = new Map<string, string[]>();
  const add = (id: string | undefined, role: string) => {
    if (!id) return;
    roles.set(id, [...(roles.get(id) ?? []), role]);
  };

  add(commission.reported_by_account_id, "reportó");
  add(commission.listing_broker_account_id, "captó");
  add(commission.selling_broker_account_id, "vendió");
  add(platform?.id, "plataforma");

  return [...roles.entries()]
    .map(([id, list]) => ({ account: byId.get(id)!, roles: list }))
    .filter((p) => p.account !== undefined);
}
