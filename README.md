# Property Broker — Liquidación de comisiones

Red de brokers inmobiliarios que liquidan comisiones compartidas. La restricción
número uno: **el sistema no pierde ni un peso, ni lo duplica** — ni ante fallos,
ni ante concurrencia, ni ante reintentos.

## Arquitectura

Monolito modular: un solo deployable organizado **por dominio de negocio**, no por
capa técnica. Cada módulo es autocontenido (`router → service → repository → models → schemas`).

```
app/
├── main.py              # monta los routers de cada módulo
├── core/
│   ├── config.py        # settings
│   ├── database.py      # engine, sesión, contexto transaccional
│   ├── idempotency.py   # dependencia de Idempotency-Key
│   └── events.py        # bus de eventos in-process (detrás de interfaz)
├── modules/
│   ├── accounts/        # brokers + saldos          (núcleo bancario)
│   ├── ledger/          # asientos inmutables       (fuente de verdad)
│   ├── listings/        # inmueble + config split % (mínimo)
│   └── commissions/     # motor de split + state machine
└── tests/
```

**Regla de fronteras:** un módulo NUNCA hace queries sobre las tablas de otro.
`commissions` no toca la tabla de `accounts` — llama a `accounts.service`. Es lo que
permitiría extraer un módulo a su propio servicio sin reescribir dominio.

## Modelo de integridad

Defensas apiladas, cada una cubre un modo de falla distinto:

1. **`CHECK (balance >= 0)`** a nivel de tabla — última línea; aunque la app falle,
   la BD rechaza físicamente un saldo negativo.
2. **Atomicidad** — todo el split (débito, créditos, asientos de ledger) en UNA
   transacción. Falla algo → ROLLBACK de todo.
3. **`SELECT ... FOR UPDATE`** sobre la cuenta origen. Pesimista: en dinero la
   contención es baja pero el costo de equivocarse es máximo.
4. **Idempotencia** — header `Idempotency-Key`; key repetida devuelve el resultado
   anterior sin re-ejecutar; mismo key con otro payload → `409`.

### Saldo híbrido

- `ledger` es **append-only** y **double-entry**: la verdad histórica. Invariante
  global `SUM(amount) == 0` — el sistema no crea ni destruye plata.
- `accounts.balance` es la columna **materializada** (consultas rápidas + el `CHECK`).
- Ambos se escriben en la misma transacción. Existe una función de reconciliación
  que reconstruye el saldo desde el ledger y verifica que cuadran.

Los depósitos entran desde una **cuenta externa/mundo**, que es la única sin
`CHECK (balance >= 0)`: puede ir negativa porque representa el dinero que entró
desde afuera del sistema. El motor de transferencia es **ciego al tipo de cuenta**
— solo mueve saldo entre IDs; los flags (`is_platform`, `is_external`) son para
sembrado y reporting, nunca para ramas condicionales en la lógica de movimiento.

Dinero en **`BIGINT`, unidad mínima (centavos)**. Nunca float.

## El split de comisiones

`listings` guarda el acuerdo de reparto en **basis points enteros** (10.000 bps = 100%),
con un `CHECK` de que los tres suman exactamente 10.000. Al reportar una comisión, los
bps se **congelan** en la fila de la comisión: editar el acuerdo del inmueble después no
puede cambiar lo que se le paga a una comisión ya reportada.

```
report  ──> PENDING ──approve──> EXECUTED   (terminal)
                └──── reject ──> REJECTED   (terminal)
```

`APPROVED` no existe como estado persistido: aprobar **es** mover la plata, en la misma
transacción. Una comisión nunca queda comprometida esperando un pago que aún no ocurrió.

El reparto es aritmética entera y **la plataforma absorbe el residuo por construcción**:

```
listing_share  = gross * listing_bps // 10000
selling_share  = gross * selling_bps // 10000
platform_share = gross - listing_share - selling_share    # lo que sobra
```

El motor de comisiones **no mueve plata**: calcula cuánto le toca a cada quien y arma un
movimiento de ≤3 patas para `ledger.post_movement`, heredando locking, atomicidad y
partida doble ya probados. Las patas se construyen **por neto, no por rol** — se acumula
el delta de cada cuenta y se descartan los ceros, así que los casos en que dos roles caen
sobre la misma persona se resuelven solos, sin un `if`.

## Cuentas de sistema

Dos cuentas sembradas en la migración inicial, con UUID fijo:

| cuenta | id | `CHECK (>= 0)` | rol |
|---|---|---|---|
| Plataforma | `…0001` | sí | recibe su % de cada comisión |
| Mundo exterior | `…0002` | **no** | contrapartida de todo depósito |

La externa es la única que puede ir a negativo, y su saldo cambiado de signo es el
total de dinero vivo dentro del sistema. Esa excepción solo es segura si nadie más
la toca: `deposit()` es el único con permiso. Usarla como contraparte de una
transferencia o como broker de una comisión devuelve `422 restricted_account`.

Sin ese filtro el sistema acuña plata **sin romper `SUM(ledger) == 0`** — las dos
patas se compensan igual. Es el caso que demuestra que el invariante contable, solo,
no basta.

## Correr

```bash
cp .env.example .env
docker compose up --build
```

Las migraciones se aplican solas al arrancar (`docker-entrypoint.sh`), antes de que
la API acepte el primer request.

- API: http://localhost:8000 — docs en `/docs`
- Healthcheck: `curl http://localhost:8000/health`
- Postgres (dev): `localhost:5432`
- Postgres (tests): `localhost:5433` — **base separada**, sobre tmpfs

### API

Núcleo bancario:

| método | ruta | notas |
|---|---|---|
| `POST` | `/accounts` | crea un broker; nace en cero |
| `GET` | `/accounts/{id}` · `/accounts/{id}/balance` | |
| `POST` | `/deposits` | **Idempotency-Key** |
| `POST` | `/transfers` | **Idempotency-Key** |
| `GET` | `/accounts/{id}/ledger` | historial |
| `GET` | `/accounts/{id}/reconciliation` · `/ledger/reconciliation` | ledger vs. saldo materializado |

Motor de comisiones:

| método | ruta | notas |
|---|---|---|
| `POST` | `/listings` | acuerdo de reparto en bps |
| `POST` | `/commissions` | reporta → `PENDING`. **Idempotency-Key** |
| `POST` | `/commissions/{id}/approve` | aprueba **y ejecuta el split**. **Idempotency-Key** |
| `POST` | `/commissions/{id}/reject` | `PENDING` → `REJECTED`. **Idempotency-Key** |
| `GET` | `/commissions` · `/commissions/{id}` | |

Toda operación que mueve plata exige el header `Idempotency-Key` (UUID del cliente),
y también las dos transiciones de la máquina de estados (`approve` y `reject`) — son
hermanas y sería confuso que tuvieran contratos distintos. Misma key + mismo payload
→ se repite la respuesta guardada. Misma key + otro payload → `409`.

### Migraciones

```bash
docker compose exec api alembic revision --autogenerate -m "mensaje"
docker compose exec api alembic upgrade head
```

Contra la base de tests:

```bash
docker compose exec -e DATABASE_URL=$TEST_DATABASE_URL api alembic upgrade head
```

### Tests

```bash
docker compose exec api pytest
```

Corren contra `postgres-test`, **Postgres real**. SQLite acepta `SELECT ... FOR UPDATE`
y lo ignora: un test de concurrencia contra SQLite pasa siempre, incluso con el locking
roto. Sería un falso verde justo sobre lo único que este sistema debe garantizar.

Los tests aplican las **migraciones de Alembic**, no `create_all` — el trigger append-only
y el sembrado de cuentas de sistema solo existen en la migración.

## Estado

- [x] **Fase 1** — scaffolding: estructura, compose, config, transacciones, Alembic, healthcheck
- [x] **Fase 2** — núcleo bancario (accounts + ledger) + tests de concurrencia e idempotencia
- [x] **Fase 3** — listings + motor de comisiones (reporte → aprobación → split atómico)
- [ ] **Fase 4** — front delgado en Next.js (opcional)



