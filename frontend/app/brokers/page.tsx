import Link from "next/link";
import { getAccounts, getCommissions, getListings } from "@/lib/api";
import { Badge, Card, EmptyState, StatCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { AddBrokerForm } from "@/components/add-broker-form";
import { getActiveBroker } from "@/lib/session";
import { involvesBroker } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * Los brokers de la red, vistos como COLEGAS.
 *
 * El saldo de otro broker NO se muestra: cuánto tiene en su cuenta es asunto
 * suyo. Lo que sí es público es lo que aporta a la red —cuántos inmuebles
 * publicó y si trabajaron juntos— porque es con eso que uno decide con quién
 * hacer negocios.
 *
 * El saldo propio vive en "Mis comisiones".
 */
export default async function BrokersPage() {
  const [accounts, listings, commissions] = await Promise.all([
    getAccounts(),
    getListings(),
    getCommissions(),
  ]);

  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);
  const others = brokers.filter((b) => b.id !== me?.id);

  const listingsBy = new Map<string, number>();
  for (const listing of listings) {
    listingsBy.set(
      listing.listing_broker_account_id,
      (listingsBy.get(listing.listing_broker_account_id) ?? 0) + 1,
    );
  }

  const dealsWithMe = new Map<string, number>();
  for (const commission of commissions) {
    if (!involvesBroker(commission, me?.id)) continue;
    for (const id of [
      commission.reported_by_account_id,
      commission.listing_broker_account_id,
      commission.selling_broker_account_id,
    ]) {
      if (id === me?.id) continue;
      dealsWithMe.set(id, (dealsWithMe.get(id) ?? 0) + 1);
    }
  }

  return (
    <div className="flex w-full flex-col">
      <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
        <div className="flex flex-col justify-between gap-md lg:flex-row lg:items-center">
          <div>
            <p className="text-label-sm-caps uppercase text-on-surface-variant">
              La red
            </p>
            <h1 className="mt-xs text-headline-lg text-on-surface">Brokers</h1>
            <p className="mt-xs text-body-md text-on-surface-variant">
              Con quiénes podés cerrar negocios. Cada uno publica inmuebles y
              participa de los repartos.
            </p>
          </div>
          <AddBrokerForm />
        </div>
      </section>

      <section className="space-y-lg p-lg">
        <div className="grid grid-cols-1 gap-lg md:grid-cols-3">
          <StatCard
            label="Brokers en la red"
            value={brokers.length}
            icon="groups"
            caption="Incluyéndote a vos"
          />
          <StatCard
            label="Inmuebles publicados"
            value={listings.length}
            icon="real_estate_agent"
            caption="Entre todos"
          />
          <StatCard
            label="Colegas con negocios tuyos"
            value={dealsWithMe.size}
            icon="handshake"
            caption="Compartieron una comisión con vos"
          />
        </div>

        {others.length === 0 ? (
          <Card>
            <EmptyState
              icon="person_add"
              title="Sos el único broker por ahora"
              description="Sumá a alguien más para poder repartir comisiones."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-lg md:grid-cols-2 xl:grid-cols-3">
            {others.map((broker) => {
              const published = listingsBy.get(broker.id) ?? 0;
              const deals = dealsWithMe.get(broker.id) ?? 0;
              return (
                <Link
                  key={broker.id}
                  href={`/brokers/${broker.id}`}
                  className="flex flex-col rounded-xl bg-surface-container-lowest p-lg shadow-sm transition-all hover:shadow-xl"
                >
                  <div className="flex items-start justify-between gap-sm">
                    <span className="grid size-12 place-items-center rounded-full bg-primary-container text-label-md font-semibold text-on-primary-container">
                      {initials(broker.name)}
                    </span>
                    {deals > 0 && (
                      <Badge tone="positive">
                        {deals} negocio{deals > 1 ? "s" : ""} con vos
                      </Badge>
                    )}
                  </div>

                  <p className="mt-md text-headline-md text-on-surface">
                    {broker.name}
                  </p>
                  <p className="mt-xs flex items-center gap-xs text-label-md text-on-surface-variant">
                    <Icon name="apartment" className="text-[16px]" />
                    {published === 0
                      ? "Sin inmuebles publicados"
                      : `${published} inmueble${published > 1 ? "s" : ""} publicado${published > 1 ? "s" : ""}`}
                  </p>

                  <div className="mt-md flex items-center justify-between border-t border-surface-container-highest pt-md">
                    <span className="text-label-sm-caps uppercase text-on-surface-variant/60">
                      Saldo privado
                    </span>
                    <span className="flex items-center gap-xs text-label-md font-semibold text-primary">
                      Ver perfil
                      <Icon name="arrow_forward" className="text-[16px]" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <p className="flex items-center gap-xs text-label-md text-on-surface-variant/70">
          <Icon name="lock" className="text-[16px]" />
          El saldo de cada broker es privado. Solo ves el tuyo, en{" "}
          <Link href="/perfil" className="font-semibold text-primary hover:underline">
            Mis comisiones
          </Link>
          .
        </p>
      </section>
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
