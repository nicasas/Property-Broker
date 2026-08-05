/**
 * El backend habla en centavos enteros y nunca en float, por las razones que
 * documenta `docs/INTEGRITY.md`. Ese contrato se respeta acá: los centavos se
 * convierten a pesos SOLO al pintar, y nunca vuelven a viajar como decimal.
 */

/**
 * Se muestran los CENTAVOS, con dos decimales siempre.
 *
 * No es un detalle: es lo único que deja ver que el reparto cuadra. 10.001
 * repartido en tercios da 3.333,33 + 3.333,33 + 3.334,34 = 10.001,00. Redondeado
 * a pesos, esa misma suma se leería 3.333 + 3.333 + 3.334 = 10.000 y parecería
 * que el sistema perdió un peso. El backend es exacto al centavo; la interfaz
 * tiene que mostrarlo.
 */
const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Centavos -> "$ 1.234.567,89". */
export function formatMoney(cents: number): string {
  return COP.format(cents / 100);
}

/** Con signo explícito, para movimientos del ledger. */
export function formatSignedMoney(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${COP.format(Math.abs(cents) / 100)}`;
}

/** Pesos escritos por el usuario -> centavos enteros para la API. */
export function pesosToCents(pesos: string): number {
  const clean = pesos.replace(/[^\d]/g, "");
  return clean === "" ? 0 : Number(clean) * 100;
}

/** 4000 bps -> "40%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
