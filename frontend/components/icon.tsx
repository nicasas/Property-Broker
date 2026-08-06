/**
 * Icono de Material Symbols, como en los mockups.
 *
 * El nombre del icono es el contenido del elemento: la fuente lo convierte en
 * glifo mediante ligaduras. Si la hoja de Google Fonts no cargara, se vería el
 * nombre en texto — por eso siempre va `aria-hidden` con la etiqueta al lado.
 */
export function Icon({
  name,
  className = "",
  filled = false,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      className={`material-symbols-outlined ${filled ? "filled" : ""} ${className}`}
      aria-hidden
    >
      {name}
    </span>
  );
}
