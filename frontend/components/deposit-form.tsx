"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { MutationError, mutate } from "@/lib/client";
import { formatMoney, pesosToCents } from "@/lib/format";
import type { Account } from "@/lib/api";

/**
 * Registrar una comisión recibida desde fuera de la red.
 *
 * Por debajo es el `deposit` del núcleo bancario, pero el usuario no está
 * "cargando saldo" como en un cajero: está declarando que cobró una comisión
 * bruta afuera y la ingresa al sistema para poder repartirla. La contrapartida
 * sale de la cuenta externa, así que el ledger sigue cuadrando.
 */
export function DepositForm({ brokers }: { brokers: Account[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(brokers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const cents = pesosToCents(amount);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(null);
    setPending(true);

    try {
      await mutate("/api/deposits", {
        account_id: accountId,
        amount: cents,
        reference: "carga de saldo desde la consola",
      });
      setAmount("");
      setDone(`Se cargaron ${formatMoney(cents)}.`);
      // Refresca los Server Components: los saldos de arriba se actualizan solos.
      router.refresh();
    } catch (e) {
      setError(
        e instanceof MutationError ? e.message : "No se pudo cargar el saldo.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
      <Field label="Broker">
        <Select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          disabled={pending}
        >
          {brokers.map((broker) => (
            <option key={broker.id} value={broker.id}>
              {broker.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Monto" hint="En pesos. Se convierte a centavos para la API.">
        <Input
          inputMode="numeric"
          placeholder="1.500.000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={pending}
        />
      </Field>

      <Button type="submit" disabled={pending || cents <= 0} className="w-full">
        {pending ? "Cargando…" : "Cargar saldo"}
      </Button>

      {error && <p className="text-label-md text-error">{error}</p>}
      {done && <p className="text-label-md text-secondary">{done}</p>}
    </form>
  );
}
