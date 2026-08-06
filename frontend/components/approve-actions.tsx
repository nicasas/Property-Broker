"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { Icon } from "@/components/icon";
import { MutationError, mutate } from "@/lib/client";
import { formatMoney, formatSignedMoney } from "@/lib/format";
import { participantsOf } from "@/lib/participants";
import { useSplitSnapshots } from "@/components/split-snapshot";
import type { Account, Commission } from "@/lib/api";

/**
 * El momento del split.
 *
 * Al aprobar se toma una foto del saldo propio, se ejecuta y se llama a
 * `router.refresh()`: los Server Components vuelven a consultar la API y esta
 * misma tarjeta recibe los saldos nuevos, sin cambiar de pantalla.
 *
 * QUÉ SE MUESTRA Y QUÉ NO. Del reparto se ve cuánto le tocó a cada parte —es un
 * negocio compartido, las dos puntas conocen los montos— pero el SALDO de las
 * otras cuentas no aparece: con cuánto queda otro broker es asunto suyo, igual
 * que en el resto de la aplicación. El "antes → después" es solo del broker
 * activo.
 *
 * La foto NO vive acá sino en un contexto montado sobre el tablero: al aprobarse,
 * la tarjeta pasa de la columna "Esperando aprobación" a "Liquidadas" y React la
 * desmonta. Guardarla arriba es lo que permite mostrar la transición.
 * Ver components/split-snapshot.
 */
export function ApproveActions({
  commission,
  accounts,
  meId,
}: {
  commission: Commission;
  accounts: Account[];
  /** Broker activo: el único cuyo saldo se puede mostrar. */
  meId: string | undefined;
}) {
  const router = useRouter();
  const { snapshotFor, remember, forget } = useSplitSnapshots();
  const before = snapshotFor(commission.id);
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const participants = participantsOf(commission, accounts);
  const me = accounts.find((a) => a.id === meId);
  const others = participants.filter((p) => p.account.id !== meId);

  async function onApprove() {
    setError(null);
    setPending("approve");
    // Foto del saldo propio ANTES de mover un peso. De las otras cuentas no se
    // guarda nada: no se van a mostrar.
    if (me) remember(commission.id, { [me.id]: me.balance });

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
    if (!before || !me) return null; // se ejecutó en otra sesión: no hay foto previa
    return (
      <SplitResult
        commission={commission}
        me={me}
        others={others}
        beforeMine={before[me.id] ?? me.balance}
      />
    );
  }

  if (commission.status !== "PENDING") return null;

  // ------------------------------------------------------------------ pendiente
  return (
    <div className="space-y-md">
      {me && (
        <div className="flex items-baseline justify-between gap-md rounded-lg bg-surface-container-low px-md py-sm">
          <span className="text-label-sm-caps uppercase text-on-surface-variant">
            Tu saldo ahora
          </span>
          <span className="tnum text-mono-data text-on-surface">
            {formatMoney(me.balance)}
          </span>
        </div>
      )}

      {rejecting ? (
        <div className="flex flex-wrap items-center gap-sm">
          <Input
            placeholder="Motivo del rechazo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-w-[12rem] flex-1"
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
          <Button onClick={onApprove} disabled={pending !== null} icon="bolt">
            {pending === "approve" ? "Ejecutando…" : "Aprobar y repartir"}
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
 * El resultado del reparto.
 *
 * Del broker activo se muestra la transición completa de su saldo. Del resto,
 * SOLO lo que recibió en este negocio — nunca con cuánto quedó.
 */
function SplitResult({
  commission,
  me,
  others,
  beforeMine,
}: {
  commission: Commission;
  me: Account;
  others: ReturnType<typeof participantsOf>;
  beforeMine: number;
}) {
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

  const myDelta = me.balance - beforeMine;

  /** Lo que se movió en la cuenta de cada otra parte, sin revelar su saldo. */
  const movementOf = (accountId: string) => {
    let amount = 0;
    if (commission.listing_broker_account_id === accountId)
      amount += commission.listing_broker_share ?? 0;
    if (commission.selling_broker_account_id === accountId)
      amount += commission.selling_broker_share ?? 0;
    if (accountId === commission.reported_by_account_id)
      amount -= commission.gross_amount;
    return amount;
  };

  const otherMovements = others
    .map((p) => ({ ...p, delta: movementOf(p.account.id) }))
    .filter((p) => p.delta !== 0);

  const total = myDelta + otherMovements.reduce((sum, p) => sum + p.delta, 0);

  return (
    <div className="space-y-md">
      <div className="flex items-center gap-sm">
        <span className="grid size-6 place-items-center rounded-full bg-secondary">
          <Icon name="check" className="text-[14px] text-on-secondary" />
        </span>
        <p className="text-label-md font-semibold text-on-surface">
          Reparto ejecutado
        </p>
      </div>

      {/* Mi cuenta: la única de la que se puede mostrar el saldo. */}
      <div className="rounded-xl bg-surface-container-low p-md">
        <p className="text-label-sm-caps uppercase text-on-surface-variant">
          Tu cuenta
        </p>
        <div className="mt-sm flex flex-wrap items-baseline gap-x-sm gap-y-xs">
          <span className="tnum text-mono-data text-on-surface-variant/60 line-through">
            {formatMoney(beforeMine)}
          </span>
          <Icon name="arrow_forward" className="text-[16px] text-on-surface-variant/60" />
          <span className="tnum text-headline-md text-on-surface">
            {formatMoney(me.balance)}
          </span>
          <span
            className={`tnum ml-auto text-mono-data ${
              myDelta < 0 ? "text-error" : "text-secondary"
            }`}
          >
            {formatSignedMoney(myDelta)}
          </span>
        </div>
      </div>

      {/* Las otras partes: cuánto recibieron, nunca con cuánto quedaron. */}
      {otherMovements.length > 0 && (
        <div>
          <p className="text-label-sm-caps uppercase text-on-surface-variant">
            Lo que recibió cada parte
          </p>
          <ul className="mt-sm space-y-xs">
            {otherMovements.map(({ account, roles, delta }) => (
              <li
                key={account.id}
                className="flex items-center justify-between gap-md"
              >
                <span className="min-w-0 truncate text-label-md text-on-surface">
                  {account.name}
                  <span className="ml-xs text-on-surface-variant/70">
                    {roles.join(" y ")}
                  </span>
                </span>
                <span
                  className={`tnum shrink-0 text-mono-data ${
                    delta < 0 ? "text-error" : "text-secondary"
                  }`}
                >
                  {formatSignedMoney(delta)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Los movimientos suman cero: la plata solo se movió. */}
      <div className="flex items-center justify-between border-t border-surface-container-highest pt-sm">
        <span className="text-label-md text-on-surface-variant">
          Suma de los movimientos
        </span>
        <span className="tnum text-mono-data text-secondary">
          {formatMoney(total)}
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
