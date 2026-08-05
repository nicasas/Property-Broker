/**
 * Set mínimo de componentes propios. Existen para que el espaciado, los radios y
 * los pesos tipográficos sean los mismos en todas las pantallas sin repetir
 * clases sueltas — no para reemplazar una librería.
 */

import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(20,15,10,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
      <div>
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Estado vacío. Nunca dejar un contenedor en blanco: se lee como roto. */
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-muted">
          {description}
        </p>
      )}
    </div>
  );
}

type BadgeTone = "neutral" | "positive" | "negative" | "pending" | "brand";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-canvas text-muted border-line",
  positive: "bg-positive-soft text-positive border-transparent",
  negative: "bg-negative-soft text-negative border-transparent",
  pending: "bg-pending-soft text-pending border-transparent",
  brand: "bg-brand-soft text-brand border-brand-line",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const buttonVariants = {
  primary: "bg-brand text-white hover:bg-brand-hover border-transparent",
  secondary: "bg-surface text-ink hover:bg-canvas border-line-strong",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-canvas border-transparent",
  danger: "bg-surface text-negative hover:bg-negative-soft border-line-strong",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  const sizes = {
    sm: "h-8 px-3 text-[0.8125rem]",
    md: "h-10 px-4 text-sm",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-medium
        transition-colors duration-150
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand
        disabled:cursor-not-allowed disabled:opacity-45
        ${buttonVariants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8125rem] font-medium text-ink">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

const controlStyles = `w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink
  placeholder:text-faint transition-colors
  focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/25`;

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlStyles} h-10 ${className}`} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlStyles} h-10 ${className}`} {...props}>
      {children}
    </select>
  );
}

/** Cifra de dinero. Siempre tabular, siempre con la misma jerarquía. */
export function Money({
  children,
  tone = "neutral",
  size = "md",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "muted";
  size?: "sm" | "md" | "lg";
}) {
  const tones = {
    neutral: "text-ink",
    positive: "text-positive",
    negative: "text-negative",
    muted: "text-muted",
  };
  const sizes = {
    sm: "text-[0.8125rem]",
    md: "text-sm",
    lg: "text-2xl tracking-tight",
  };
  return (
    <span className={`tnum font-semibold ${tones[tone]} ${sizes[size]}`}>
      {children}
    </span>
  );
}
