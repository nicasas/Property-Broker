"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { MutationError, create } from "@/lib/client";

/**
 * Sumar un broker a la red.
 *
 * Nace con saldo en cero: el saldo de un broker solo se mueve por el ledger, ya
 * sea por un reparto de comisión, un pago de otro broker o una comisión recibida
 * desde fuera. Nunca se fija a mano al crear la cuenta.
 */
export function AddBrokerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await create("/api/accounts", { name: name.trim() });
      setName("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof MutationError ? e.message : "No se pudo sumar el broker.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Sumar un broker
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
      <Field label="Nombre" hint="Entra a la red con saldo en cero.">
        <Input
          placeholder="Elena Vargas"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          autoFocus
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Sumando…" : "Sumar a la red"}
        </Button>
        <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>

      {error && <p className="text-[0.8125rem] text-negative">{error}</p>}
    </form>
  );
}
