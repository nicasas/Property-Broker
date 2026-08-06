"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Money } from "@/components/ui";
import { MutationError, mutate } from "@/lib/client";
import { formatMoney, formatSignedMoney } from "@/lib/format";
import { participantsOf } from "@/lib/participants";
import { useSplitSnapshots } from "@/components/split-snapshot";
import type { Account, Commission } from "@/lib/api";

/**
 * El momento del split.
 *
 * Antes de aprobar se muestran los saldos actuales de las cuentas involucradas.
 * Al aprobar se toma una foto de esos saldos, se ejecuta y se llama a
 * `router.refresh()`: los Server Components vuelven a consultar la API y esta
 * misma tarjeta recibe los saldos nuevos, sin cambiar de pantalla.
 *
 * La foto NO vive acá sino en un contexto montado sobre el tablero: al aprobarse,
 * la tarjeta pasa de la columna "Pendientes" a "Liquidadas" y React la desmonta.
 * Guardarla arriba es lo que permite mostrar el "antes → después" con números
 * reales de las dos puntas. Ver components/split-snapshot.
 */
export function ApproveActions({
  commission,
  accounts,
}: {
  commission: Commission;
  accounts: Account[];
}) {
  const router = useRouter();
  // La foto de saldos vive sobre el tablero, no en esta tarjeta: al aprobarse,
  // la tarjeta se mueve de columna y se desmontaría. Ver components/split-snapshot.
  const { snapshotFor, remember, forget } = useSplitSnapshots();
  const before = snapshotFor(commission.id);
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const participants = participantsOf(commission, accounts);

  async function onApprove() {
    setError(null);
    setPending("approve");
    // Foto de los saldos ANTES de mover un peso.
    remember(
      commission.id,
      Object.fromEntries(participants.map((p) => [p.account.id, p.account.balance])),
    );

    try {
      await mutate(`/api/commissions/${commission.id}/approve`, {
        approved_by: "ops@habi.co",
      });
      router.refresh();
    } catch (e) {
      forget(commission.id);
      setError(
        e instanceof MutationError ? e.message : "No se pudo aprobar la comisión.",
      );
    } finally {
      setPending(null);
    }
  }

  async function onReject() {
    setError(null);
    setPending("reject");
    try {
      await mutate(`/api/commissions/${commission.id}/reject`, {
        rejected_by: "ops@habi.co",
        reason,
      });
      setRejecting(false);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof MutationError ? e.message : "No se pudo rechazar la comisión.",
      );
    } finally {
      setPending(null);
    }
  }

  // ---------------------------------------------------------------- ejecutada
  if (commission.status === "EXECUTED") {
    if (!before) return null; // se ejecutó en otra sesión: no hay foto previa
    return <SplitResult commission={commission} accounts={accounts} before={before} />;
  }

  if (commission.status !== "PENDING") return null;

  // ------------------------------------------------------------------ pendiente
  return (
    <div className="space-y-md">
      <div>
        <p className="text-label-sm-caps uppercase text-on-surface-variant">
          Saldos antes de aprobar
        </p>
        <ul className="mt-sm space-y-xs">
          {participants.map(({ account, roles }) => (
            <li
              key={account.id}
              className="flex items-baseline justify-between gap-md"
            >
              <span className="truncate text-label-md text-on-surface-variant">
                {account.name}
                <span className="ml-xs text-on-surface-variant/60">{roles.join(" y ")}</span>
              </span>
              <Money size="sm" tone="muted">
                {formatMoney(account.balance)}
              </Money>
            </li>
          ))}
        </ul>
      </div>

      {rejecting ? (
        <div className="flex items-center gap-sm">
          <Input
            placeholder="Motivo del rechazo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <Button
            variant="danger"
            onClick={onReject}
            disabled={pending !== null || !reason}
          >
            {pending === "reject" ? "Rechazando…" : "Confirmar"}
          </Button>
          <Button variant="ghost" onClick={() => setRejecting(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-sm">
          <Button onClick={onApprove} disabled={pending !== null}>
            {pending === "approve" ? "Ejecutando split…" : "Aprobar y liquidar"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}>
            Rechazar
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm text-label-md text-on-error-container">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * El resultado, ligado a ROLES y no solo a montos: quién entregó, quién recibió
 * y por qué. Los deltas salen de comparar la foto previa con los saldos que
 * acaba de devolver la API.
 */
function SplitResult({
  commission,
  accounts,
  before,
}: {
  commission: Commission;
  accounts: Account[];
  before: Record<string, number>;
}) {
  const participants = participantsOf(commission, accounts);

  const shares = [
    commission.listing_broker_share ?? 0,
    commission.selling_broker_share ?? 0,
    commission.platform_share ?? 0,
  ];
  const sharesTotal = shares.reduce((a, b) => a + b, 0);

  // Lo que la plataforma habría recibido por sus bps exactos; la diferencia es el
  // residuo que absorbe por construcción.
  const platformByBps = Math.floor(
    (commission.gross_amount * commission.platform_bps) / 10_000,
  );
  const residue = (commission.platform_share ?? 0) - platformByBps;

  const deltas = participants.map((p) => ({
    ...p,
    before: before[p.account.id] ?? p.account.balance,
    after: p.account.balance,
    delta: p.account.balance - (before[p.account.id] ?? p.account.balance),
  }));
  const deltaSum = deltas.reduce((sum, d) => sum + d.delta, 0);

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-sm">
        <span className="grid size-6 place-items-center rounded-full bg-secondary text-label-sm-caps text-on-secondary">
          ✓
        </span>
        <p className="text-label-md font-semibold text-on-surface">
          Split ejecutado
        </p>
      </div>

      {/* Movimiento de saldo, cuenta por cuenta. */}
      <ul className="space-y-sm">
        {deltas.map(({ account, roles, before: prev, after, delta }) => (
          <li key={account.id} className="flex items-center justify-between gap-md">
            <div className="min-w-0">
              <p className="truncate text-label-md font-semibold text-on-surface">
                {account.name}
              </p>
              <p className="text-label-sm-caps uppercase text-on-surface-variant/70">{roles.join(" y ")}</p>
            </div>

            <div className="flex shrink-0 items-center gap-sm">
              <span className="tnum text-mono-data text-on-surface-variant/60 line-through">
                {formatMoney(prev)}
              </span>
              <span className="text-on-surface-variant/60" aria-hidden>
                →
              </span>
              <span className="tnum text-mono-data text-on-surface">
                {formatMoney(after)}
              </span>
              <span
                className={`tnum w-32 text-right text-mono-data ${
                  delta < 0 ? "text-error" : "text-secondary"
                }`}
              >
                {formatSignedMoney(delta)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Los deltas suman cero: la plata solo se movió. */}
      <div className="flex items-center justify-between border-t border-surface-container-highest pt-sm">
        <span className="text-label-md text-on-surface-variant">
          Suma de los movimientos
        </span>
        <span className="tnum text-mono-data text-secondary">
          {formatMoney(deltaSum)}
        </span>
      </div>

      {/* El reparto, al centavo. */}
      <div className="rounded-xl bg-surface-container-low p-md">
        <p className="text-label-sm-caps uppercase text-on-surface-variant">
          El reparto suma exacto al bruto
        </p>
        <p className="tnum mt-sm text-body-md text-on-surface">
          {formatMoney(shares[0])} + {formatMoney(shares[1])} +{" "}
          {formatMoney(shares[2])} ={" "}
          <span className="font-semibold">{formatMoney(sharesTotal)}</span>
        </p>
        {residue !== 0 && (
          <p className="mt-sm text-label-md text-on-surface-variant">
            La división no da exacta: sobran{" "}
            <span className="tnum font-semibold text-on-surface">
              {formatMoney(residue)}
            </span>{" "}
            que la plataforma absorbe por construcción. Su parte no se calcula con
            un porcentaje, es lo que queda después de las dos anteriores — por eso
            la suma cierra siempre.
          </p>
        )}
      </div>
    </div>
  );
}
