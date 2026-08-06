import { getAccounts, getReconciliation } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { Badge, Card, StatCard } from "@/components/ui";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

/**
 * BAJO EL CAPÓ.
 *
 * Un broker no piensa en SUM(ledger), así que esto no es la cara del producto.
 * Pero existe y es accesible: es la prueba de que la red que ve el usuario está
 * sostenida por un ledger de partida doble que cuadra, y las defensas están
 * explicadas en lenguaje de negocio y no de base de datos.
 */
export default async function IntegrityPage() {
  const [health, accounts] = await Promise.all([
    getReconciliation(),
    getAccounts(),
  ]);

  const platform = accounts.find((a) => a.account_type === "PLATFORM");
  const external = accounts.find((a) => a.account_type === "EXTERNAL");
  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const insideTheSystem =
    brokers.reduce((sum, b) => sum + b.balance, 0) + (platform?.balance ?? 0);

  return (
    <div className="flex w-full flex-col">
      <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
        <div className="flex flex-col justify-between gap-md lg:flex-row lg:items-center">
          <div>
            <p className="text-label-sm-caps uppercase text-on-surface-variant">
              Bajo el capó
            </p>
            <h1 className="mt-xs text-headline-lg text-on-surface">
              Integridad del sistema
            </h1>
            <p className="mt-xs max-w-3xl text-body-md text-on-surface-variant">
              La red funciona sobre un núcleo bancario de partida doble. Cada peso
              que se mueve queda asentado dos veces, y la suma de todos los
              asientos tiene que dar exactamente cero.
            </p>
          </div>
          <Badge tone={health.is_balanced ? "positive" : "negative"} dot>
            {health.is_balanced ? "Cuadra" : "Descuadre"}
          </Badge>
        </div>
      </section>

      <section className="space-y-lg p-lg">
        <div className="grid grid-cols-1 gap-lg md:grid-cols-3">
          <StatCard
            label="Suma del ledger"
            value={formatMoney(health.ledger_total)}
            icon={health.is_balanced ? "verified" : "error"}
            tone={health.is_balanced ? "secondary" : "neutral"}
            caption="Debe ser exactamente cero"
          />
          <StatCard
            label="Cuentas verificadas"
            value={health.accounts_checked}
            icon="fact_check"
            caption="Saldo materializado vs. su propio ledger"
          />
          <StatCard
            label="Dinero vivo en la red"
            value={formatMoney(insideTheSystem)}
            icon="savings"
            caption="Igual al negativo de la cuenta externa"
          />
        </div>

        <Card>
          <div className="flex items-center gap-sm border-b border-surface-container-highest px-lg py-md">
            <Icon name="account_tree" className="text-[20px] text-on-surface-variant" />
            <div>
              <h2 className="text-label-md font-semibold text-on-surface">
                Cuentas de sistema
              </h2>
              <p className="mt-xs text-label-md text-on-surface-variant">
                No son brokers: sostienen la contabilidad.
              </p>
            </div>
          </div>
          <ul className="divide-y divide-outline-variant/20">
            {[platform, external].filter(Boolean).map((account) => (
              <li
                key={account!.id}
                className="flex items-center justify-between px-lg py-md"
              >
                <div className="flex items-center gap-sm">
                  <span className="grid size-8 place-items-center rounded-full bg-surface-container-high">
                    <Icon
                      name={
                        account!.account_type === "PLATFORM"
                          ? "corporate_fare"
                          : "public"
                      }
                      className="text-[18px] text-on-surface-variant"
                    />
                  </span>
                  <div>
                    <p className="text-label-md font-semibold text-on-surface">
                      {account!.name}
                    </p>
                    <p className="text-label-sm-caps uppercase text-on-surface-variant/70">
                      {account!.account_type}
                    </p>
                  </div>
                </div>
                <span
                  className={`tnum text-mono-data ${
                    account!.balance < 0 ? "text-error" : "text-on-surface"
                  }`}
                >
                  {formatMoney(account!.balance)}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-surface-container-highest px-lg py-md text-label-md text-on-surface-variant">
            La cuenta externa es la contrapartida de toda comisión que entra desde
            fuera de la red. Su saldo, cambiado de signo, es exactamente el dinero
            vivo adentro:{" "}
            <span className="tnum font-semibold text-on-surface">
              {formatMoney(insideTheSystem)}
            </span>
            . Es la única cuenta autorizada a ir en negativo.
          </p>
        </Card>

        <div>
          <h2 className="mb-md text-headline-md text-on-surface">
            Cómo se protege el dinero
          </h2>
          <div className="grid grid-cols-1 gap-lg md:grid-cols-2 xl:grid-cols-3">
            {defenses.map((defense) => (
              <Card key={defense.title} className="p-lg">
                <span className="grid size-10 place-items-center rounded-full bg-secondary-container">
                  <Icon
                    name={defense.icon}
                    className="text-[20px] text-on-secondary-container"
                  />
                </span>
                <p className="mt-md text-label-md font-semibold text-on-surface">
                  {defense.title}
                </p>
                <p className="mt-sm text-label-md text-on-surface-variant">
                  {defense.body}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

const defenses = [
  {
    icon: "sync_lock",
    title: "Un reparto ocurre entero o no ocurre",
    body: "El débito al broker que reporta y los créditos a las otras partes viven en una sola transacción. Si algo falla, no queda una cuenta debitada y otra sin acreditar: la comisión vuelve a quedar pendiente y se puede reintentar.",
  },
  {
    icon: "lock_clock",
    title: "Dos aprobaciones simultáneas pagan una sola vez",
    body: "La fila de la comisión se bloquea antes de leer su estado, así que si dos personas aprueban a la vez, la segunda encuentra la comisión ya liquidada y devuelve ese resultado en vez de repartir de nuevo.",
  },
  {
    icon: "replay",
    title: "Un reintento no paga dos veces",
    body: "Cada operación que mueve dinero lleva una clave de idempotencia generada por el navegador. Si la red se cae y el usuario reintenta, el sistema reconoce la clave y devuelve el resultado anterior sin volver a ejecutar.",
  },
  {
    icon: "calculate",
    title: "El reparto cuadra al centavo",
    body: "Todo se calcula en centavos enteros, nunca en decimales. Cuando la división no da exacta, la plataforma absorbe el residuo por construcción: su parte es lo que queda después de las de los brokers, así que la suma siempre cierra.",
  },
  {
    icon: "history_toggle_off",
    title: "El historial no se puede reescribir",
    body: "Los asientos del ledger no admiten modificación ni borrado, ni siquiera desde la base de datos. Corregir se hace con un asiento de reversión, como en contabilidad real.",
  },
  {
    icon: "shield",
    title: "La base rechaza un saldo negativo",
    body: "Aunque toda la lógica de aplicación fallara, una restricción a nivel de tabla impide que la cuenta de un broker quede en negativo. La única excepción es la cuenta externa, que representa el dinero que entró desde afuera.",
  },
];
