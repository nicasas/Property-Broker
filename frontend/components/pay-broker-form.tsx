"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { MutationError, mutate } from "@/lib/client";
import { formatMoney, pesosToCents } from "@/lib/format";
import type { Account } from "@/lib/api";

/**
 * Pagarle a otro broker. Transferencia directa entre cuentas de la red.
 *
 * Es el `POST /transfers` del núcleo bancario: sale de MI saldo y entra al del
 * destinatario, en una sola transacción. Si no me alcanza, no se mueve nada.
 *
 * El destinatario se elige POR NOMBRE. Un UUID no es algo que una persona pueda
 * verificar antes de mandar plata.
 */
export function PayBrokerForm({
  me,
  others,
}: {
  me: Account;
  others: Account[];
}) {
  const router = useRouter();
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const cents = pesosToCents(amount);
  const recipient = others.find((b) => b.id === toAccountId);
  const notEnough = cents > me.balance;
  const ready = toAccountId !== "" && cents > 0 && !notEnough;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    setPending(true);

    try {
      await mutate("/api/transfers", {
        from_account_id: me.id,
        to_account_id: toAccountId,
        amount: cents,
        reference: reference.trim() || null,
      });
      setDone(`Le pagaste ${formatMoney(cents)} a ${recipient?.name}.`);
      setAmount("");
      setReference("");
      setToAccountId("");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof MutationError ? e.message : "No se pudo hacer el pago.",
      );
    } finally {
      setPending(false);
    }
  }

  if (others.length === 0) {
    return (
      <p className="px-6 py-5 text-label-md text-on-surface-variant">
        No hay otros brokers en la red todavía.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
      <Field label="A quién le pagás">
        <Select
          value={toAccountId}
          onChange={(e) => setToAccountId(e.target.value)}
          disabled={pending}
        >
          <option value="">Seleccionar broker…</option>
          {others.map((broker) => (
            <option key={broker.id} value={broker.id}>
              {broker.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monto" hint={`Tenés ${formatMoney(me.balance)}`}>
          <Input
            inputMode="numeric"
            placeholder="500.000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
          />
        </Field>

        <Field label="Concepto" hint="Opcional. Queda en el historial de los dos.">
          <Input
            placeholder="Adelanto de la venta de El Nogal"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={pending}
          />
        </Field>
      </div>

      {notEnough && (
        <p className="rounded-lg bg-error-container px-3 py-2 text-label-md text-error">
          No te alcanza: tenés {formatMoney(me.balance)} y querés pagar{" "}
          {formatMoney(cents)}.
        </p>
      )}

      <Button type="submit" disabled={pending || !ready}>
        {pending
          ? "Pagando…"
          : recipient
            ? `Pagarle a ${recipient.name.split(" ")[0]}`
            : "Pagar"}
      </Button>

      {error && <p className="text-label-md text-error">{error}</p>}
      {done && <p className="text-label-md text-secondary">{done}</p>}
    </form>
  );
}
