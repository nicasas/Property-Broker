import { getAccounts, getListings } from "@/lib/api";
import type { Listing } from "@/lib/api";
import { formatBps } from "@/lib/format";
import { Badge, Card, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { PublishListingForm } from "@/components/publish-listing-form";
import { getActiveBroker } from "@/lib/session";
import { listingImage } from "@/lib/imagery";

export const dynamic = "force-dynamic";

/**
 * MERCADO — los inmuebles que puedo vender.
 *
 * Solo los captados por OTROS brokers: son las oportunidades que puedo trabajar.
 * Los míos viven en "Mis propiedades".
 *
 * La imagen de cada tarjeta es DECORATIVA y no representa el inmueble real: el
 * sistema guarda dirección y porcentajes, no fotos. Sobre ella va el dato que sí
 * existe y es el que decide si vale la pena trabajar el inmueble — el acuerdo de
 * reparto. La nota al pie de la grilla lo aclara para quien mire la pantalla.
 */
export default async function MarketPage() {
  const [listings, accounts] = await Promise.all([getListings(), getAccounts()]);

  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));

  const opportunities = listings.filter(
    (l) => l.listing_broker_account_id !== me?.id,
  );
  const best = opportunities.reduce(
    (max, l) => Math.max(max, l.selling_broker_bps),
    0,
  );

  return (
    <div className="flex w-full flex-col">
      <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
        <div className="flex flex-col justify-between gap-md lg:flex-row lg:items-center">
          <div>
            <h1 className="text-headline-lg text-on-surface">
              Mercado de propiedades
            </h1>
            <p className="mt-xs flex items-center gap-xs text-body-md text-on-surface-variant">
              <span className="size-2 rounded-full bg-secondary" />
              {opportunities.length} inmuebles que podés vender
              {best > 0 && ` · hasta ${formatBps(best)} de comisión`}
            </p>
          </div>
          {me && <PublishListingForm me={me} />}
        </div>
      </section>

      <section className="p-lg">
        {opportunities.length === 0 ? (
          <Card>
            <EmptyState
              icon="explore_off"
              title="No hay inmuebles de otros brokers"
              description="Cuando alguien más publique, aparece acá con lo que te llevarías por conseguir el cliente."
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-lg md:grid-cols-2 xl:grid-cols-3">
            {opportunities.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                capturedBy={nameOf.get(listing.listing_broker_account_id) ?? "—"}
                highlighted={listing.selling_broker_bps === best}
              />
            ))}
          </div>
        )}

        {opportunities.length > 0 && (
          <p className="mt-lg text-label-md text-on-surface-variant/70">
            Las imágenes son ilustrativas: el sistema guarda la dirección y el
            acuerdo de reparto, no fotos del inmueble.
          </p>
        )}
      </section>
    </div>
  );
}

function ListingCard({
  listing,
  capturedBy,
  highlighted,
}: {
  listing: Listing;
  capturedBy: string;
  highlighted: boolean;
}) {
  const segments = [
    { label: "Capta", bps: listing.listing_broker_bps, className: "bg-on-tertiary-container" },
    { label: "Vende", bps: listing.selling_broker_bps, className: "bg-secondary-container" },
    { label: "Plataforma", bps: listing.platform_bps, className: "bg-surface-container/40" },
  ];

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm transition-all duration-300 hover:shadow-xl ${
        highlighted ? "border-l-4 border-primary" : ""
      }`}
    >
      {highlighted && (
        <div className="absolute left-sm top-sm z-10 flex items-center gap-xs rounded-full bg-primary/90 px-sm py-xs text-label-sm-caps uppercase text-on-primary shadow-sm backdrop-blur-sm">
          <Icon name="star" className="text-[14px]" />
          Mejor comisión
        </div>
      )}

      {/* Imagen DECORATIVA: no es el inmueble real, el sistema no guarda fotos.
          Se elige de forma determinista por id, así que no cambia entre renders.
          Detrás queda el fondo con el icono, que es lo que se ve si la imagen no
          carga — la tarjeta nunca se rompe. */}
      <div className="relative flex aspect-[3/2] flex-col justify-end overflow-hidden bg-tertiary-container p-md">
        <div className="absolute inset-0 grid place-items-center">
          <Icon
            name="apartment"
            className="text-[64px] text-on-tertiary-container/30"
          />
        </div>
        <img
          src={listingImage(listing.id)}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-tertiary-container/90 via-tertiary-container/20 to-transparent" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-xs text-label-md text-on-tertiary">
              <Icon name="local_offer" className="text-[16px]" />
              Split de comisión
            </span>
            <span className="tnum rounded bg-surface/20 px-xs py-[2px] text-mono-data text-secondary-container backdrop-blur-sm">
              {formatBps(listing.selling_broker_bps)}
            </span>
          </div>
          <div className="mt-xs flex h-2 w-full overflow-hidden rounded-full bg-surface-container/30">
            {segments.map((segment) => (
              <div
                key={segment.label}
                className={segment.className}
                style={{ width: `${segment.bps / 100}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-grow flex-col p-md">
        <div className="mb-xs flex items-start justify-between">
          <h3 className="tnum truncate pr-sm text-headline-md text-on-surface">
            {formatBps(listing.selling_broker_bps)}
          </h3>
          <Badge tone="positive" dot>
            Disponible
          </Badge>
        </div>
        <p className="mb-md text-label-md text-on-surface-variant">
          para vos si conseguís el cliente
        </p>

        <p className="mb-md flex items-start gap-xs text-body-md text-on-surface-variant">
          <Icon name="location_on" className="mt-[2px] shrink-0 text-[18px]" />
          <span className="line-clamp-2">{listing.address}</span>
        </p>

        <div className="mb-md flex flex-wrap gap-sm">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className="flex items-center gap-xs rounded bg-surface-container-low px-sm py-xs text-label-md text-on-surface"
            >
              <span className={`size-2 rounded-full ${segment.className}`} />
              {segment.label}
              <span className="tnum font-semibold">{formatBps(segment.bps)}</span>
            </div>
          ))}
        </div>

        <div className="my-auto h-px w-full bg-surface-container-highest" />

        <div className="mt-md flex items-center justify-between pt-sm">
          <div className="flex items-center gap-sm">
            <div className="grid size-8 place-items-center rounded-full bg-primary-container text-label-sm-caps text-on-primary-container ring-2 ring-surface">
              {initials(capturedBy)}
            </div>
            <div className="flex flex-col">
              <span className="text-label-md leading-tight text-on-surface">
                {capturedBy}
              </span>
              <span className="text-label-sm-caps uppercase text-on-surface-variant">
                Captó el inmueble
              </span>
            </div>
          </div>
        </div>
      </div>
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
