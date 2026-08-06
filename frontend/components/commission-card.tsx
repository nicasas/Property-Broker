import { Badge, Money } from "@/components/ui";
import { Icon } from "@/components/icon";
import { formatBps, formatDate, formatMoney } from "@/lib/format";
import type { Commission, Listing } from "@/lib/api";

const statusLabel: Record<Commission["status"], string> = {
  PENDING: "Pendiente",
  EXECUTED: "Liquidada",
  REJECTED: "Rechazada",
};

const accentByStatus: Record<Commission["status"], string> = {
  PENDING: "border-l-on-tertiary-container",
  EXECUTED: "border-l-secondary shadow-secondary/5",
  REJECTED: "border-l-outline-variant",
};

/**
 * Tarjeta de colaboración, en el lenguaje del tablero de los mockups: superficie
 * sobre la columna, borde de acento a la izquierda según el estado.
 */
export function CommissionCard({
  commission,
  listing,
  nameOf,
  actions,
  myRole,
  showAmounts = true,
}: {
  commission: Commission;
  listing?: Listing;
  nameOf: Map<string, string>;
  actions?: React.ReactNode;
  /** Cómo participo yo, si participo. */
  myRole?: string;
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
    <div
      className={`rounded-xl border-l-4 bg-surface p-md shadow-sm transition-shadow hover:shadow-md ${accentByStatus[commission.status]}`}
    >
      <div className="flex items-start justify-between gap-sm">
        <div className="min-w-0">
          <p className="truncate text-label-md font-semibold text-on-surface">
            {listing?.address ?? "Inmueble"}
          </p>
          <p className="mt-xs flex items-center gap-xs text-label-sm-caps uppercase text-on-surface-variant">
            <Icon name="schedule" className="text-[14px]" />
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
          dot={commission.status === "PENDING"}
        >
          {statusLabel[commission.status]}
        </Badge>
      </div>

      {myRole && (
        <p className="mt-sm text-label-md text-on-surface-variant">
          <span className="font-semibold text-on-surface">{myRole}</span> en este
          negocio
        </p>
      )}

      <div className="mt-md flex items-center gap-sm">
        <Participant name={nameOf.get(commission.reported_by_account_id)} role="Reportó" />
        <Icon name="sync_alt" className="text-[16px] text-on-surface-variant/50" />
        <Participant
          name={nameOf.get(commission.selling_broker_account_id)}
          role="Vendió"
        />
      </div>

      <div className="mt-md flex items-center justify-between border-t border-surface-container-highest pt-sm">
        <span className="flex items-center gap-xs text-label-md text-on-surface-variant">
          <Icon name="local_offer" className="text-[16px]" />
          Split {formatBps(commission.listing_broker_bps)} /{" "}
          {formatBps(commission.selling_broker_bps)} /{" "}
          {formatBps(commission.platform_bps)}
        </span>
        {showAmounts ? (
          <Money>{formatMoney(commission.gross_amount)}</Money>
        ) : (
          <span className="text-label-sm-caps uppercase text-on-surface-variant/60">
            Privado
          </span>
        )}
      </div>

      {executed && showAmounts && (
        <dl className="mt-md grid grid-cols-3 gap-xs rounded-lg bg-surface-container-low p-sm">
          <Share
            label={nameOf.get(commission.listing_broker_account_id) ?? "Capta"}
            cents={commission.listing_broker_share}
          />
          <Share
            label={nameOf.get(commission.selling_broker_account_id) ?? "Vende"}
            cents={commission.selling_broker_share}
          />
          <Share label="Plataforma" cents={commission.platform_share} />
        </dl>
      )}

      {commission.status === "REJECTED" && commission.rejection_reason && (
        <p className="mt-sm rounded-lg bg-surface-container-low p-sm text-label-md text-on-surface-variant">
          {commission.rejected_by}: {commission.rejection_reason}
        </p>
      )}

      {actions && (
        <div className="mt-md border-t border-surface-container-highest pt-md">
          {actions}
        </div>
      )}
    </div>
  );
}

function Participant({ name, role }: { name?: string; role: string }) {
  return (
    <div className="flex min-w-0 items-center gap-xs">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-container text-label-sm-caps text-on-primary-container">
        {initials(name ?? "?")}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-label-md text-on-surface">{name}</span>
        <span className="text-label-sm-caps uppercase text-on-surface-variant/70">
          {role}
        </span>
      </span>
    </div>
  );
}

function Share({ label, cents }: { label: string; cents: number | null }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-label-sm-caps uppercase text-on-surface-variant">
        {label}
      </dt>
      <dd className="tnum mt-xs text-mono-data text-secondary">
        {formatMoney(cents ?? 0)}
      </dd>
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
