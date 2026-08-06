import { getAccounts, getCommissions, getListings } from "@/lib/api";
import type { Commission } from "@/lib/api";
import { Card, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icon";
import { ReportCommissionForm } from "@/components/report-commission-form";
import { CommissionCard } from "@/components/commission-card";
import { ApproveActions } from "@/components/approve-actions";
import { SplitSnapshotProvider } from "@/components/split-snapshot";
import { getActiveBroker } from "@/lib/session";
import { involvesBroker } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * COLABORACIONES — el tablero de negocios compartidos.
 *
 * Las columnas son los estados de la máquina: pendiente de aprobación, liquidada,
 * rechazada. Una comisión avanza de izquierda a derecha y los dos estados finales
 * son terminales, igual que en el backend.
 *
 * Solo aparecen las colaboraciones donde participo. Las del resto de la red van
 * abajo y sin cifras: se ve que la red se mueve, no cuánto factura cada uno.
 */
export default async function CollaborationsPage() {
  const [commissions, listings, accounts] = await Promise.all([
    getCommissions(),
    getListings(),
    getAccounts(),
  ]);

  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const listingOf = new Map(listings.map((l) => [l.id, l]));

  const mine = commissions.filter((c) => involvesBroker(c, me?.id));
  const others = commissions.filter((c) => !involvesBroker(c, me?.id));

  const columns = [
    {
      key: "PENDING" as const,
      title: "Esperando aprobación",
      icon: "pending_actions",
      hint: "Al aprobar, el reparto se ejecuta en una sola transacción.",
      items: mine.filter((c) => c.status === "PENDING"),
    },
    {
      key: "EXECUTED" as const,
      title: "Liquidadas",
      icon: "task_alt",
      hint: "La plata ya se movió y quedó asentada en el ledger.",
      items: mine.filter((c) => c.status === "EXECUTED"),
    },
    {
      key: "REJECTED" as const,
      title: "Rechazadas",
      icon: "cancel",
      hint: "No movieron un peso.",
      items: mine.filter((c) => c.status === "REJECTED"),
    },
  ];

  return (
    <div className="flex w-full flex-col">
      <section className="sticky top-0 z-30 bg-surface/90 px-lg py-md shadow-sm backdrop-blur-md">
        <div className="flex flex-col justify-between gap-md lg:flex-row lg:items-center">
          <div>
            <p className="text-label-sm-caps uppercase text-on-surface-variant">
              Negocios compartidos
            </p>
            <h1 className="mt-xs text-headline-lg text-on-surface">
              Colaboraciones
            </h1>
          </div>
        </div>
      </section>

      <section className="space-y-lg p-lg">
        <Card>
          <div className="flex items-start gap-sm border-b border-surface-container-highest px-lg py-md">
            <Icon name="add_task" className="mt-[2px] text-[20px] text-on-surface-variant" />
            <div>
              <h2 className="text-label-md font-semibold text-on-surface">
                Reportar una comisión
              </h2>
              <p className="mt-xs text-label-md text-on-surface-variant">
                Cerraste una venta y cobraste la comisión. Reportala para
                repartirla con quien corresponda.
              </p>
            </div>
          </div>
          <ReportCommissionForm listings={listings} brokers={brokers} />
        </Card>

        {/* El proveedor envuelve TODAS las columnas: es lo que permite que el
            resultado del reparto siga visible cuando la tarjeta salta de
            "Esperando aprobación" a "Liquidadas". */}
        <SplitSnapshotProvider>
          <div className="overflow-x-auto pb-sm">
            <div className="flex h-full min-w-max items-start gap-lg">
              {columns.map((column) => (
                <div
                  key={column.key}
                  className="flex w-[380px] flex-col rounded-xl bg-surface-container-lowest p-md shadow-sm"
                >
                  <div className="mb-md flex items-center justify-between px-xs">
                    <div className="flex items-center gap-sm">
                      <Icon
                        name={column.icon}
                        className="text-[20px] text-on-surface-variant"
                      />
                      <h3 className="text-label-md font-semibold text-on-surface">
                        {column.title}
                      </h3>
                    </div>
                    <span className="tnum rounded-full bg-surface-container-high px-sm py-xs text-label-sm-caps text-on-surface-variant">
                      {column.items.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-md">
                    {column.items.length === 0 ? (
                      <p className="rounded-xl bg-surface-container-low px-md py-lg text-center text-label-md text-on-surface-variant">
                        {emptyFor(column.key)}
                      </p>
                    ) : (
                      column.items.map((commission) => (
                        <CommissionCard
                          key={commission.id}
                          commission={commission}
                          listing={listingOf.get(commission.listing_id)}
                          nameOf={nameOf}
                          myRole={roleOf(commission, me?.id)}
                          actions={
                            <ApproveActions
                              commission={commission}
                              accounts={accounts}
                              meId={me?.id}
                            />
                          }
                        />
                      ))
                    )}
                  </div>

                  <p className="mt-md px-xs text-label-md text-on-surface-variant/70">
                    {column.hint}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </SplitSnapshotProvider>

        {others.length > 0 && (
          <section>
            <div className="mb-md">
              <h2 className="text-label-md font-semibold text-on-surface">
                En el resto de la red
              </h2>
              <p className="mt-xs text-label-md text-on-surface-variant">
                Negocios entre otros brokers. Ves que la red se mueve, no cuánto
                factura cada uno.
              </p>
            </div>
            <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
              {others.map((commission) => (
                <CommissionCard
                  key={commission.id}
                  commission={commission}
                  listing={listingOf.get(commission.listing_id)}
                  nameOf={nameOf}
                  showAmounts={false}
                />
              ))}
            </div>
          </section>
        )}

        {mine.length === 0 && others.length === 0 && (
          <Card>
            <EmptyState
              icon="handshake"
              title="Todavía no hay colaboraciones"
              description="Reportá una comisión arriba, o conseguí el cliente para un inmueble del mercado."
            />
          </Card>
        )}
      </section>
    </div>
  );
}

function emptyFor(status: Commission["status"]): string {
  if (status === "PENDING") return "Nada esperando aprobación.";
  if (status === "EXECUTED") return "Todavía no liquidaste ninguna.";
  return "Ninguna rechazada.";
}

/** Cómo participo yo. Un mismo broker puede tener dos roles a la vez. */
function roleOf(commission: Commission, meId: string | undefined): string | undefined {
  if (!meId) return undefined;
  const roles: string[] = [];
  if (commission.reported_by_account_id === meId) roles.push("Reportaste");
  if (commission.listing_broker_account_id === meId) roles.push("captaste");
  if (commission.selling_broker_account_id === meId) roles.push("vendiste");
  return roles.length > 0 ? roles.join(" y ") : undefined;
}
