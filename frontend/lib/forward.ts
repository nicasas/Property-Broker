import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ApiError, api } from "@/lib/api";

/**
 * Reenvía una mutación del navegador al backend.
 *
 * La única regla importante: el `Idempotency-Key` que llega del cliente se
 * propaga TAL CUAL. Este handler no genera uno propio ni lo reemplaza, porque eso
 * convertiría cada reintento del usuario en una operación distinta para el
 * backend y anularía la idempotencia. Si el cliente no manda key, se rechaza —
 * fabricarla acá sería exactamente el error que se quiere evitar.
 */
/**
 * Reenvía una creación que NO mueve dinero (un inmueble, un broker).
 *
 * Sin Idempotency-Key porque el backend no la pide para estos recursos: la
 * idempotencia protege operaciones de saldo, y crear un inmueble dos veces es un
 * problema de datos, no de plata. Mandar una key acá daría una falsa sensación de
 * protección, porque el backend la ignoraría. La defensa contra el doble click es
 * deshabilitar el botón mientras la petición está en vuelo.
 */
export async function forwardCreate(request: NextRequest, path: string) {
  const body = await request.json();

  try {
    return NextResponse.json(await api.post(path, body));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "upstream_unreachable", message: "No hay conexión con la API." },
      { status: 502 },
    );
  }
}

export async function forwardMutation(request: NextRequest, path: string) {
  const idempotencyKey = request.headers.get("Idempotency-Key");

  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error: "missing_idempotency_key",
        message: "La operación requiere un Idempotency-Key generado por el cliente.",
      },
      { status: 400 },
    );
  }

  const body = await request.json();

  try {
    return NextResponse.json(await api.post(path, body, idempotencyKey));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "upstream_unreachable", message: "No hay conexión con la API." },
      { status: 502 },
    );
  }
}
