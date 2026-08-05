"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select } from "@/components/ui";
import { MutationError, mutate } from "@/lib/client";
import { formatMoney, pesosToCents } from "@/lib/format";
import type { Account, Listing } from "@/lib/api";

/**
 * Reportar una comisión cobrada. Queda PENDIENTE: no mueve un peso todavía.
 *
 * El broker que reporta es el que ya tiene la comisión bruta en su cuenta; al
 * aprobarse, el split sale de SU saldo hacia la plataforma y el otro broker.
 */
export function ReportCommissionForm({
  listings,
  brokers,
}: {
  listings: Listing[];
  brokers: Account[];
}) {
  const router = useRouter();
  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [reportedBy, setReportedBy] = useState("");
  const [sellingBroker, setSellingBroker] = useState("");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listing = listings.find((l) => l.id === listingId);
  const listingBroker = brokers.find(
    (b) => b.id === listing?.listing_broker_account_id,
  );
  const cents = pesosToCents(amount);

  // Por defecto reporta quien captó el inmueble: es el caso habitual.
  const effectiveReportedBy = reportedBy || listingBroker?.id || "";
  const reporter = brokers.find((b) => b.id === effectiveReportedBy);
  const notEnoughBalance = reporter ? reporter.balance < cents : false;

  const ready =
    listingId && effectiveReportedBy && sellingBroker && cents > 0 && evidence;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      await mutate("/api/commissions", {
        listing_id: listingId,
        reported_by_account_id: effectiveReportedBy,
        selling_broker_account_id: sellingBroker,
        gross_amount: cents,
        evidence,
      });
      setAmount("");
      setEvidence("");
      setSellingBroker("");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof MutationError ? e.message : "No se pudo reportar la comisión.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 px-6 py-5">
      <Field label="Inmueble">
        <Select
          value={listingId}
          onChange={(e) => {
            setListingId(e.target.value);
            setReportedBy("");
          }}
          disabled={pending}
        >
          {listings.map((l) => (
            <option key={l.id} value={l.id}>
              {l.address}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Reporta"
          hint={
            reporter
              ? `Saldo disponible: ${formatMoney(reporter.balance)}`
              : undefined
          }
        >
          <Select
            value={effectiveReportedBy}
            onChange={(e) => setReportedBy(e.target.value)}
            disabled={pending}
          >
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.id === listingBroker?.id ? " · captó" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Broker que vendió">
          <Select
            value={sellingBroker}
            onChange={(e) => setSellingBroker(e.target.value)}
            disabled={pending}
          >
            <option value="">Seleccionar…</option>
            {brokers
              .filter((b) => b.id !== effectiveReportedBy)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Comisión bruta" hint="En pesos.">
          <Input
            inputMode="numeric"
            placeholder="3.000.000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
          />
        </Field>

        <Field label="Evidencia" hint="Contrato o comprobante.">
          <Input
            placeholder="contrato-2026-041.pdf"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            disabled={pending}
          />
        </Field>
      </div>

      {notEnoughBalance && cents > 0 && (
        <p className="rounded-lg bg-pending-soft px-3 py-2 text-[0.8125rem] text-pending">
          {reporter?.name} tiene {formatMoney(reporter?.balance ?? 0)}. Se puede
          reportar igual, pero la aprobación va a fallar por saldo insuficiente
          hasta que se le cargue el faltante.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !ready}>
          {pending ? "Reportando…" : "Reportar comisión"}
        </Button>
        <span className="text-xs text-faint">Queda pendiente de aprobación.</span>
      </div>

      {error && <p className="text-[0.8125rem] text-negative">{error}</p>}
    </form>
  );
}
