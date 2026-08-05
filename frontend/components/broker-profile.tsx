import Link from "next/link";
import {
  getAccountLedger,
  getAccounts,
  getCommissions,
  getListings,
} from "@/lib/api";
import type { Account, Commission, LedgerEntry, Listing } from "@/lib/api";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState, Money } from "@/components/ui";

/**
 * Perfil de un broker: cuánto tiene y de dónde salió cada peso.
 *
 * Este es el ledger-con-contexto. Un banco muestra "COMMISSION_SPLIT −8.000.000";
 * acá cada movimiento dice de qué inmueble vino, con qué broker y por qué rol.
 * Los datos son exactamente los mismos: cambia que se cuentan.
 */
export async function BrokerProfile({
  broker,
  extra,
}: {
  broker: Account;
  extra?: React.ReactNode;
}) {
  const [entries, commissions, listings, accounts] = await Promise.all([
    getAccountLedger(broker.id),
    getCommissions(),
    getListings(),
    getAccounts(),
  ]);

  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const commissionOf = new Map(commissions.map((c) => [c.id, c]));
  const listingOf = new Map(listings.map((l) => [l.id, l]));

  const earned = entries
    .filter((e) => e.amount > 0)
    .reduce((sum, e) => sum + e.amount, 0);
  const paid = entries
    .filter((e) => e.amount < 0)
    .reduce((sum, e) => sum + e.amount, 0);

  const settled = commissions.filter(
    (c) =>
      c.status === "EXECUTED" &&
      (c.reported_by_account_id === broker.id ||
        c.listing_broker_account_id === broker.id ||
        c.selling_broker_account_id === broker.id),
  );

  return (
    <>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand text-lg font-semibold text-white">
            {initials(broker.name)}
          </span>
          <div>
            <p className="text-[0.8125rem] font-medium text-brand">Mi cuenta</p>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {broker.name}
            </h1>
            <p className="mt-1 text-[0.8125rem] text-muted">
              {settled.length === 0
                ? "Sin comisiones liquidadas todavía"
                : `${settled.length} comisión${settled.length > 1 ? "es" : ""} liquidada${settled.length > 1 ? "s" : ""}`}
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

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="bg-brand p-5">
          <p className="text-[0.8125rem] text-white/70">
            Tengo en mi cuenta
          </p>
          <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-white">
            {formatMoney(broker.balance)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[0.8125rem] text-muted">Recibido</p>
          <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-positive">
            {formatMoney(earned)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[0.8125rem] text-muted">Entregado</p>
          <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-ink">
            {formatMoney(Math.abs(paid))}
          </p>
        </Card>
      </div>

      {extra}

      <Card>
        <CardHeader
          title="Mi actividad"
          description="Cada movimiento, con el inmueble y el broker detrás."
        />
        {entries.length === 0 ? (
          <EmptyState
            title="Sin movimientos"
            description="Cuando recibas una comisión o participes de un reparto, aparece acá." 
          />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((entry) => {
              const detail = describe(
                entry,
                broker.id,
                commissionOf,
                listingOf,
                nameOf,
              );
              return (
                <li key={entry.id} className="flex gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink">
                        {detail.title}
                      </p>
                      {detail.badge && (
                        <Badge tone="neutral">{detail.badge}</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">
                      {detail.description}
                    </p>
                    <p className="mt-1 text-xs text-faint">
                      {formatDate(entry.created_at)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money tone={entry.amount > 0 ? "positive" : "negative"}>
                      {formatSignedMoney(entry.amount)}
                    </Money>
                    <p className="tnum mt-0.5 text-xs text-faint">
                      saldo {formatMoney(entry.balance_after)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

type Detail = { title: string; description: string; badge?: string };

/**
 * Traduce un asiento del ledger al hecho de negocio que lo originó.
 *
 * Para un reparto, `reference` guarda el id de la comisión, y de ahí salen el
 * inmueble, el otro broker y el rol por el que le tocó esa parte.
 */
function describe(
  entry: LedgerEntry,
  brokerId: string,
  commissionOf: Map<string, Commission>,
  listingOf: Map<string, Listing>,
  nameOf: Map<string, string>,
): Detail {

  if (entry.operation_type === "DEPOSIT") {
    return {
      title: "Comisión recibida desde fuera de la red",
      description: `Ingresó al sistema para poder repartirse. ${entry.reference ?? ""}`.trim(),
      badge: "Ingreso",
    };
  }

  if (entry.operation_type === "COMMISSION_SPLIT") {
    const commission = entry.reference
      ? commissionOf.get(entry.reference)
      : undefined;
    const address = commission
      ? (listingOf.get(commission.listing_id)?.address ?? "un inmueble")
      : "un inmueble";

    if (!commission) {
      return {
        title: "Reparto de comisión",
        description: "Movimiento de un split.",
        badge: "Reparto",
      };
    }

    const roles: string[] = [];
    if (commission.listing_broker_account_id === brokerId) roles.push("captaste");
    if (commission.selling_broker_account_id === brokerId) roles.push("vendiste");
    const roleText = roles.length > 0 ? roles.join(" y ") : "participaste";

    const otherId =
      commission.selling_broker_account_id === brokerId
        ? commission.listing_broker_account_id
        : commission.selling_broker_account_id;
    const other = otherId === brokerId ? null : nameOf.get(otherId);

    if (entry.amount < 0) {
      return {
        title: `Reparto de la comisión de ${address}`,
        description: `Entregaste la comisión bruta de ${formatMoney(commission.gross_amount)} que habías recibido${other ? `, para repartirla con ${other}` : ""} y la plataforma.`,
        badge: "Reparto",
      };
    }

    return {
      title: `Tu parte de ${address}`,
      description: `Te tocó porque ${roleText}${other ? `, junto a ${other}` : ""}. Comisión bruta: ${formatMoney(commission.gross_amount)}.`,
      badge: "Reparto",
    };
  }

  // TRANSFER
  const direction = entry.amount > 0 ? "Pago recibido" : "Pago enviado";
  return {
    title: direction,
    description: entry.reference
      ? `Concepto: ${entry.reference}`
      : "Transferencia directa entre brokers de la red.",
    badge: "Pago",
  };
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
