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

export type Listing = {
  id: string;
  address: string;
  listing_broker_account_id: string;
  /** Basis points enteros: 10.000 bps = 100%. Nunca fracciones. */
  listing_broker_bps: number;
  selling_broker_bps: number;
  platform_bps: number;
  created_at: string;
};

export type CommissionStatus = "PENDING" | "EXECUTED" | "REJECTED";

export type Commission = {
  id: string;
  listing_id: string;
  reported_by_account_id: string;
  listing_broker_account_id: string;
  selling_broker_account_id: string;

  gross_amount: number;
  listing_broker_bps: number;
  selling_broker_bps: number;
  platform_bps: number;

  status: CommissionStatus;
  evidence: string;

  /** Se llenan al ejecutar; null mientras está pendiente. */
  listing_broker_share: number | null;
  selling_broker_share: number | null;
  platform_share: number | null;
  movement_id: string | null;

  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;

  created_at: string;
};

export type LedgerEntry = {
  id: string;
  movement_id: string;
  account_id: string;
  /** Firmado y en centavos: negativo debita, positivo acredita. */
  amount: number;
  balance_after: number;
  operation_type: "DEPOSIT" | "TRANSFER" | "COMMISSION_SPLIT";
  reference: string | null;
  created_at: string;
};

export function getAccounts() {
  return api.get<Account[]>("/accounts");
}

export function getReconciliation() {
  return api.get<Reconciliation>("/ledger/reconciliation");
}

export function getListings() {
  return api.get<Listing[]>("/listings");
}

export function getCommissions(params?: {
  status?: CommissionStatus;
  reportedBy?: string;
}) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  // El filtro de "mis comisiones". Lo cubre ix_commissions_reported_by_created_at.
  if (params?.reportedBy) query.set("reported_by_account_id", params.reportedBy);
  const suffix = query.size > 0 ? `?${query}` : "";
  return api.get<Commission[]>(`/commissions${suffix}`);
}

export function getAccountLedger(accountId: string) {
  return api.get<LedgerEntry[]>(`/accounts/${accountId}/ledger`);
}

/**
 * Las patas de un movimiento.
 *
 * El historial de una cuenta trae solo sus propias filas, así que quien recibe
 * un pago ve su pata y nunca la del otro lado. La contraparte no se perdió: la
 * partida doble la registra en la otra pata del mismo `movement_id`. Esto es lo
 * que permite leerla.
 */
export function getMovement(movementId: string) {
  return api.get<LedgerEntry[]>(`/ledger/movements/${movementId}`);
}
