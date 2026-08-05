import { getAccounts, getListings } from "@/lib/api";
import type { Listing } from "@/lib/api";
import { formatBps } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { SplitBar } from "@/components/split-bar";
import { PublishListingForm } from "@/components/publish-listing-form";
import { getActiveBroker } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Los inmuebles de la red, vistos como OPORTUNIDADES.
 *
 * Un broker no entra acá a auditar acuerdos: entra a ver qué hay disponible y
 * cuánto se lleva si consigue el cliente. Los captados por otros van primero
 * —son los que puede trabajar— y los propios después.
 */
export default async function ListingsPage() {
  const [listings, accounts] = await Promise.all([getListings(), getAccounts()]);

  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));

  const opportunities = listings.filter(
    (l) => l.listing_broker_account_id !== me?.id,
  );
  const mine = listings.filter((l) => l.listing_broker_account_id === me?.id);

  return (
    <>
      <div className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="text-[0.8125rem] font-medium text-brand">La red</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            Inmuebles disponibles
          </h1>
          <p className="mt-2 max-w-2xl leading-relaxed text-muted">
            Todo lo que hay publicado en la red. Si conseguís el cliente para
            cualquiera de estos, te llevás la parte de quien vende.
          </p>
        </div>
        {me && <PublishListingForm me={me} />}
      </div>

      <section className="mb-10">
        <h2 className="mb-4 text-[0.9375rem] font-semibold tracking-tight text-ink">
          Podés vender
          <span className="ml-2 tnum font-normal text-muted">
            {opportunities.length}
          </span>
        </h2>

        {opportunities.length === 0 ? (
          <Card>
            <EmptyState
              title="No hay inmuebles de otros brokers"
              description="Cuando alguien más publique, aparece acá con lo que te llevarías por venderlo."
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {opportunities.map((listing) => (
              <OpportunityCard
                key={listing.id}
                listing={listing}
                capturedBy={nameOf.get(listing.listing_broker_account_id) ?? "—"}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-[0.9375rem] font-semibold tracking-tight text-ink">
          Publicados por vos
          <span className="ml-2 tnum font-normal text-muted">{mine.length}</span>
        </h2>

        {mine.length === 0 ? (
          <Card>
            <EmptyState
              title="Todavía no publicaste ninguno"
              description="Publicá un inmueble y definí cuánto se lleva quien te traiga el cliente."
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {mine.map((listing) => (
              <Card key={listing.id} className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-ink">{listing.address}</p>
                  <Badge tone="brand">Tuyo</Badge>
                </div>
                <p className="mt-1 text-[0.8125rem] text-muted">
                  Te llevás{" "}
                  <span className="font-medium text-ink">
                    {formatBps(listing.listing_broker_bps)}
                  </span>{" "}
                  por haberlo captado.
                </p>
                <div className="mt-5">
                  <SplitBar
                    listingBps={listing.listing_broker_bps}
                    sellingBps={listing.selling_broker_bps}
                    platformBps={listing.platform_bps}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="mt-8 text-xs leading-relaxed text-faint">
        El acuerdo de reparto se congela en el momento de reportar la comisión.
        Cambiarlo después no altera lo que se paga por una venta ya reportada.
      </p>
    </>
  );
}

function OpportunityCard({
  listing,
  capturedBy,
}: {
  listing: Listing;
  capturedBy: string;
}) {
  return (
    <Card className="flex flex-col p-6">
      <p className="text-sm font-medium text-ink">{listing.address}</p>
      <p className="mt-1 text-[0.8125rem] text-muted">
        Captado por <span className="text-ink">{capturedBy}</span>
      </p>

      {/* Lo que le importa a quien mira: su parte si trae el cliente. */}
      <div className="mt-4 flex items-baseline gap-2 rounded-lg bg-brand-soft px-4 py-3">
        <span className="tnum text-2xl font-semibold tracking-tight text-brand">
          {formatBps(listing.selling_broker_bps)}
        </span>
        <span className="text-[0.8125rem] leading-snug text-brand/80">
          para vos si traés el cliente
        </span>
      </div>

      <div className="mt-5">
        <SplitBar
          listingBps={listing.listing_broker_bps}
          sellingBps={listing.selling_broker_bps}
          platformBps={listing.platform_bps}
        />
      </div>
    </Card>
  );
}
