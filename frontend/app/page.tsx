import { getAccounts, getReconciliation } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { Badge, Card, CardHeader, Money } from "@/components/ui";

/**
 * Página de humo del bloque 2: prueba que el front carga Y que alcanza al backend
 * por la red interna del compose (`http://api:8000`), server-side.
 *
 * Las pantallas reales del arco llegan en el bloque 3.
 */
export default async function Home() {
  let error: string | null = null;
  let accounts: Awaited<ReturnType<typeof getAccounts>> = [];
  let health: Awaited<ReturnType<typeof getReconciliation>> | null = null;

  try {
    [accounts, health] = await Promise.all([getAccounts(), getReconciliation()]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error desconocido";
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <p className="text-[0.8125rem] font-medium text-brand">Property Broker</p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-ink">
          Liquidación de comisiones
        </h1>
        <p className="mt-2 max-w-xl leading-relaxed text-muted">
          Red de brokers inmobiliarios que reparten comisiones compartidas sobre un
          ledger de partida doble.
        </p>
      </header>

      {error ? (
        <Card>
          <CardHeader
            title="No hay conexión con la API"
            description="El front no pudo alcanzar el backend por la red del compose."
          />
          <p className="px-6 py-5 text-sm text-negative">{error}</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Estado del sistema"
              description="Reconciliación global entre el ledger y los saldos materializados."
              action={
                <Badge tone={health?.is_balanced ? "positive" : "negative"}>
                  {health?.is_balanced ? "Cuadrado" : "Descuadrado"}
                </Badge>
              }
            />
            <dl className="grid grid-cols-2 divide-x divide-line">
              <div className="px-6 py-5">
                <dt className="text-[0.8125rem] text-muted">Suma del ledger</dt>
                <dd className="mt-1">
                  <Money size="lg">{health?.ledger_total ?? 0}</Money>
                </dd>
              </div>
              <div className="px-6 py-5">
                <dt className="text-[0.8125rem] text-muted">Cuentas verificadas</dt>
                <dd className="mt-1">
                  <Money size="lg">{health?.accounts_checked ?? 0}</Money>
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Cuentas"
              description={`${accounts.length} en el sistema.`}
            />
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-ink">
                      {account.name}
                    </span>
                    {account.account_type !== "BROKER" && (
                      <Badge tone="brand">{account.account_type}</Badge>
                    )}
                  </div>
                  <Money tone={account.balance < 0 ? "negative" : "neutral"}>
                    {formatMoney(account.balance)}
                  </Money>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </main>
  );
}
