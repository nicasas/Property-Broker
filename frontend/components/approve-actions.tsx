"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Money } from "@/components/ui";
import { MutationError, mutate } from "@/lib/client";
import { formatMoney, formatSignedMoney } from "@/lib/format";
import { participantsOf } from "@/lib/participants";
import type { Account, Commission } from "@/lib/api";

/**
 * El momento del split.
 *
 * Antes de aprobar se muestran los saldos actuales de las cuentas involucradas.
 * Al aprobar se toma una foto de esos saldos, se ejecuta y se llama a
 * `router.refresh()`: los Server Components vuelven a consultar la API y esta
 * misma tarjeta recibe los saldos nuevos, sin cambiar de pantalla.
 *
 * La foto vive en estado de cliente y sobrevive al refresh porque el componente
 * no se desmonta: la lista de comisiones es una sola, ordenada por fecha, así que
 * la tarjeta conserva su posición y su clave. Por eso se puede mostrar
 * "antes → después" con números reales de las dos puntas.
 */
export function ApproveActions({
  commission,
  accounts,
}: {
  commission: Commission;
  accounts: Account[];
}) {
  const router = useRouter();
  const [before, setBefore] = useState<Record<string, number> | null>(null);
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const participants = participantsOf(commission, accounts);

  async function onApprove() {
    setError(null);
    setPending("approve");
    // Foto de los saldos ANTES de mover un peso.
    setBefore(
      Object.fromEntries(participants.map((p) => [p.account.id, p.account.balance])),
    );

    try {
      await mutate(`/api/commissions/${commission.id}/approve`, {
        approved_by: "ops@habi.co",
      });
      router.refresh();
    } catch (e) {
      setBefore(null);
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
    <div className="space-y-4">
      <div>
        <p className="text-[0.8125rem] font-medium text-ink">
          Saldos antes de aprobar
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {participants.map(({ account, roles }) => (
            <li
              key={account.id}
              className="flex items-baseline justify-between gap-4"
            >
              <span className="truncate text-[0.8125rem] text-muted">
                {account.name}
                <span className="ml-1.5 text-faint">{roles.join(" y ")}</span>
              </span>
              <Money size="sm" tone="muted">
                {formatMoney(account.balance)}
              </Money>
            </li>
          ))}
        </ul>
      </div>

      {rejecting ? (
        <div className="flex items-center gap-2">
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
        <div className="flex items-center gap-2">
          <Button onClick={onApprove} disabled={pending !== null}>
            {pending === "approve" ? "Ejecutando split…" : "Aprobar y liquidar"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}>
            Rechazar
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
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
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-full bg-positive text-[0.625rem] font-bold text-white">
          ✓
        </span>
        <p className="text-[0.9375rem] font-semibold tracking-tight text-ink">
          Split ejecutado
        </p>
      </div>

      {/* Movimiento de saldo, cuenta por cuenta. */}
      <ul className="space-y-2.5">
        {deltas.map(({ account, roles, before: prev, after, delta }) => (
          <li key={account.id} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-[0.8125rem] font-medium text-ink">
                {account.name}
              </p>
              <p className="text-xs text-faint">{roles.join(" y ")}</p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="tnum text-[0.8125rem] text-faint line-through decoration-faint/50">
                {formatMoney(prev)}
              </span>
              <span className="text-faint" aria-hidden>
                →
              </span>
              <span className="tnum text-[0.8125rem] font-semibold text-ink">
                {formatMoney(after)}
              </span>
              <span
                className={`tnum w-32 text-right text-[0.8125rem] font-semibold ${
                  delta < 0 ? "text-negative" : "text-positive"
                }`}
              >
                {formatSignedMoney(delta)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Los deltas suman cero: la plata solo se movió. */}
      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-[0.8125rem] text-muted">
          Suma de los movimientos
        </span>
        <span className="tnum text-[0.8125rem] font-semibold text-positive">
          {formatMoney(deltaSum)}
        </span>
      </div>

      {/* El reparto, al centavo. */}
      <div className="rounded-lg bg-canvas px-4 py-3.5">
        <p className="text-xs font-medium text-muted">
          El reparto suma exacto al bruto
        </p>
        <p className="tnum mt-1.5 text-[0.8125rem] leading-relaxed text-ink">
          {formatMoney(shares[0])} + {formatMoney(shares[1])} +{" "}
          {formatMoney(shares[2])} ={" "}
          <span className="font-semibold">{formatMoney(sharesTotal)}</span>
        </p>
        {residue !== 0 && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            La división no da exacta: sobran{" "}
            <span className="tnum font-medium text-ink">
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
