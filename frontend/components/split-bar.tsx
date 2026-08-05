import { formatBps } from "@/lib/format";

/**
 * El acuerdo de reparto, visto de un vistazo.
 *
 * Tres segmentos proporcionales a los basis points. La barra comunica en un
 * segundo lo que una tabla de porcentajes obliga a leer y comparar.
 */
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
  const segments = [
    { label: "Capta", bps: listingBps, className: "bg-brand" },
    { label: "Vende", bps: sellingBps, className: "bg-brand/55" },
    { label: "Plataforma", bps: platformBps, className: "bg-brand/25" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-canvas">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.className}
            style={{ width: `${segment.bps / 100}%` }}
          />
        ))}
      </div>

      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((segment) => (
            <span
              key={segment.label}
              className="flex items-center gap-1.5 text-xs text-muted"
            >
              <span
                className={`size-2 rounded-full ${segment.className}`}
                aria-hidden
              />
              {segment.label}
              <span className="tnum font-medium text-ink">
                {formatBps(segment.bps)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
