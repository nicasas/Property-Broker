import type { ReactNode } from "react";

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
    <div className="mb-8 flex items-end justify-between gap-6">
      <div>
        {eyebrow && (
          <p className="text-[0.8125rem] font-medium text-brand">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl leading-relaxed text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
