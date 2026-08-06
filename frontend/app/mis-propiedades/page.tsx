import { getAccounts, getCommissions, getListings } from "@/lib/api";
import { formatBps, formatMoney } from "@/lib/format";
import { Badge, Card, EmptyState, StatCard } from "@/components/ui";
import { Icon } from "@/components/icon";
import { PublishListingForm } from "@/components/publish-listing-form";
import { getActiveBroker } from "@/lib/session";
import { listingImage } from "@/lib/imagery";

export const dynamic = "force-dynamic";

/** MIS PROPIEDADES — el portafolio propio: lo que capté y publiqué en la red. */
export default async function MyListingsPage() {
  const [listings, accounts, commissions] = await Promise.all([
    getListings(),
    getAccounts(),
    getCommissions(),
  ]);

  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));

  const mine = listings.filter((l) => l.listing_broker_account_id === me?.id);
  const mineIds = new Set(mine.map((l) => l.id));

  const onMyListings = commissions.filter((c) => mineIds.has(c.listing_id));
  const settled = onMyListings.filter((c) => c.status === "EXECUTED");
  const earnedAsLister = settled.reduce(
    (sum, c) => sum + (c.listing_broker_share ?? 0),
    0,
  );
  const averageOffered =
    mine.length === 0
      ? 0
      : Math.round(
          mine.reduce((sum, l) => sum + l.selling_broker_bps, 0) / mine.length,
        );

  return (
    <div className="flex w-full flex-col">
      <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
        <div className="flex flex-col justify-between gap-md lg:flex-row lg:items-center">
          <div>
            <p className="text-label-sm-caps uppercase text-on-surface-variant">
              Gestión de portafolio
            </p>
            <h1 className="mt-xs text-headline-lg text-on-surface">
              Mis propiedades
            </h1>
          </div>
          {me && <PublishListingForm me={me} />}
        </div>
      </section>

      <section className="space-y-lg p-lg">
        <div className="grid grid-cols-1 gap-md md:grid-cols-3">
          <StatCard
            label="Inventario activo"
            value={mine.length}
            icon="real_estate_agent"
            caption={
              mine.length === 0
                ? "Publicá tu primer inmueble"
                : `${onMyListings.length} comisión${onMyListings.length === 1 ? "" : "es"} reportada${onMyListings.length === 1 ? "" : "s"}`
            }
          />
          <StatCard
            label="Ganado por captación"
            value={formatMoney(earnedAsLister)}
            icon="payments"
            tone="secondary"
            caption={`${settled.length} venta${settled.length === 1 ? "" : "s"} liquidada${settled.length === 1 ? "" : "s"}`}
          />
          <StatCard
            label="Comisión promedio ofrecida"
            value={formatBps(averageOffered)}
            icon="handshake"
            caption="A quien traiga el cliente"
          />
        </div>

        {mine.length === 0 ? (
          <Card>
            <EmptyState
              icon="add_home_work"
              title="Todavía no publicaste ningún inmueble"
              description="Publicá uno y definí cuánto se lleva el broker que consiga el cliente."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-lg md:grid-cols-2 xl:grid-cols-3">
            {mine.map((listing) => {
              const related = onMyListings.filter(
                (c) => c.listing_id === listing.id,
              );
              return (
                <div
                  key={listing.id}
                  className="flex flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm transition-all hover:shadow-xl"
                >
                  {/* Imagen decorativa, determinista por id. Ver lib/imagery.ts */}
                  <div className="relative aspect-[5/2] overflow-hidden bg-tertiary-container">
                    <div className="absolute inset-0 grid place-items-center">
                      <Icon
                        name="home_work"
                        className="text-[40px] text-on-tertiary-container/30"
                      />
                    </div>
                    <img
                      src={listingImage(listing.id, 600)}
                      alt=""
                      aria-hidden
                      loading="lazy"
                      className="absolute inset-0 size-full object-cover"
                    />
                  </div>

                  <div className="flex items-start justify-between gap-sm p-md pb-0">
                    <p className="flex items-start gap-xs text-body-md text-on-surface">
                      <Icon
                        name="location_on"
                        className="mt-[2px] shrink-0 text-[18px] text-on-surface-variant"
                      />
                      <span className="line-clamp-2">{listing.address}</span>
                    </p>
                    <Badge tone={related.length > 0 ? "positive" : "neutral"}>
                      {related.length > 0 ? "Con actividad" : "Publicado"}
                    </Badge>
                  </div>

                  <div className="p-md">
                    <div className="flex items-baseline justify-between">
                      <span className="text-label-sm-caps uppercase text-on-surface-variant">
                        Ofrecés a quien venda
                      </span>
                      <span className="tnum text-headline-md text-secondary">
                        {formatBps(listing.selling_broker_bps)}
                      </span>
                    </div>

                    <div className="mt-sm flex h-2 w-full overflow-hidden rounded-full bg-surface-container">
                      <div
                        className="bg-on-tertiary-container"
                        style={{ width: `${listing.listing_broker_bps / 100}%` }}
                      />
                      <div
                        className="bg-secondary"
                        style={{ width: `${listing.selling_broker_bps / 100}%` }}
                      />
                      <div
                        className="bg-surface-container-highest"
                        style={{ width: `${listing.platform_bps / 100}%` }}
                      />
                    </div>

                    <div className="mt-sm flex justify-between text-label-md text-on-surface-variant">
                      <span>
                        Vos{" "}
                        <span className="tnum font-semibold text-on-surface">
                          {formatBps(listing.listing_broker_bps)}
                        </span>
                      </span>
                      <span>
                        Plataforma{" "}
                        <span className="tnum font-semibold text-on-surface">
                          {formatBps(listing.platform_bps)}
                        </span>
                      </span>
                    </div>
                  </div>

                  {related.length > 0 && (
                    <div className="border-t border-surface-container-highest px-md py-sm">
                      {related.slice(0, 2).map((commission) => (
                        <div
                          key={commission.id}
                          className="flex items-center justify-between py-xs text-label-md"
                        >
                          <span className="truncate text-on-surface-variant">
                            {nameOf.get(commission.selling_broker_account_id)}
                          </span>
                          <span
                            className={`tnum font-semibold ${
                              commission.status === "EXECUTED"
                                ? "text-secondary"
                                : "text-on-surface-variant"
                            }`}
                          >
                            {commission.status === "EXECUTED"
                              ? formatMoney(commission.listing_broker_share ?? 0)
                              : "pendiente"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mine.length > 0 && (
          <p className="text-label-md text-on-surface-variant/70">
            Las imágenes son ilustrativas: el sistema guarda la dirección y el
            acuerdo de reparto, no fotos del inmueble.
          </p>
        )}
      </section>
    </div>
  );
}
