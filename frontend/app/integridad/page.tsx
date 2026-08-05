import { getAccounts, getReconciliation } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { Badge, Card, CardHeader, Money } from "@/components/ui";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

/**
 * Bajo el capó.
 *
 * Un broker no piensa en SUM(ledger), así que esto salió de la home. Pero sigue
 * existiendo y accesible: es la prueba de que la red que ve el usuario está
 * sostenida por un ledger de partida doble que cuadra.
 */
export default async function IntegrityPage() {
  const [health, accounts] = await Promise.all([
    getReconciliation(),
    getAccounts(),
  ]);

  const platform = accounts.find((a) => a.account_type === "PLATFORM");
  const external = accounts.find((a) => a.account_type === "EXTERNAL");
  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const insideTheSystem = brokers.reduce((s, b) => s + b.balance, 0) +
    (platform?.balance ?? 0);

  return (
    <>
      <PageHeader
        eyebrow="Bajo el capó"
        title="Integridad del sistema"
        description="La red funciona sobre un núcleo bancario de partida doble. Cada peso que se mueve queda asentado dos veces y la suma de todos los asientos tiene que dar exactamente cero."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className={health.is_balanced ? "" : "border-negative"}>
          <CardHeader
            title="Reconciliación global"
            description="Se recalcula desde el ledger en cada consulta."
            action={
              <Badge tone={health.is_balanced ? "positive" : "negative"}>
                {health.is_balanced ? "Cuadra" : "Descuadre"}
              </Badge>
            }
          />
          <div className="px-6 py-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[0.8125rem] text-muted">SUM(ledger)</span>
              <Money
                size="lg"
                tone={health.ledger_total === 0 ? "positive" : "negative"}
              >
                {health.ledger_total}
              </Money>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              Un cero significa que el sistema no creó ni destruyó un peso. Se
              verifica contra {health.accounts_checked} cuentas, comparando además
              el saldo materializado de cada una con la suma de su propio ledger.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Cuentas de sistema"
            description="No son brokers: sostienen la contabilidad."
          />
          <ul className="divide-y divide-line">
            {[platform, external].filter(Boolean).map((account) => (
              <li
                key={account!.id}
                className="flex items-center justify-between px-6 py-4"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium text-ink">
                    {account!.name}
                  </span>
                  <Badge tone="brand">{account!.account_type}</Badge>
                </div>
                <Money tone={account!.balance < 0 ? "negative" : "neutral"}>
                  {formatMoney(account!.balance)}
                </Money>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-6 py-4">
            <p className="text-xs leading-relaxed text-faint">
              La cuenta externa es la contrapartida de toda comisión que entra
              desde fuera de la red. Su saldo, cambiado de signo, es exactamente el
              dinero vivo adentro: {formatMoney(insideTheSystem)}. Es la única
              cuenta autorizada a ir en negativo.
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Cómo se protege el dinero" />
        <ul className="divide-y divide-line">
          {defenses.map((defense) => (
            <li key={defense.title} className="px-6 py-4">
              <p className="text-[0.8125rem] font-medium text-ink">
                {defense.title}
              </p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
                {defense.body}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const defenses = [
  {
    title: "Un reparto ocurre entero o no ocurre",
    body: "El débito al broker que reporta y los créditos a las otras partes viven en una sola transacción. Si algo falla, no queda una cuenta debitada y otra sin acreditar: la comisión vuelve a quedar pendiente y se puede reintentar.",
  },
  {
    title: "Dos aprobaciones simultáneas pagan una sola vez",
    body: "La fila de la comisión se bloquea antes de leer su estado, así que si dos personas aprueban a la vez, la segunda encuentra la comisión ya liquidada y devuelve ese resultado en vez de repartir de nuevo.",
  },
  {
    title: "Un reintento no paga dos veces",
    body: "Cada operación que mueve dinero lleva una clave de idempotencia generada por el navegador. Si la red se cae y el usuario reintenta, el sistema reconoce la clave y devuelve el resultado anterior sin volver a ejecutar.",
  },
  {
    title: "El reparto cuadra al centavo",
    body: "Todo se calcula en centavos enteros, nunca en decimales. Cuando la división no da exacta, la plataforma absorbe el residuo por construcción: su parte es lo que queda después de las de los brokers, así que la suma siempre cierra.",
  },
  {
    title: "El historial no se puede reescribir",
    body: "Los asientos del ledger no admiten modificación ni borrado, ni siquiera desde la base de datos. Corregir se hace con un asiento de reversión, como en contabilidad real.",
  },
];
