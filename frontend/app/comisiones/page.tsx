import { getAccounts, getCommissions, getListings } from "@/lib/api";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { ReportCommissionForm } from "@/components/report-commission-form";
import { CommissionCard } from "@/components/commission-card";
import { ApproveActions } from "@/components/approve-actions";
import { getActiveBroker } from "@/lib/session";
import { involvesBroker } from "@/lib/identity";

export const dynamic = "force-dynamic";

export default async function CommissionsPage() {
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
  const minePending = mine.filter((c) => c.status === "PENDING").length;

  return (
    <>
      <PageHeader
        eyebrow="Liquidación"
        title="Comisiones"
        description="Una comisión se reporta con su evidencia y queda pendiente. Al aprobarse, el reparto se ejecuta en una sola transacción: o se mueven las tres cuentas, o no se mueve ninguna."
      />

      <div className="space-y-8">
        <Card>
          <CardHeader
            title="Reportar una comisión"
            description="Cerraste una venta y cobraste la comisión. Reportala para repartirla con quien corresponda."
          />
          <ReportCommissionForm listings={listings} brokers={brokers} />
        </Card>

        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink">
              Mis comisiones
            </h2>
            <p className="text-[0.8125rem] text-muted">
              {minePending > 0
                ? `${minePending} esperando aprobación`
                : "Ninguna pendiente"}
            </p>
          </div>

          {mine.length === 0 ? (
            <Card>
              <EmptyState
                title="Todavía no participás de ninguna comisión"
                description="Reportá una arriba, o conseguí el cliente para un inmueble de otro broker."
              />
            </Card>
          ) : (
            /* Una sola lista cronológica, sin separar por estado.
               No es solo estética: al aprobar, la tarjeta conserva su posición y
               su clave, así que el componente cliente no se desmonta y puede
               mostrar el "antes → después" de los saldos en el mismo lugar donde
               estaba mirando el usuario. */
            <div className="space-y-4">
              {mine.map((commission) => (
                <CommissionCard
                  key={commission.id}
                  commission={commission}
                  listing={listingOf.get(commission.listing_id)}
                  nameOf={nameOf}
                  actions={
                    <ApproveActions commission={commission} accounts={accounts} />
                  }
                />
              ))}
            </div>
          )}
        </section>

        {others.length > 0 && (
          <section>
            <h2 className="mb-1 text-[0.9375rem] font-semibold tracking-tight text-ink">
              En el resto de la red
            </h2>
            <p className="mb-4 text-[0.8125rem] text-muted">
              Negocios entre otros brokers. Ves que la red se mueve, no cuánto
              factura cada uno.
            </p>
            <div className="space-y-4">
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
      </div>
    </>
  );
}
