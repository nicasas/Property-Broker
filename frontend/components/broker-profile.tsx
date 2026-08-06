import {
  getAccountLedger,
  getAccounts,
  getCommissions,
  getListings,
} from "@/lib/api";
import type { Account, Commission, LedgerEntry, Listing } from "@/lib/api";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/format";
import { Badge, Card, EmptyState, StatCard } from "@/components/ui";
import { Icon } from "@/components/icon";

/**
 * DASHBOARD DE MIS COMISIONES.
 *
 * Arriba, las cifras. Al centro, la tabla de transacciones con el desglose por
 * rol. Abajo, la actividad: el ledger-con-contexto.
 *
 * Esa última parte es el punto de producto del reto. Un banco muestra
 * "COMMISSION_SPLIT −8.000.000"; acá cada movimiento dice de qué inmueble vino,
 * con qué broker y por qué rol tocaba esa parte. Los datos son los mismos
 * asientos: la traducción sale de `reference`, que guarda el id de la comisión.
 */
export async function BrokerProfile({
  broker,
  actions,
}: {
  broker: Account;
  actions?: React.ReactNode;
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

  const involved = commissions.filter(
    (c) =>
      c.reported_by_account_id === broker.id ||
      c.listing_broker_account_id === broker.id ||
      c.selling_broker_account_id === broker.id,
  );
  const settled = involved.filter((c) => c.status === "EXECUTED");
  const pending = involved.filter((c) => c.status === "PENDING");

  const earned = settled.reduce((sum, c) => sum + myShare(c, broker.id), 0);
  const pendingGross = pending.reduce((sum, c) => sum + c.gross_amount, 0);

  return (
    <div className="flex w-full flex-col">
      <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
        <div className="flex flex-col justify-between gap-md lg:flex-row lg:items-center">
          <div>
            <p className="text-label-sm-caps uppercase text-on-surface-variant">
              Mi cuenta · {broker.name}
            </p>
            <h1 className="mt-xs text-headline-lg text-on-surface">
              Dashboard de comisiones
            </h1>
            <p className="mt-xs text-body-md text-on-surface-variant">
              Lo que gané, lo que está en curso y de dónde salió cada peso.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-lg p-lg">
        <div className="grid grid-cols-1 gap-lg md:grid-cols-3">
          <StatCard
            label="En mi cuenta"
            value={formatMoney(broker.balance)}
            icon="account_balance_wallet"
            tone="secondary"
            caption="Saldo disponible ahora"
          />
          <StatCard
            label="Ganado en repartos"
            value={formatMoney(earned)}
            icon="trending_up"
            caption={`${settled.length} colaboración${settled.length === 1 ? "" : "es"} liquidada${settled.length === 1 ? "" : "s"}`}
          />
          <StatCard
            label="Comisiones pendientes"
            value={formatMoney(pendingGross)}
            icon="pending_actions"
            caption={
              pending.length === 0
                ? "Nada esperando aprobación"
                : `Esperando aprobación de ${pending.length} negocio${pending.length === 1 ? "" : "s"}`
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
          {actions && <div className="space-y-lg lg:col-span-1">{actions}</div>}

          <div
            className={`overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ${
              actions ? "lg:col-span-2" : "lg:col-span-3"
            }`}
          >
            <div className="flex items-center gap-sm border-b border-surface-container-highest px-lg py-md">
              <Icon name="receipt_long" className="text-[20px] text-on-surface-variant" />
              <h2 className="text-label-md font-semibold text-on-surface">
                Mis transacciones
              </h2>
            </div>

            {settled.length === 0 ? (
              <EmptyState
                icon="request_quote"
                title="Sin comisiones liquidadas"
                description="Cuando se apruebe una colaboración tuya, el desglose aparece acá."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-surface-container-low text-label-sm-caps uppercase tracking-wider text-on-surface-variant">
                      <th className="px-md py-sm font-semibold">Propiedad</th>
                      <th className="px-md py-sm font-semibold">Rol</th>
                      <th className="px-md py-sm text-right font-semibold">
                        Bruto
                      </th>
                      <th className="px-md py-sm text-right font-semibold">
                        Fee plat.
                      </th>
                      <th className="px-md py-sm text-right font-semibold">
                        Mi parte
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {settled.map((commission) => (
                      <tr key={commission.id} className="hover:bg-surface-container-low">
                        <td className="max-w-[220px] px-md py-sm">
                          <p className="truncate text-label-md text-on-surface">
                            {listingOf.get(commission.listing_id)?.address}
                          </p>
                          <p className="text-label-sm-caps uppercase text-on-surface-variant/70">
                            {formatDate(commission.approved_at ?? commission.created_at)}
                          </p>
                        </td>
                        <td className="px-md py-sm">
                          <Badge tone="neutral">
                            {rolesOf(commission, broker.id)}
                          </Badge>
                        </td>
                        <td className="tnum px-md py-sm text-right text-mono-data text-on-surface-variant">
                          {formatMoney(commission.gross_amount)}
                        </td>
                        <td className="tnum px-md py-sm text-right text-mono-data text-on-surface-variant">
                          {formatMoney(commission.platform_share ?? 0)}
                        </td>
                        <td className="tnum px-md py-sm text-right text-mono-data text-secondary">
                          {formatMoney(myShare(commission, broker.id))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <Card>
          <div className="flex items-center gap-sm border-b border-surface-container-highest px-lg py-md">
            <Icon name="history" className="text-[20px] text-on-surface-variant" />
            <div>
              <h2 className="text-label-md font-semibold text-on-surface">
                Mi actividad
              </h2>
              <p className="mt-xs text-label-md text-on-surface-variant">
                Cada movimiento, con el inmueble y el broker detrás.
              </p>
            </div>
          </div>

          {entries.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="Sin movimientos"
              description="Cuando recibas una comisión o participes de un reparto, aparece acá."
            />
          ) : (
            <ul className="divide-y divide-outline-variant/20">
              {entries.map((entry) => {
                const detail = describe(
                  entry,
                  broker.id,
                  commissionOf,
                  listingOf,
                  nameOf,
                );
                return (
                  <li key={entry.id} className="flex gap-md px-lg py-md">
                    <span
                      className={`mt-xs grid size-8 shrink-0 place-items-center rounded-full ${detail.tone}`}
                    >
                      <Icon name={detail.icon} className="text-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-label-md font-semibold text-on-surface">
                        {detail.title}
                      </p>
                      <p className="mt-xs text-label-md text-on-surface-variant">
                        {detail.description}
                      </p>
                      <p className="mt-xs text-label-sm-caps uppercase text-on-surface-variant/60">
                        {formatDate(entry.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`tnum text-mono-data ${
                          entry.amount > 0 ? "text-secondary" : "text-on-surface"
                        }`}
                      >
                        {formatSignedMoney(entry.amount)}
                      </p>
                      <p className="tnum mt-xs text-label-sm-caps uppercase text-on-surface-variant/60">
                        saldo {formatMoney(entry.balance_after)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

/** Lo que me tocó a mí en una comisión: puedo tener dos roles a la vez. */
function myShare(commission: Commission, brokerId: string): number {
  let total = 0;
  if (commission.listing_broker_account_id === brokerId)
    total += commission.listing_broker_share ?? 0;
  if (commission.selling_broker_account_id === brokerId)
    total += commission.selling_broker_share ?? 0;
  return total;
}

function rolesOf(commission: Commission, brokerId: string): string {
  const roles: string[] = [];
  if (commission.listing_broker_account_id === brokerId) roles.push("Captó");
  if (commission.selling_broker_account_id === brokerId) roles.push("Vendió");
  if (roles.length === 0 && commission.reported_by_account_id === brokerId)
    roles.push("Reportó");
  return roles.join(" y ");
}

type Detail = {
  title: string;
  description: string;
  icon: string;
  tone: string;
};

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
      description:
        `Ingresó al sistema para poder repartirse. ${entry.reference ?? ""}`.trim(),
      icon: "input",
      tone: "bg-secondary-container text-on-secondary-container",
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
        icon: "call_split",
        tone: "bg-surface-container-high text-on-surface-variant",
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
        icon: "call_split",
        tone: "bg-surface-container-high text-on-surface-variant",
      };
    }

    return {
      title: `Tu parte de ${address}`,
      description: `Te tocó porque ${roleText}${other ? `, junto a ${other}` : ""}. Comisión bruta: ${formatMoney(commission.gross_amount)}.`,
      icon: "call_split",
      tone: "bg-secondary-container text-on-secondary-container",
    };
  }

  const incoming = entry.amount > 0;
  return {
    title: incoming ? "Pago recibido" : "Pago enviado",
    description: entry.reference
      ? `Concepto: ${entry.reference}`
      : "Transferencia directa entre brokers de la red.",
    icon: incoming ? "call_received" : "call_made",
    tone: incoming
      ? "bg-secondary-container text-on-secondary-container"
      : "bg-surface-container-high text-on-surface-variant",
  };
}
