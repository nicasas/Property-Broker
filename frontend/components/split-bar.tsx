import { formatBps } from "@/lib/format";

/**
 * El acuerdo de reparto, visto de un vistazo.
 *
 * Tres segmentos proporcionales a los basis points. La barra comunica en un
 * segundo lo que una tabla de porcentajes obliga a leer y comparar. Los colores
 * son los mismos en toda la aplicación, así que el segmento verde siempre
 * significa "la parte de quien vende".
 */
const SEGMENTS = [
  { key: "listing", label: "Capta", className: "bg-on-tertiary-container" },
  { key: "selling", label: "Vende", className: "bg-secondary" },
  { key: "platform", label: "Plataforma", className: "bg-surface-container-highest" },
] as const;

export function SplitBar({
  listingBps,
  sellingBps,
  platformBps,
  showLegend = true,
}: {
  listingBps: number;
  sellingBps: number;
  platformBps: number;
  showLegend?: boolean;
}) {
  const values = {
    listing: listingBps,
    selling: sellingBps,
    platform: platformBps,
  };

  return (
    <div className="space-y-sm">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-container">
        {SEGMENTS.map((segment) => (
          <div
            key={segment.key}
            className={segment.className}
            style={{ width: `${values[segment.key] / 100}%` }}
          />
        ))}
      </div>

      {showLegend && (
        <div className="flex flex-wrap gap-x-md gap-y-xs">
          {SEGMENTS.map((segment) => (
            <span
              key={segment.key}
              className="flex items-center gap-xs text-label-md text-on-surface-variant"
            >
              <span
                className={`size-2 rounded-full ${segment.className}`}
                aria-hidden
              />
              {segment.label}
              <span className="tnum font-semibold text-on-surface">
                {formatBps(values[segment.key])}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
