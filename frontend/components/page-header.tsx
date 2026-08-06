import type { ReactNode } from "react";

/** Cabecera de pantalla, pegajosa como en los mockups. */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
      <div className="flex flex-col justify-between gap-md lg:flex-row lg:items-center">
        <div>
          {eyebrow && (
            <p className="text-label-sm-caps uppercase text-on-surface-variant">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-xs text-headline-lg text-on-surface">{title}</h1>
          {description && (
            <p className="mt-xs max-w-3xl text-body-md text-on-surface-variant">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
    </section>
  );
}
