"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { SplitBar } from "@/components/split-bar";
import { MutationError, create } from "@/lib/client";
import type { Account } from "@/lib/api";

/**
 * Publicar un inmueble en la red.
 *
 * El broker activo queda como quien lo captó. Define el acuerdo de reparto: qué
 * porcentaje se lleva él, cuánto el broker que traiga al cliente y cuánto la
 * plataforma.
 *
 * La interfaz trabaja en PORCENTAJES porque es como piensa un broker, y convierte
 * a basis points enteros antes de mandar. La validación de que sumen 100% es una
 * ayuda: el backend y la base de datos lo exigen igual.
 */
export function PublishListingForm({ me }: { me: Account }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [listingPct, setListingPct] = useState("40");
  const [sellingPct, setSellingPct] = useState("40");
  const [platformPct, setPlatformPct] = useState("20");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toBps = (pct: string) => Math.round((Number(pct) || 0) * 100);
  const listingBps = toBps(listingPct);
  const sellingBps = toBps(sellingPct);
  const platformBps = toBps(platformPct);
  const totalBps = listingBps + sellingBps + platformBps;

  const balanced = totalBps === 10_000;
  const ready = address.trim().length > 0 && balanced;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await create("/api/listings", {
        address: address.trim(),
        listing_broker_account_id: me.id,
        listing_broker_bps: listingBps,
        selling_broker_bps: sellingBps,
        platform_bps: platformBps,
      });
      setAddress("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof MutationError ? e.message : "No se pudo publicar el inmueble.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Publicar un inmueble</Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-outline-variant bg-surface p-6"
    >
      <div>
        <p className="text-label-md font-semibold tracking-tight text-on-surface">
          Publicar un inmueble
        </p>
        <p className="mt-1 text-label-md leading-relaxed text-on-surface-variant">
          Lo captás vos. Definí cómo se reparte la comisión cuando alguien lo venda.
        </p>
      </div>

      <Field label="Dirección">
        <Input
          placeholder="Cra 11 # 82-01, El Nogal"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={pending}
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Para vos">
          <Input
            inputMode="decimal"
            value={listingPct}
            onChange={(e) => setListingPct(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="Quien venda">
          <Input
            inputMode="decimal"
            value={sellingPct}
            onChange={(e) => setSellingPct(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="Plataforma">
          <Input
            inputMode="decimal"
            value={platformPct}
            onChange={(e) => setPlatformPct(e.target.value)}
            disabled={pending}
          />
        </Field>
      </div>

      {balanced ? (
        <SplitBar
          listingBps={listingBps}
          sellingBps={sellingBps}
          platformBps={platformBps}
        />
      ) : (
        <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-label-md text-on-tertiary-fixed">
          Los tres porcentajes tienen que sumar exactamente 100%. Ahora suman{" "}
          <span className="tnum font-medium">{(totalBps / 100).toFixed(2)}%</span>.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || !ready}>
          {pending ? "Publicando…" : "Publicar"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} type="button">
          Cancelar
        </Button>
      </div>

      {error && <p className="text-label-md text-error">{error}</p>}
    </form>
  );
}
