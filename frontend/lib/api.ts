/**
 * Cliente de la API. SOLO se usa del lado del servidor.
 *
 * El navegador nunca habla directo con el backend: no resolvería `api:8000`, que
 * es un nombre de la red interna del compose. Todo fetch sale de Server
 * Components o de route handlers de Next. Ventajas: cero CORS, el backend queda
 * intacto, y cualquier credencial futura (por ejemplo una API key de un modelo)
 * vive server-side y nunca llega al cliente.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://api:8000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /**
   * Idempotency-Key del cliente.
   *
   * La key la genera el NAVEGADOR con crypto.randomUUID() en el momento de la
   * acción del usuario, y se propaga hasta acá SIN modificarse. Es deliberado:
   * si el route handler generara una key nueva por llamada, cada reintento del
   * usuario sería para el backend una operación distinta y se ejecutaría dos
   * veces — que es exactamente lo que la idempotencia viene a impedir. La key
   * identifica la INTENCIÓN del usuario, no la llamada HTTP.
   */
  idempotencyKey?: string;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // Datos de dinero: nunca servir una copia cacheada.
    cache: "no-store",
  });

  if (!response.ok) {
    let code = "http_error";
    let message = `La API respondió ${response.status}`;
    let details: unknown;
    try {
      const payload = await response.json();
      code = payload.error ?? code;
      message = payload.message ?? message;
      details = payload.details;
    } catch {
      /* respuesta sin cuerpo JSON: se conserva el mensaje genérico */
    }
    throw new ApiError(response.status, code, message, details);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: "POST", body, idempotencyKey }),
};

// --------------------------------------------------------------------------
// Tipos del dominio, espejo de los schemas del backend.
// --------------------------------------------------------------------------

export type AccountType = "BROKER" | "PLATFORM" | "EXTERNAL";

export type Account = {
  id: string;
  name: string;
  account_type: AccountType;
  /** En centavos. Entero siempre. */
  balance: number;
  created_at: string;
};

export type Reconciliation = {
  ledger_total: number;
  accounts_checked: number;
  is_balanced: boolean;
  mismatches: unknown[];
};

export function getAccounts() {
  return api.get<Account[]>("/accounts");
}

export function getReconciliation() {
  return api.get<Reconciliation>("/ledger/reconciliation");
}
