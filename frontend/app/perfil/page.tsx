import { getAccounts } from "@/lib/api";
import { getActiveBroker } from "@/lib/session";
import { BrokerProfile } from "@/components/broker-profile";
import { DepositForm } from "@/components/deposit-form";
import { PayBrokerForm } from "@/components/pay-broker-form";
import { Card, CardHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Mi cuenta: saldo, movimientos, y el ingreso de comisiones cobradas afuera. */
export default async function MyAccountPage() {
  const accounts = await getAccounts();
  const brokers = accounts.filter((a) => a.account_type === "BROKER");
  const me = await getActiveBroker(brokers);
  const others = brokers.filter((b) => b.id !== me?.id);

  if (!me) {
    return (
      <Card>
        <EmptyState
          title="No hay brokers en la red"
          description="Sumá un broker para empezar."
        />
      </Card>
    );
  }

  return (
    <BrokerProfile
      broker={me}
      actions={
        <>
          <Card>
            <CardHeader
              title="Registrar una comisión recibida"
              description="Cobraste una comisión fuera de la red. Ingresala para poder repartirla con los brokers que participaron."
            />
            {/* El selector queda fijo en mí: es MI cuenta, no un panel para
                cargarle saldo a cualquiera. */}
            <DepositForm brokers={[me]} />
          </Card>

          <Card>
            <CardHeader
              title="Pagarle a un broker"
              description="Transferencia directa desde tu saldo a la cuenta de otro broker de la red."
            />
            <PayBrokerForm me={me} others={others} />
          </Card>
        </>
      }
    />
  );
}
