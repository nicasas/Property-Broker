import "server-only";
import { cookies } from "next/headers";
import { ACTIVE_BROKER_COOKIE } from "@/lib/identity";
import type { Account } from "@/lib/api";

/**
 * SIMULACIÓN DE SESIÓN.
 *
 * Esto NO es autenticación. No hay contraseñas, ni tokens, ni verificación: el
 * broker activo es simplemente un id guardado en una cookie que el propio usuario
 * puede cambiar desde el selector de la barra superior.
 *
 * Existe porque un producto pone al usuario DENTRO de una identidad —"mis
 * comisiones", "lo que yo gané"— y sin algo que diga quién soy, la interfaz solo
 * puede ofrecer una vista de dios sobre todos los brokers.
 *
 * En producción esto vendría de un sistema de autenticación real y el id saldría
 * de la sesión verificada, no de una cookie editable. La forma de la aplicación
 * no cambiaría: todas las pantallas preguntan "quién es el broker activo" por
 * esta única función, así que reemplazarla por auth de verdad es cambiar su
 * cuerpo y nada más.
 *
 * Nada de esto toca el backend: el servidor sigue sin saber quién mira. Los
 * endpoints son los mismos y el encuadre por identidad ocurre en presentación.
 */
export async function getActiveBroker(
  brokers: Account[],
): Promise<Account | null> {
  const store = await cookies();
  const id = store.get(ACTIVE_BROKER_COOKIE)?.value;
  return brokers.find((broker) => broker.id === id) ?? brokers[0] ?? null;
}
