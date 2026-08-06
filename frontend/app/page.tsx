import Link from "next/link";
import { getAccounts, getCommissions, getListings } from "@/lib/api";
import type { Commission } from "@/lib/api";
import { formatBps, formatDate, formatMoney } from "@/lib/format";
import { Badge, Card, EmptyState, StatCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { involvesBroker } from "@/lib/identity";
import { getActiveBroker } from "@/lib/session";
import { listingImage } from "@/lib/imagery";

export const dynamic = "force-dynamic";

/**
 * INICIO — la red vista desde MI lugar.
 *
 * Los mismos datos que en el resto de la aplicación, ordenados por relevancia
 * para el broker activo: primero lo que me involucra, después lo que pasa en la
 * red. La perspectiva es de presentación; el backend devuelve todo igual.
 */
export default async function HomePage() {
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
  const mineSettled = mine.filter((c) => c.status === "EXECUTED");
  const myListings = listings.filter(
    (l) => l.listing_broker_account_id === me?.id,
  );
  const opportunities = listings.filter(
    (l) => l.listing_broker_account_id !== me?.id,
  );
  const bestOffer = opportunities.reduce(
    (max, l) => Math.max(max, l.selling_broker_bps),
    0,
  );
  const activity = buildActivity(commissions, nameOf, listingOf, me?.id).slice(0, 6);

  return (
    <div className="flex w-full flex-col">
      <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
        <div>
          <p className="flex items-center gap-xs text-label-sm-caps uppercase text-on-surface-variant">
            <span className="size-2 rounded-full bg-secondary" />
            La red
          </p>
          <h1 className="mt-xs text-headline-lg text-on-surface">
            Hola, {me?.name.split(" ")[0] ?? "broker"}
          </h1>
          <p className="mt-xs text-body-md text-on-surface-variant">
            Esto es lo que se está moviendo y lo que te toca a vos.
          </p>
        </div>
      </section>

      <section className="space-y-lg p-lg">
        <div className="grid grid-cols-1 gap-lg md:grid-cols-4">
          <StatCard
            label="En mi cuenta"
            value={formatMoney(me?.balance ?? 0)}
            icon="account_balance_wallet"
            tone="secondary"
            caption="Disponible ahora"
          />
          <StatCard
            label="Esperando aprobación"
            value={minePending.length}
            icon="pending_actions"
            caption={
              minePending.length === 0
                ? "Nada tuyo pendiente"
                : "Negocios tuyos sin liquidar"
            }
          />
          <StatCard
            label="Liquidadas"
            value={mineSettled.length}
            icon="task_alt"
            caption="Colaboraciones cerradas"
          />
          <StatCard
            label="Mis propiedades"
            value={myListings.length}
            icon="real_estate_agent"
            caption="Publicadas por vos"
          />
        </div>

        <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
          <div className="space-y-lg lg:col-span-2">
            <Card>
              <div className="flex items-center justify-between gap-md border-b border-surface-container-highest px-lg py-md">
                <div className="flex items-center gap-sm">
                  <Icon
                    name="pending_actions"
                    className="text-[20px] text-on-surface-variant"
                  />
                  <div>
                    <h2 className="text-label-md font-semibold text-on-surface">
                      Mis comisiones pendientes
                    </h2>
                    <p className="mt-xs text-label-md text-on-surface-variant">
                      Te involucran directamente y esperan aprobación.
                    </p>
                  </div>
                </div>
                <Link
                  href="/comisiones"
                  className="shrink-0 text-label-md font-semibold text-primary hover:underline"
                >
                  Ver tablero
                </Link>
              </div>

              {minePending.length === 0 ? (
                <EmptyState
                  icon="check_circle"
                  title="Nada tuyo pendiente"
                  description="Cuando reportes una comisión, o alguien te incluya en un reparto, aparece acá."
                />
              ) : (
                <ul className="divide-y divide-outline-variant/20">
                  {minePending.map((commission) => (
                    <li key={commission.id}>
                      <Link
                        href="/comisiones"
                        className="flex items-center justify-between gap-md px-lg py-md transition-colors hover:bg-surface-container-low"
                      >
                        <div className="min-w-0">
                          <Badge tone="pending" dot>
                            {roleOf(commission, me?.id)}
                          </Badge>
                          <p className="mt-sm truncate text-label-md font-semibold text-on-surface">
                            {listingOf.get(commission.listing_id)?.address}
                          </p>
                          <p className="mt-xs truncate text-label-md text-on-surface-variant">
                            con{" "}
                            {counterpart(commission, me?.id, nameOf) ??
                              "la plataforma"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="tnum text-headline-md text-on-surface">
                            {formatMoney(commission.gross_amount)}
                          </p>
                          <p className="text-label-sm-caps uppercase text-on-surface-variant/70">
                            a repartir
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="flex items-center gap-sm border-b border-surface-container-highest px-lg py-md">
                <Icon name="timeline" className="text-[20px] text-on-surface-variant" />
                <div>
                  <h2 className="text-label-md font-semibold text-on-surface">
                    Actividad de la red
                  </h2>
                  <p className="mt-xs text-label-md text-on-surface-variant">
                    Lo último que pasó entre los brokers.
                  </p>
                </div>
              </div>

              {activity.length === 0 ? (
                <EmptyState icon="timeline" title="Todavía no hay actividad" />
              ) : (
                <ul className="divide-y divide-outline-variant/20">
                  {activity.map((event) => (
                    <li
                      key={event.id}
                      className={`flex items-start gap-md px-lg py-md ${
                        event.mine ? "bg-secondary-container/20" : ""
                      }`}
                    >
                      <span
                        className={`mt-xs grid size-8 shrink-0 place-items-center rounded-full ${event.tone}`}
                      >
                        <Icon name={event.icon} className="text-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-label-md text-on-surface">{event.text}</p>
                        <p className="mt-xs text-label-sm-caps uppercase text-on-surface-variant/60">
                          {formatDate(event.at)}
                        </p>
                      </div>
                      {/* Solo las cifras de lo mío. De un negocio ajeno se ve que
                          ocurrió, no cuánto factura. */}
                      {event.mine ? (
                        <span className="tnum shrink-0 text-mono-data text-on-surface-variant">
                          {formatMoney(event.amount)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-label-sm-caps uppercase text-on-surface-variant/50">
                          privado
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-lg">
            <Card>
              <div className="flex items-center justify-between gap-md border-b border-surface-container-highest px-lg py-md">
                <div className="flex items-center gap-sm">
                  <Icon name="explore" className="text-[20px] text-on-surface-variant" />
                  <h2 className="text-label-md font-semibold text-on-surface">
                    Oportunidades
                  </h2>
                </div>
                <Link
                  href="/inmuebles"
                  className="shrink-0 text-label-md font-semibold text-primary hover:underline"
                >
                  Mercado
                </Link>
              </div>

              {opportunities.length === 0 ? (
                <EmptyState
                  icon="explore_off"
                  title="Nada disponible"
                  description="Cuando otro broker publique, aparece acá."
                />
              ) : (
                <>
                  <div className="px-lg pt-md">
                    <p className="text-label-sm-caps uppercase text-on-surface-variant">
                      Mejor comisión ofrecida
                    </p>
                    <p className="tnum mt-xs text-headline-lg text-secondary">
                      {formatBps(bestOffer)}
                    </p>
                  </div>
                  <ul className="mt-sm divide-y divide-outline-variant/20">
                    {opportunities.slice(0, 3).map((listing) => (
                      <li key={listing.id}>
                        <Link
                          href="/inmuebles"
                          className="flex items-center gap-sm px-lg py-sm transition-colors hover:bg-surface-container-low"
                        >
                          <img
                            src={listingImage(listing.id, 200)}
                            alt=""
                            aria-hidden
                            loading="lazy"
                            className="size-10 shrink-0 rounded-lg object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-label-md text-on-surface">
                              {listing.address}
                            </p>
                            <p className="truncate text-label-sm-caps uppercase text-on-surface-variant/70">
                              {nameOf.get(listing.listing_broker_account_id)}
                            </p>
                          </div>
                          <span className="tnum shrink-0 text-mono-data text-secondary">
                            {formatBps(listing.selling_broker_bps)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-md border-b border-surface-container-highest px-lg py-md">
                <div className="flex items-center gap-sm">
                  <Icon name="groups" className="text-[20px] text-on-surface-variant" />
                  <h2 className="text-label-md font-semibold text-on-surface">
                    Brokers de la red
                  </h2>
                </div>
                <Link
                  href="/brokers"
                  className="shrink-0 text-label-md font-semibold text-primary hover:underline"
                >
                  Ver todos
                </Link>
              </div>
              <ul className="divide-y divide-outline-variant/20">
                {brokers
                  .filter((b) => b.id !== me?.id)
                  .slice(0, 4)
                  .map((broker) => (
                    <li key={broker.id}>
                      <Link
                        href={`/brokers/${broker.id}`}
                        className="flex items-center gap-sm px-lg py-sm transition-colors hover:bg-surface-container-low"
                      >
                        <span className="grid size-8 place-items-center rounded-full bg-primary-container text-label-sm-caps text-on-primary-container">
                          {initials(broker.name)}
                        </span>
                        <span className="truncate text-label-md text-on-surface">
                          {broker.name}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}

function roleOf(commission: Commission, meId: string | undefined): string {
  const roles: string[] = [];
  if (commission.reported_by_account_id === meId) roles.push("reportaste");
  if (commission.listing_broker_account_id === meId) roles.push("captaste");
  if (commission.selling_broker_account_id === meId) roles.push("vendiste");
  return roles.join(" y ") || "participás";
}

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
  icon: string;
  tone: string;
  mine: boolean;
};

/**
 * La actividad se cuenta como HECHOS DE NEGOCIO, no como asientos contables, y
 * en segunda persona cuando me involucra.
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
      icon: "add_task",
      tone: "bg-tertiary-fixed text-on-tertiary-fixed",
      mine,
    });

    if (c.approved_at) {
      events.push({
        id: `${c.id}-executed`,
        at: c.approved_at,
        text: `Se repartió la comisión de ${address} entre ${who(c.reported_by_account_id)}, ${who(c.selling_broker_account_id)} y la plataforma`,
        amount: c.gross_amount,
        icon: "call_split",
        tone: "bg-secondary-container text-on-secondary-container",
        mine,
      });
    }

    if (c.rejected_at) {
      events.push({
        id: `${c.id}-rejected`,
        at: c.rejected_at,
        text: `Se rechazó la comisión de ${address}: ${c.rejection_reason}`,
        amount: c.gross_amount,
        icon: "cancel",
        tone: "bg-surface-container-high text-on-surface-variant",
        mine,
      });
    }
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
