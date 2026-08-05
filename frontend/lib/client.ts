"use client";

/**
 * Llamadas a mutaciones desde el navegador.
 *
 * ACÁ nace el Idempotency-Key, y es el único lugar donde debe nacer.
 *
 * `crypto.randomUUID()` se ejecuta una vez por ACCIÓN DEL USUARIO (un click en
 * "Aprobar"), no una vez por request HTTP. La key viaja al route handler de Next,
 * que la reenvía al backend sin tocarla. Si la generara el servidor, cada
 * reintento del usuario —doble click, red caída, refresh— sería para el backend
 * una operación nueva y se ejecutaría dos veces. La key identifica la INTENCIÓN,
 * no la llamada.
 */

export class MutationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Creación que no mueve dinero: sin clave de idempotencia (ver `forwardCreate`). */
export async function create<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new MutationError(
      payload?.error ?? "error",
      payload?.message ?? "No se pudo completar la operación.",
    );
  }

  return payload as T;
}

export async function mutate<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new MutationError(
      payload?.error ?? "error",
      payload?.message ?? "No se pudo completar la operación.",
    );
  }

  return payload as T;
}
