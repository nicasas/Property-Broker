/**
 * Componentes base, en el lenguaje visual de los mockups.
 *
 * Superficie blanca (`surface-container-lowest`) sobre fondo gris claro, radios
 * chicos, sombra sutil que se levanta al hover. El color de marca es negro y se
 * reserva para acciones; el verde (`secondary`) habla de dinero y de estados
 * positivos.
 */

import type { ReactNode } from "react";
import { Icon } from "@/components/icon";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-surface-container-lowest shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-md border-b border-surface-container-highest px-lg py-md">
      <div className="flex items-start gap-sm">
        {icon && (
          <Icon
            name={icon}
            className="mt-[2px] text-[20px] text-on-surface-variant"
          />
        )}
        <div>
          <h2 className="text-label-md font-semibold text-on-surface">{title}</h2>
          {description && (
            <p className="mt-xs text-label-md text-on-surface-variant">
              {description}
            </p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Estado vacío. Nunca dejar un contenedor en blanco: se lee como roto. */
export function EmptyState({
  title,
  description,
  icon = "inbox",
}: {
  title: string;
  description?: string;
  icon?: string;
}) {
  return (
    <div className="px-lg py-xl text-center">
      <Icon
        name={icon}
        className="text-[32px] text-on-surface-variant/40"
      />
      <p className="mt-sm text-label-md font-semibold text-on-surface">{title}</p>
      {description && (
        <p className="mx-auto mt-xs max-w-sm text-label-md text-on-surface-variant">
          {description}
        </p>
      )}
    </div>
  );
}

type BadgeTone = "neutral" | "positive" | "negative" | "pending" | "brand";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  positive: "bg-secondary-container text-on-secondary-container",
  negative: "bg-error-container text-on-error-container",
  pending: "bg-tertiary-fixed text-on-tertiary-fixed",
  brand: "bg-primary-container text-on-primary-container",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-xs rounded-full px-sm py-xs text-label-sm-caps uppercase ${badgeTones[tone]}`}
    >
      {dot && (
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
      )}
      {children}
    </span>
  );
}

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const buttonVariants = {
  primary:
    "bg-primary text-on-primary shadow-sm hover:shadow-md",
  secondary:
    "bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
  ghost:
    "bg-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
  danger:
    "bg-error-container text-on-error-container hover:brightness-95",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  className = "",
  ...props
}: ButtonProps) {
  const sizes = {
    sm: "px-sm py-xs text-label-md",
    md: "px-md py-sm text-label-md",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-xs rounded-xl font-medium
        transition-all
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
        disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none
        ${buttonVariants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} className="text-[18px]" />}
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
      <span className="mb-xs block text-label-sm-caps uppercase text-on-surface-variant">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-xs block text-label-md text-on-surface-variant/70">
          {hint}
        </span>
      )}
    </label>
  );
}

const controlStyles = `w-full rounded-lg bg-surface-container-low px-md py-sm text-body-md text-on-surface
  placeholder:text-on-surface-variant/60 transition-all
  focus:outline-none focus:ring-2 focus:ring-primary/20`;

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlStyles} ${className}`} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={`${controlStyles} cursor-pointer appearance-none pr-xl ${className}`}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="expand_more"
        className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
      />
    </div>
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
    neutral: "text-on-surface",
    positive: "text-secondary",
    negative: "text-error",
    muted: "text-on-surface-variant",
  };
  const sizes = {
    sm: "text-mono-data",
    md: "text-label-md font-semibold",
    lg: "text-headline-md",
  };
  return (
    <span className={`tnum ${tones[tone]} ${sizes[size]}`}>{children}</span>
  );
}

/** Tarjeta de cifra, el "bento" de los mockups. */
export function StatCard({
  label,
  value,
  icon,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  icon?: string;
  caption?: ReactNode;
  tone?: "neutral" | "primary" | "secondary";
}) {
  const surfaces = {
    neutral: "bg-surface-container-lowest text-on-surface",
    primary: "bg-primary-container text-on-primary",
    secondary: "bg-secondary-container text-on-secondary-container",
  };
  const labelTone = {
    neutral: "text-on-surface-variant",
    primary: "text-on-primary-container",
    secondary: "text-on-secondary-container/70",
  };
  return (
    <div className={`rounded-xl p-md shadow-sm ${surfaces[tone]}`}>
      <div className="flex items-start justify-between gap-sm">
        <span className={`text-label-sm-caps uppercase ${labelTone[tone]}`}>
          {label}
        </span>
        {icon && <Icon name={icon} className={`text-[20px] ${labelTone[tone]}`} />}
      </div>
      <p className="tnum mt-sm text-headline-lg">{value}</p>
      {caption && (
        <p className={`mt-xs text-label-md ${labelTone[tone]}`}>{caption}</p>
      )}
    </div>
  );
}
