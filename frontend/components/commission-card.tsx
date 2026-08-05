import { Badge, Card, Money } from "@/components/ui";
import { SplitBar } from "@/components/split-bar";
import { formatDate, formatMoney } from "@/lib/format";
import type { Account, Commission, Listing } from "@/lib/api";

const statusLabel: Record<Commission["status"], string> = {
  PENDING: "Pendiente",
  EXECUTED: "Liquidada",
  REJECTED: "Rechazada",
};

const statusTone = {
  PENDING: "pending",
  EXECUTED: "positive",
  REJECTED: "neutral",
} as const;

export function CommissionCard({
  commission,
  listing,
  nameOf,
  actions,
  showAmounts = true,
}: {
  commission: Commission;
  listing?: Listing;
  nameOf: Map<string, string>;
  actions?: React.ReactNode;
  /**
   * Las cifras de un negocio ajeno no se muestran.
   *
   * Mismo criterio con el que el saldo de otro broker es privado: se ve QUE la
   * red se mueve —el inmueble, quiénes participan, en qué estado está— pero no
   * cuánto factura una operación en la que uno no es parte.
   */
  showAmounts?: boolean;
}) {
  const executed = commission.status === "EXECUTED";

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 px-6 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Badge tone={statusTone[commission.status]}>
              {statusLabel[commission.status]}
            </Badge>
            <span className="text-xs text-faint">
              {formatDate(commission.created_at)}
            </span>
          </div>
          <p className="mt-2 truncate text-sm font-medium text-ink">
            {listing?.address ?? "Inmueble"}
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
            Reporta{" "}
            <span className="text-ink">
              {nameOf.get(commission.reported_by_account_id)}
            </span>{" "}
            · vendió{" "}
            <span className="text-ink">
              {nameOf.get(commission.selling_broker_account_id)}
            </span>
          </p>
        </div>

        {showAmounts ? (
          <div className="shrink-0 text-right">
            <p className="text-xs text-faint">Comisión bruta</p>
            <Money size="lg">{formatMoney(commission.gross_amount)}</Money>
          </div>
        ) : (
          <div className="shrink-0 text-right">
            <p className="text-xs text-faint">Negocio de otros brokers</p>
            <p className="text-[0.8125rem] text-faint">Montos privados</p>
          </div>
        )}
      </div>

      <div className="border-t border-line px-6 py-4">
        <SplitBar
          listingBps={commission.listing_broker_bps}
          sellingBps={commission.selling_broker_bps}
          platformBps={commission.platform_bps}
        />
      </div>

      {executed && showAmounts && (
        <dl className="grid grid-cols-3 divide-x divide-line border-t border-line">
          <Share
            label={nameOf.get(commission.listing_broker_account_id) ?? "Capta"}
            role="Captó"
            cents={commission.listing_broker_share}
          />
          <Share
            label={nameOf.get(commission.selling_broker_account_id) ?? "Vende"}
            role="Vendió"
            cents={commission.selling_broker_share}
          />
          <Share label="Plataforma" role="Comisión" cents={commission.platform_share} />
        </dl>
      )}

      {commission.status === "REJECTED" && commission.rejection_reason && (
        <p className="border-t border-line px-6 py-4 text-[0.8125rem] text-muted">
          Rechazada por{" "}
          <span className="text-ink">{commission.rejected_by}</span>:{" "}
          {commission.rejection_reason}
        </p>
      )}

      {actions && (
        <div className="border-t border-line px-6 py-4">{actions}</div>
      )}
    </Card>
  );
}

function Share({
  label,
  role,
  cents,
}: {
  label: string;
  role: string;
  cents: number | null;
}) {
  return (
    <div className="px-6 py-4">
      <dt className="truncate text-[0.8125rem] text-ink">{label}</dt>
      <dd className="mt-0.5">
        <Money tone="positive">{formatMoney(cents ?? 0)}</Money>
        <p className="mt-0.5 text-xs text-faint">{role}</p>
      </dd>
    </div>
  );
}
