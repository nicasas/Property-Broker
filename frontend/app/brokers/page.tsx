import Link from "next/link";
import { getAccounts, getListings } from "@/lib/api";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { AddBrokerForm } from "@/components/add-broker-form";
import { getActiveBroker } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Los brokers de la red, vistos como COLEGAS.
 *
 * El saldo de otro broker NO se muestra: cuánto tiene en su cuenta es asunto
 * suyo. Lo que sí es público es lo que aporta a la red — cuántos inmuebles tiene
 * publicados— porque es con lo que uno decide con quién trabajar.
 *
 * El saldo propio vive en "Mi cuenta", donde también se registra lo que entra.
 */
export default async function BrokersPage() {
  const [accounts, listings] = await Promise.all([getAccounts(), getListings()]);
  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);

  const listingsBy = new Map<string, number>();
  for (const listing of listings) {
    listingsBy.set(
      listing.listing_broker_account_id,
      (listingsBy.get(listing.listing_broker_account_id) ?? 0) + 1,
    );
  }

  const others = brokers.filter((b) => b.id !== me?.id);

  return (
    <>
      <PageHeader
        eyebrow="La red"
        title="Brokers"
        description="Con quiénes podés cerrar negocios. Cada uno publica inmuebles y participa de los repartos."
        action={<AddBrokerForm />}
      />

      <Card>
        <CardHeader
          title="Otros brokers"
          description={`${others.length} además de vos`}
        />
        {others.length === 0 ? (
          <EmptyState
            title="Sos el único broker por ahora"
            description="Sumá a alguien más para poder repartir comisiones."
          />
        ) : (
          <ul className="divide-y divide-line">
            {others.map((broker) => (
              <li key={broker.id}>
                <Link
                  href={`/brokers/${broker.id}`}
                  className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-canvas"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-[0.8125rem] font-semibold text-brand">
                      {initials(broker.name)}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {broker.name}
                      </p>
                      <p className="text-xs text-faint">
                        {publishedLabel(listingsBy.get(broker.id) ?? 0)}
                      </p>
                    </div>
                  </div>
                  <span className="text-[0.8125rem] text-brand">Ver perfil</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-6 py-3.5 text-xs leading-relaxed text-faint">
          El saldo de cada broker es privado: solo ves el tuyo, en{" "}
          <Link href="/perfil" className="font-medium text-brand hover:underline">
            Mi cuenta
          </Link>
          .
        </p>
      </Card>

      {me && (
        <Card className="mt-6">
          <CardHeader
            title="Vos"
            description="Tu cuenta, tu saldo y tus movimientos."
          />
          <Link
            href="/perfil"
            className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-canvas"
          >
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-brand text-[0.8125rem] font-semibold text-white">
                {initials(me.name)}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{me.name}</p>
                <p className="text-xs text-faint">
                  {publishedLabel(listingsBy.get(me.id) ?? 0)}
                </p>
              </div>
            </div>
            <Badge tone="brand">Mi cuenta</Badge>
          </Link>
        </Card>
      )}
    </>
  );
}

function publishedLabel(count: number): string {
  if (count === 0) return "Sin inmuebles publicados";
  return `${count} inmueble${count > 1 ? "s" : ""} publicado${count > 1 ? "s" : ""}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
