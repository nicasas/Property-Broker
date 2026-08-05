import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAccounts, getCommissions, getListings } from "@/lib/api";
import { formatBps, formatDate, formatMoney } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { SplitBar } from "@/components/split-bar";
import { getActiveBroker } from "@/lib/session";
import { involvesBroker } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * Perfil PÚBLICO de otro broker.
 *
 * No muestra su saldo ni sus movimientos: cuánto tiene en la cuenta y de dónde
 * salió cada peso es asunto suyo. Lo que sí es público es lo que aporta a la red
 * —los inmuebles que publicó— y los negocios que hicimos JUNTOS, porque de esos
 * los dos somos parte.
 */
export default async function BrokerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [accounts, listings, commissions] = await Promise.all([
    getAccounts(),
    getListings(),
    getCommissions(),
  ]);

  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const broker = brokers.find((b) => b.id === id);
  if (!broker) notFound();

  const me = await getActiveBroker(brokers);
  // Mi propio perfil vive en /perfil, con el saldo y los movimientos.
  if (me && broker.id === me.id) redirect("/perfil");

  const published = listings.filter(
    (l) => l.listing_broker_account_id === broker.id,
  );
  const together = commissions.filter(
    (c) => involvesBroker(c, broker.id) && involvesBroker(c, me?.id),
  );
  const listingOf = new Map(listings.map((l) => [l.id, l]));

  return (
    <>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-lg font-semibold text-brand">
            {initials(broker.name)}
          </span>
          <div>
            <p className="text-[0.8125rem] font-medium text-muted">
              Broker de la red
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {broker.name}
            </h1>
            <p className="mt-1 text-[0.8125rem] text-muted">
              {published.length === 0
                ? "Sin inmuebles publicados"
                : `${published.length} inmueble${published.length > 1 ? "s" : ""} publicado${published.length > 1 ? "s" : ""}`}
              {together.length > 0 &&
                ` · ${together.length} negocio${together.length > 1 ? "s" : ""} con vos`}
            </p>
          </div>
        </div>
        <Link
          href="/brokers"
          className="shrink-0 text-[0.8125rem] font-medium text-brand hover:underline"
        >
          Todos los brokers
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Sus inmuebles"
            description="Podés conseguir el cliente para cualquiera de estos."
          />
          {published.length === 0 ? (
            <EmptyState title="Todavía no publicó inmuebles" />
          ) : (
            <ul className="divide-y divide-line">
              {published.map((listing) => (
                <li key={listing.id} className="px-6 py-4">
                  <p className="text-[0.8125rem] font-medium text-ink">
                    {listing.address}
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-brand">
                    {formatBps(listing.selling_broker_bps)} para vos si traés el
                    cliente
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
            title="Negocios con vos"
            description="Comisiones donde participaron los dos."
          />
          {together.length === 0 ? (
            <EmptyState
              title="Todavía no trabajaron juntos"
              description="Cuando compartan una comisión, aparece acá."
            />
          ) : (
            <ul className="divide-y divide-line">
              {together.map((commission) => (
                <li key={commission.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.8125rem] font-medium text-ink">
                        {listingOf.get(commission.listing_id)?.address}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        {formatDate(commission.created_at)}
                      </p>
                    </div>
                    <Badge
                      tone={
                        commission.status === "EXECUTED"
                          ? "positive"
                          : commission.status === "PENDING"
                            ? "pending"
                            : "neutral"
                      }
                    >
                      {commission.status === "EXECUTED"
                        ? "Liquidada"
                        : commission.status === "PENDING"
                          ? "Pendiente"
                          : "Rechazada"}
                    </Badge>
                  </div>
                  <p className="tnum mt-2 text-[0.8125rem] text-muted">
                    Comisión bruta {formatMoney(commission.gross_amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-faint">
        El saldo y los movimientos de {broker.name.split(" ")[0]} son privados. Solo
        ves los negocios en los que participaste.
      </p>
    </>
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
