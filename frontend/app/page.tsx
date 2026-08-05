import Link from "next/link";
import { getAccounts, getCommissions, getListings } from "@/lib/api";
import type { Commission } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState, Money } from "@/components/ui";
import { SplitBar } from "@/components/split-bar";
import { involvesBroker } from "@/lib/identity";
import { getActiveBroker } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * La red, vista desde MI lugar.
 *
 * Los mismos datos que antes, ordenados por relevancia para el broker activo:
 * primero lo que me involucra, después lo que pasa en la red. La perspectiva es
 * de presentación — el backend sigue devolviendo todo igual.
 */
export default async function NetworkPage() {
  const [commissions, listings, accounts] = await Promise.all([
    getCommissions(),
    getListings(),
    getAccounts(),
  ]);

  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const listingOf = new Map(listings.map((l) => [l.id, l]));

  const mine = commissions.filter((c) => involvesBroker(c, me?.id));
  const minePending = mine.filter((c) => c.status === "PENDING");
  const myListings = listings.filter(
    (l) => l.listing_broker_account_id === me?.id,
  );

  const networkPending = commissions.filter(
    (c) => c.status === "PENDING" && !involvesBroker(c, me?.id),
  );
  const activity = buildActivity(commissions, nameOf, listingOf, me?.id).slice(0, 6);

  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Hola, {me?.name.split(" ")[0] ?? "broker"}
        </h1>
        <p className="mt-1.5 leading-relaxed text-muted">
          Esto es lo que se está moviendo en la red y lo que te toca a vos.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* El ancla del "yo": lo mío, arriba de todo. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="bg-brand p-5 sm:col-span-2">
              <p className="text-[0.8125rem] text-white/70">Lo que he ganado</p>
              <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-white">
                {formatMoney(me?.balance ?? 0)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                Acumulado de los repartos y pagos que pasaron por mi cuenta.
              </p>
            </Card>

            <Card className="p-5">
              <p className="text-[0.8125rem] text-muted">Mis inmuebles</p>
              <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-ink">
                {myListings.length}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-faint">
                Captados por mí, con acuerdo de reparto.
              </p>
            </Card>
          </div>

          <Card className={minePending.length > 0 ? "border-pending" : ""}>
            <CardHeader
              title="Mis comisiones pendientes"
              description="Reportadas y esperando aprobación. Te involucran directamente."
              action={
                <Link
                  href="/comisiones"
                  className="shrink-0 text-[0.8125rem] font-medium text-brand hover:underline"
                >
                  Ver todas
                </Link>
              }
            />
            {minePending.length === 0 ? (
              <EmptyState
                title="Nada tuyo pendiente"
                description="Cuando reportes una comisión, o alguien te incluya en un reparto, aparece acá."
              />
            ) : (
              <ul className="divide-y divide-line">
                {minePending.map((commission) => (
                  <li key={commission.id}>
                    <Link
                      href="/comisiones"
                      className="flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-canvas"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone="pending">
                            {myRole(commission, me?.id)}
                          </Badge>
                        </div>
                        <p className="mt-1.5 truncate text-sm font-medium text-ink">
                          {listingOf.get(commission.listing_id)?.address}
                        </p>
                        <p className="mt-0.5 truncate text-[0.8125rem] text-muted">
                          con{" "}
                          {counterpart(commission, me?.id, nameOf) ??
                            "la plataforma"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Money>{formatMoney(commission.gross_amount)}</Money>
                        <p className="mt-0.5 text-xs text-faint">a repartir</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Actividad de la red"
              description="Lo último que pasó entre los brokers."
            />
            {activity.length === 0 ? (
              <EmptyState title="Todavía no hay actividad" />
            ) : (
              <ul className="divide-y divide-line">
                {activity.map((event) => (
                  <li
                    key={event.id}
                    className={`flex gap-3 px-6 py-3.5 ${event.mine ? "bg-brand-soft/30" : ""}`}
                  >
                    <span
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${event.dot}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8125rem] leading-relaxed text-ink">
                        {event.text}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        {formatDate(event.at)}
                      </p>
                    </div>
                    {/* Solo las cifras de lo mío. De un negocio ajeno se ve que
                        ocurrió, no cuánto factura. */}
                    {event.mine ? (
                      <Money size="sm" tone="muted">
                        {formatMoney(event.amount)}
                      </Money>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Mis inmuebles"
              description="Los que capté, con su acuerdo."
              action={
                <Link
                  href="/inmuebles"
                  className="shrink-0 text-[0.8125rem] font-medium text-brand hover:underline"
                >
                  Ver todos
                </Link>
              }
            />
            {myListings.length === 0 ? (
              <EmptyState
                title="No captaste inmuebles todavía"
                description="Igual podés participar como broker que vende."
              />
            ) : (
              <ul className="divide-y divide-line">
                {myListings.slice(0, 4).map((listing) => (
                  <li key={listing.id} className="px-6 py-4">
                    <p className="truncate text-[0.8125rem] font-medium text-ink">
                      {listing.address}
                    </p>
                    <div className="mt-3">
                      <SplitBar
                        listingBps={listing.listing_broker_bps}
                        sellingBps={listing.selling_broker_bps}
                        platformBps={listing.platform_bps}
                        showLegend={false}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="En el resto de la red"
              description="Comisiones de otros brokers, en curso."
            />
            {networkPending.length === 0 ? (
              <EmptyState title="Nada más pendiente" />
            ) : (
              <ul className="divide-y divide-line">
                {networkPending.slice(0, 4).map((commission) => (
                  <li
                    key={commission.id}
                    className="flex items-center justify-between gap-3 px-6 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[0.8125rem] text-ink">
                        {listingOf.get(commission.listing_id)?.address}
                      </p>
                      <p className="truncate text-xs text-faint">
                        {nameOf.get(commission.reported_by_account_id)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-faint">
                      privado
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line px-6 py-3 text-xs leading-relaxed text-faint">
              Ves que la red se mueve, no cuánto factura cada broker.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Cómo participo yo en esta comisión. Un mismo broker puede tener dos roles. */
function myRole(commission: Commission, meId: string | undefined): string {
  const roles: string[] = [];
  if (commission.reported_by_account_id === meId) roles.push("reportaste");
  if (commission.listing_broker_account_id === meId) roles.push("captaste");
  if (commission.selling_broker_account_id === meId) roles.push("vendiste");
  return roles.join(" y ") || "participás";
}

/** El otro broker del reparto, dicho por nombre. */
function counterpart(
  commission: Commission,
  meId: string | undefined,
  nameOf: Map<string, string>,
): string | null {
  const otherId =
    commission.selling_broker_account_id === meId
      ? commission.listing_broker_account_id
      : commission.selling_broker_account_id;
  return otherId === meId ? null : (nameOf.get(otherId) ?? null);
}

type ActivityEvent = {
  id: string;
  at: string;
  text: string;
  amount: number;
  dot: string;
  mine: boolean;
};

/**
 * La actividad se cuenta como HECHOS DE NEGOCIO, no como asientos contables, y
 * en primera persona cuando me involucra.
 */
function buildActivity(
  commissions: Commission[],
  nameOf: Map<string, string>,
  listingOf: Map<string, { address: string }>,
  meId: string | undefined,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const who = (id: string) => (id === meId ? "Vos" : (nameOf.get(id) ?? "Un broker"));

  for (const c of commissions) {
    const address = listingOf.get(c.listing_id)?.address ?? "un inmueble";
    const mine = involvesBroker(c, meId);

    events.push({
      id: `${c.id}-reported`,
      at: c.created_at,
      text: `${who(c.reported_by_account_id)} reportó una comisión de ${address}`,
      amount: c.gross_amount,
      dot: "bg-pending",
      mine,
    });

    if (c.approved_at) {
      events.push({
        id: `${c.id}-executed`,
        at: c.approved_at,
        text: `Se repartió la comisión de ${address} entre ${who(c.reported_by_account_id)}, ${who(c.selling_broker_account_id)} y la plataforma`,
        amount: c.gross_amount,
        dot: "bg-positive",
        mine,
      });
    }

    if (c.rejected_at) {
      events.push({
        id: `${c.id}-rejected`,
        at: c.rejected_at,
        text: `Se rechazó la comisión de ${address}: ${c.rejection_reason}`,
        amount: c.gross_amount,
        dot: "bg-line-strong",
        mine,
      });
    }
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}
