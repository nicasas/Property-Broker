# Modelo de integridad

Referencia técnica de las defensas que garantizan que el sistema no pierde ni duplica
dinero. Cada defensa se documenta con **mecanismo** (qué es y cómo funciona, con el
nombre real del constraint, trigger o patrón en el código), **propósito** (qué modo de
falla concreto previene) y **evidencia** (el test que lo prueba y, donde se ejecutó, la
verificación por mutación).

Las defensas están apiladas: cada capa cubre un modo de falla que las otras no ven. Ninguna
es suficiente sola, y la sección [El límite del invariante contable](#45-el-límite-del-invariante-contable)
documenta un caso donde la defensa más fuerte del sistema no detecta una fuga real.

Suite: **165 tests**, todos contra PostgreSQL real.

---

## Índice

- [Capa 1 — Restricciones declarativas de base de datos](#capa-1--restricciones-declarativas-de-base-de-datos)
- [Capa 2 — Transacción y concurrencia](#capa-2--transacción-y-concurrencia)
- [Capa 3 — Idempotencia](#capa-3--idempotencia)
- [Capa 4 — Contabilidad de partida doble](#capa-4--contabilidad-de-partida-doble)
- [Capa 5 — Aritmética del dinero](#capa-5--aritmética-del-dinero)
- [Capa 6 — Guards de aplicación](#capa-6--guards-de-aplicación)
- [Resumen de verificaciones por mutación](#resumen-de-verificaciones-por-mutación)

---

## Capa 1 — Restricciones declarativas de base de datos

Última línea de defensa. Se aplican aunque toda la lógica de aplicación falle, y cubren
escrituras que no pasan por la API: scripts administrativos, seeds, migraciones de datos.

### 1.1 Saldo no negativo

**Mecanismo.** `CHECK` a nivel de tabla en `accounts`:

```sql
CONSTRAINT ck_accounts_balance_non_negative
  CHECK (account_type = 'EXTERNAL' OR balance >= 0)
```

Es condicional por una razón estructural. La cuenta **externa / mundo**
(`00000000-0000-0000-0000-000000000002`) es la contrapartida de todo depósito y vive en
negativo por construcción: su saldo cambiado de signo es el total de dinero vivo dentro
del sistema. Con un `CHECK (balance >= 0)` universal, ningún depósito sería posible.

La condición tiene espejo en Python: `Account.allows_negative_balance`, consultada por
`accounts.service.apply_delta`. Un solo criterio, dos capas.

**Propósito.** Previene que un saldo de broker o de plataforma quede negativo aunque la
validación de aplicación falle, sea eludida o quede desactualizada. Un `UPDATE` directo que
lo intente aborta la transacción completa.

**Evidencia.**
- `test_integrity.py::test_la_base_rechaza_fisicamente_un_saldo_negativo` — `UPDATE` en SQL
  crudo, sin pasar por `accounts.service`; se verifica el nombre del constraint en el error.
- `test_integrity.py::test_la_plataforma_tampoco_puede_ir_a_negativo`
- `test_integrity.py::test_la_cuenta_externa_si_puede_ir_a_negativo` — fija la excepción
  como comportamiento deseado, no como omisión.

### 1.2 Ledger append-only

**Mecanismo.** Trigger `trg_ledger_entries_append_only` sobre `ledger_entries`, `BEFORE
UPDATE OR DELETE ... FOR EACH ROW`, que ejecuta `ledger_entries_append_only()` y lanza
excepción con `ERRCODE = 'restrict_violation'`.

**Propósito.** Previene la reescritura de la historia del dinero. Poder editar un asiento
es poder hacer que el pasado cuadre con cualquier presente. La inmutabilidad no depende de
la disciplina del programador ni del ORM: el trigger bloquea la escritura venga de la
aplicación, de una migración futura o de un `psql` a mano en producción.

Corregir un asiento equivocado se hace como en contabilidad real: con un asiento de
reversión, no borrando.

**Nota operativa.** `TRUNCATE` no dispara triggers `FOR EACH ROW`, por lo que la limpieza
entre tests funciona sin desactivar el guardia.

**Evidencia.**
- `test_integrity.py::test_el_ledger_no_se_puede_actualizar`
- `test_integrity.py::test_el_ledger_no_se_puede_borrar`

Ambos ejecutan SQL crudo y verifican que el mensaje contiene `append-only`.

### 1.3 FK parcial vía columna generada

**Mecanismo.** PostgreSQL no admite subconsultas en un `CHECK` ni claves foráneas contra
una vista, de modo que una tabla no puede exigir por sí sola *"esta cuenta no es la
externa"*. El patrón lo consigue de forma declarativa en dos partes:

```sql
-- 1. El par referenciable, en accounts
is_settleable BOOLEAN GENERATED ALWAYS AS (account_type <> 'EXTERNAL') STORED
CONSTRAINT uq_accounts_id_is_settleable UNIQUE (id, is_settleable)

-- 2. En cada columna de cuenta que alimenta un movimiento
<col>_is_settleable BOOLEAN NOT NULL DEFAULT true
CONSTRAINT ck_..._settleable CHECK (<col>_is_settleable)
CONSTRAINT fk_..._settleable
  FOREIGN KEY (<col>_account_id, <col>_is_settleable)
  REFERENCES accounts (id, is_settleable)
```

`STORED` y no `VIRTUAL`: una FK no puede referenciar una columna generada virtual.

La columna acompañante está clavada en `true` por el `CHECK`, así que la FK solo puede
resolver contra cuentas con `is_settleable = true`. La cuenta externa tiene
`is_settleable = false`: **no existe fila del otro lado que satisfaga la FK**.

Aplicado a las cuatro columnas que terminan alimentando un leg:

| tabla | columna | constraint |
|---|---|---|
| `listings` | `listing_broker_account_id` | `fk_listings_broker_settleable` |
| `commissions` | `listing_broker_account_id` | `fk_commissions_listing_broker_settleable` |
| `commissions` | `selling_broker_account_id` | `fk_commissions_selling_broker_settleable` |
| `commissions` | `reported_by_account_id` | `fk_commissions_reported_by_settleable` |

El alcance incluye las tres columnas de `commissions` porque **esas** —no las de
`listings`— son las que `approve_commission` lee para construir los legs. Blindar solo
`listings` habría dejado un `INSERT` directo a `commissions` como camino abierto, que es
justamente donde el snapshot deja de depender del listing.

**Propósito.** Previene que la cuenta externa aparezca en un leg. Ese es el modo de falla
que permitía **acuñar dinero**: la externa no tiene `CHECK (balance >= 0)`, así que se
hundía en negativo sin límite mientras el destino recibía dinero que nunca entró al
sistema; o, en la dirección contraria, dinero salía sin dejar rastro.

**Por qué FK y no trigger.** Solo la FK valida las filas preexistentes. Al agregar la
constraint, PostgreSQL verifica la tabla entera: una fila anterior que la viole hace
**fallar la migración** en vez de quedar viva y en silencio. Un trigger `BEFORE INSERT OR
UPDATE` solo cubre escrituras futuras y habría dejado intactas justamente las filas viejas,
que son el escenario que motiva tener una capa de base de datos. La FK cubre además la
dirección inversa —convertir en `EXTERNAL` una cuenta ya referenciada— que un trigger sobre
`listings` no vería.

**Evidencia.**
- `test_system_accounts.py::test_la_base_bloquea_un_listing_con_la_externa_como_broker`
- `test_system_accounts.py::test_la_base_bloquea_un_insert_directo_a_commissions_con_la_externa`
  — el que sostiene la afirmación fuerte: no queda camino, ni preexistente ni futuro ni
  saltándose la aplicación.
- `test_system_accounts.py::test_no_se_puede_convertir_en_externa_una_cuenta_ya_referenciada`
  — dirección inversa. El test quita el índice singleton (§1.4) dentro de la transacción
  porque se dispara **antes** que la FK y tapa lo que se quiere observar; el DDL en
  PostgreSQL es transaccional, así que el rollback lo restituye.
- **Validación de filas preexistentes, verificada en vivo:** sembrada una fila con la cuenta
  externa como `listing_broker` y ejecutada la migración, `alembic upgrade head` termina con
  **exit code 1** y `psycopg.errors.ForeignKeyViolation ... "fk_listings_broker_settleable"`.
  Eliminada la fila, la migración corre en verde.

### 1.4 Unicidad de las cuentas de sistema

**Mecanismo.** Índice único parcial `uq_accounts_singleton_system_types` sobre
`account_type`, con `WHERE account_type IN ('PLATFORM', 'EXTERNAL')`.

**Propósito.** Previene que existan dos cuentas externas, lo que significaría dos verdades
simultáneas sobre cuánto dinero entró al sistema, y por tanto una reconciliación global sin
significado.

**Evidencia.** `test_integrity.py::test_no_puede_existir_una_segunda_cuenta_externa`.

### 1.5 Restricciones de forma

Constraints que impiden estados que no corresponden a ningún hecho de negocio válido.

| constraint | previene |
|---|---|
| `ck_ledger_amount_not_zero` | asientos de monto cero: ruido sin hecho contable detrás |
| `ck_ledger_valid_operation_type` | tipos de operación fuera del dominio |
| `ck_accounts_valid_type` | tipos de cuenta fuera del dominio |
| `ck_listings_bps_sum_to_total` | acuerdos que no reparten exactamente 10.000 bps (100%) |
| `ck_listings_bps_non_negative` | participaciones negativas |
| `ck_commissions_bps_sum_to_total` | lo mismo sobre el snapshot congelado |
| `ck_commissions_gross_positive` | comisiones de monto cero o negativo |
| `ck_commissions_valid_status` | estados fuera de la máquina |
| `ck_commissions_executed_has_shares` | una comisión `EXECUTED` sin registro de qué se repartió |

`ck_listings_bps_sum_to_total` no es cosmético: es lo que garantiza que el residuo que
absorbe la plataforma (§5.2) nunca sea negativo.

**Evidencia.**
- `test_integrity.py::test_un_asiento_de_monto_cero_se_rechaza`
- `test_commissions.py::test_la_base_tambien_rechaza_un_acuerdo_invalido`
- `test_commissions.py::test_un_acuerdo_que_no_suma_cien_por_ciento_se_rechaza` (capa de
  aplicación, mismo criterio)

---

## Capa 2 — Transacción y concurrencia

### 2.1 Atomicidad: `transaction()` como único committer

**Mecanismo.** `core/database.transaction()` es un context manager que abre la sesión, hace
`commit` al salir bien y `rollback` ante cualquier excepción. **Es el único lugar del
sistema que comitea.**

La regla de composición que lo sostiene: todos los services reciben `session` como
parámetro y ninguno abre su propio contexto ni comitea. Solo el caller más externo —el
router, o `execute_idempotent`— es dueño de la transacción. Por eso `approve_commission`
puede componer `accounts.service`, `ledger.service` y su propia escritura dentro de **una**
unidad atómica.

Un split completo —débito al reportante, crédito a la plataforma, crédito al selling
broker, más los asientos de ledger correspondientes— vive o muere entero.

**Propósito.** Previene el modo de falla que destruye dinero más silenciosamente: el origen
debitado y el destino nunca acreditado, o asientos de ledger sin el movimiento de saldo que
los respalda. No existe un punto en el tiempo, visible para nadie, donde uno esté sin el
otro.

**Evidencia.**
- `test_wallet.py::test_el_rollback_deshace_el_movimiento_entero` — inyecta una excepción
  después de mover el saldo y verifica que no quedó ni saldo alterado ni asiento.
- `test_split.py::test_saldo_insuficiente_al_aprobar_no_deja_nada_a_medias` — el caso real.
  Las patas se bloquean por `account_id` ascendente, así que la cuenta sin fondos **puede
  procesarse después** de haber acreditado a otra. Que el resultado sea limpio no es suerte:
  es la atomicidad.
- `test_split.py::test_una_invariante_rota_produce_un_rollback_limpio` — verifica que una
  `InvariantViolation` (§5.4) también deshace todo: saldos intactos, comisión en `PENDING`,
  sin asientos huérfanos.

### 2.2 Locking pesimista

**Mecanismo.** `accounts.repository.get_for_update()` ejecuta
`SELECT ... FOR UPDATE`, tomando el lock de fila y sosteniéndolo hasta el fin de la
transacción. Es el único camino de lectura para escritura de un saldo, usado por
`accounts.service.apply_delta()`.

Incluye `execution_options(populate_existing=True)`, y **es obligatorio**: sin él, si la
instancia ya está en la identity map de la sesión, SQLAlchemy devuelve el objeto cacheado y
descarta los valores frescos que acaba de traer el `SELECT`. Se leería un saldo viejo con el
lock puesto — exactamente el bug que el lock viene a evitar.

Pesimista y no optimista por criterio de dominio: en dinero la contención real es baja pero
el costo de equivocarse es máximo. Es preferible que el segundo request espere su turno a
que descubra tarde que perdió una carrera.

**Propósito.** Previene que dos transferencias concurrentes gasten el mismo saldo (doble
gasto) y que dos escrituras simultáneas se pisen perdiendo una de ellas (lost update).

**Evidencia.**
- `test_concurrency.py::test_solo_una_de_veinte_transferencias_gana_el_ultimo_peso` — veinte
  requests simultáneos por un saldo que alcanza para uno; exactamente 1 éxito y 19
  `InsufficientFunds`.
- `test_concurrency.py::test_el_saldo_alcanza_para_exactamente_diez_de_veinticinco` — el
  corte cae donde dice la aritmética, no donde caiga la carrera.
- `test_concurrency.py::test_transferencias_concurrentes_no_pierden_actualizaciones` — 50
  débitos que sí caben; ninguno se evapora, y el ledger tiene exactamente 50 asientos.
- `test_concurrency.py::test_depositos_concurrentes_a_la_misma_cuenta_suman_exacto`
- `test_concurrency.py::test_cadena_de_transferencias_concurrentes_conserva_el_total` — cinco
  cuentas moviéndose entre sí; ningún saldo individual es predecible, el total sí.

**Verificación por mutación.** Quitando `.with_for_update()`, **5 de 6** tests de
concurrencia fallan, con firmas de dinero destruido: `assert 480000 == 500000` (20.000
evaporados) y `assert -12345 == -370350` (29 de 30 depósitos perdidos).

El sexto —el de doble gasto— falló de forma **no determinista**: `PASSED, FAILED, FAILED` en
tres corridas consecutivas. Ese es el argumento más fuerte a favor del lock: un sistema con
esta carrera abierta pasa el test una de cada tres veces y deja creer que está bien. Con el
lock es determinista siempre.

**Requisito de la suite.** Los tests corren contra PostgreSQL real. SQLite acepta
`SELECT ... FOR UPDATE` y lo ignora: un test de concurrencia contra SQLite pasa siempre,
incluso con el locking roto. Sería un falso verde sobre justo lo que el sistema debe
garantizar. Cada thread abre su **propia sesión** vía `transaction()`; las sesiones de
SQLAlchemy no son thread-safe, y compartirlas invalidaría el test.

### 2.3 Orden de adquisición de locks

**Mecanismo.** `ledger.service.post_movement()` itera las patas ordenadas por `account_id`
ascendente antes de llamar a `apply_delta`. Todas las transacciones piden los locks en la
misma secuencia.

**Propósito.** Previene deadlocks. Sin orden determinista, `A→B` toma el lock de A y pide el
de B mientras `B→A` toma el de B y pide el de A: abrazo mortal, y PostgreSQL mata una de las
dos transacciones con `DeadlockDetected`. Con orden, la que llega segunda simplemente espera.

**Evidencia.** `test_concurrency.py::test_transferencias_cruzadas_no_producen_deadlock` — 20
threads alternando dirección sobre el mismo par de cuentas, ambas con saldo de sobra para
que la única causa posible de fallo sea un deadlock. Los 20 completan y los saldos vuelven al
punto de partida.

---

## Capa 3 — Idempotencia

Dos mecanismos independientes. Protegen cosas distintas y **hacen falta los dos**.

### 3.1 `Idempotency-Key` con insert-first

**Mecanismo.** `core/idempotency.execute_idempotent()`. Toda operación que mueve dinero, y
ambas transiciones de la máquina de estados, exigen el header `Idempotency-Key` (UUID del
cliente). Se persiste `key + endpoint + hash(payload) + status + response_body` en
`idempotency_keys`, con la key como clave primaria.

Dos detalles de diseño son los que lo hacen seguro:

**Insert-first.** La fila de la key se inserta **al principio** de la transacción, antes de
tocar un solo saldo. Si dos requests con la misma key llegan a la vez, el segundo choca
contra el índice de clave primaria en el `INSERT`: se frena ahí, **todavía sin haber movido
nada**, y cuando el primero comitea revienta con `IntegrityError` y devuelve la respuesta
cacheada. Con insert-last, los dos habrían ejecutado el movimiento antes de descubrir el
conflicto.

**Misma transacción que el movimiento.** Si el movimiento falla y hace rollback, la fila de
la key se va con él: la key **no queda quemada** y el cliente puede reintentar de verdad.
Solo las operaciones que efectivamente ocurrieron dejan rastro de idempotencia.

Un `IntegrityError` puede venir de la key repetida o del `CHECK` de saldo, y significan cosas
opuestas. Se distinguen por `exc.orig.diag.constraint_name`, no por substring del mensaje.

Contrato: misma key + mismo payload → se repite la respuesta guardada sin re-ejecutar; misma
key + otro payload → `409 Conflict` (comportamiento Stripe).

**Propósito.** Previene que un reintento de cliente —típicamente tras una caída de red que
cortó la respuesta— ejecute el movimiento dos veces.

**Evidencia.**
- `test_idempotency.py::test_reintento_con_la_misma_key_no_transfiere_dos_veces` — la
  respuesta repetida es **idéntica**, mismo `movement_id` y mismos ids de asiento: el cliente
  no puede distinguir si se ejecutó o se reprodujo.
- `test_idempotency.py::test_diez_requests_simultaneos_con_la_misma_key_ejecutan_una_sola_vez`
  — el caso que justifica el insert-first; se cuenta que el handler corrió exactamente 1 vez.
- `test_idempotency.py::test_una_operacion_fallida_no_quema_la_key` — falla por saldo, entra
  el depósito, y **la misma key** ejecuta.
- `test_idempotency.py::test_misma_key_con_payload_distinto_es_conflicto`
- `test_idempotency.py::test_misma_key_distinto_payload_en_concurrencia`
- `test_idempotency.py::test_keys_distintas_si_ejecutan_dos_veces` — control negativo: la
  idempotencia no puede degenerar en deduplicación ciega.
- `test_idempotency.py::test_insufficient_funds_no_se_confunde_con_conflicto_de_key`
- `test_commissions.py::test_reject_exige_idempotency_key`,
  `test_reintentar_el_reject_con_la_misma_key_conserva_la_trazabilidad`,
  `test_reject_con_la_misma_key_y_otro_payload_es_conflicto`

En `reject` la idempotencia no protege saldo: protege el **registro**. Rechazar dos veces
deja el mismo estado final, pero sin la key un reintento sobrescribe `rejected_by` y
`rejection_reason` con los del segundo intento. El estado sería el mismo, la trazabilidad no.

### 3.2 Lock de fila de dominio en las transiciones

**Mecanismo.** `commissions.repository.get_for_update()` hace `SELECT ... FOR UPDATE` sobre
la fila de la comisión, y `approve_commission` / `reject_commission` verifican el estado
**bajo ese lock**. Si ya está en el estado terminal, devuelven el resultado ya liquidado sin
ejecutar nada; si no, la máquina de estados (§6.2) decide.

El chequeo solo vale bajo el lock: leer el estado sin él es leer una foto que puede envejecer
entre el `SELECT` y el `UPDATE`.

**Propósito.** Previene que **dos requests distintos, con keys distintas** —dos operadores,
dos pestañas— ejecuten el mismo split. El `Idempotency-Key` no puede ayudar aquí: para él son
requests nuevos y legítimos.

**Evidencia.**
- `test_commissions.py::test_diez_aprobaciones_simultaneas_ejecutan_el_split_una_sola_vez` —
  diez operadores, sesiones propias, **sin** header de idempotencia. Los diez reciben
  respuesta válida; la plata se mueve una vez; hay exactamente un movimiento de tres patas.
- `test_commissions.py::test_aprobar_de_nuevo_con_OTRA_key_tampoco_paga_dos_veces` — las dos
  capas trabajando juntas; `approved_by` sigue siendo el del primero.
- `test_commissions.py::test_aprobar_y_rechazar_a_la_vez_solo_deja_ganar_a_uno` — carrera
  entre transiciones opuestas; no puede quedar ejecutada **y** rechazada.

**Verificación por mutación.** Quitando el `FOR UPDATE` de la fila de comisión, el test falla
con `InsufficientFunds`. El detalle importa: **cinco de las diez aprobaciones ejecutaron el
split completo**, y las demás fallaron porque a la cuenta se le acabó el dinero. El sistema
pagó cinco veces la misma comisión y se detuvo por bancarrota, no por corrección.

---

## Capa 4 — Contabilidad de partida doble

### 4.1 El invariante global

**Mecanismo.** `ledger_entries` es double-entry. Un movimiento no es una fila sino un
conjunto de filas que comparten `movement_id` y cuyos montos **suman cero**. Todo el sistema
se expresa sobre una sola primitiva, `ledger.service.post_movement(session, legs, ...)`, que
valida antes de escribir: mínimo dos patas, ninguna en cero, sin cuentas repetidas, y suma
exactamente cero.

```
SELECT SUM(amount) FROM ledger_entries;  -->  0, siempre
```

**Propósito.** Un cero ahí significa que el sistema no creó ni destruyó un peso. Cualquier
otro número es dinero inventado o desaparecido, sin importar qué tan razonables se vean los
saldos individuales.

**Evidencia.**
- `test_integrity.py::test_el_ledger_completo_suma_cero_despues_de_operar`
- `test_wallet.py::test_un_movimiento_cuyas_patas_no_suman_cero_se_rechaza`
- `test_wallet.py::test_monto_cero_y_cuenta_repetida_se_rechazan`
- `conftest.assert_system_is_balanced()` cierra **todo** test que mueva dinero.

### 4.2 Saldo híbrido y reconciliación

**Mecanismo.** El ledger es la verdad histórica; `accounts.balance` es una columna
materializada para consultas rápidas y para poder colgarle el `CHECK` (§1.1). Ambos se
escriben en la misma transacción. `ledger.service.reconcile_all()` verifica las dos cosas a
la vez: que `SUM(amount) == 0` sobre toda la tabla, y que para cada cuenta el saldo
materializado coincide con la suma de su propio ledger. Expuesto en
`GET /ledger/reconciliation`.

`ledger_entries.balance_after` guarda el saldo resultante de cada asiento — redundante a
propósito: hace el historial legible y permite detectar una desincronización sin recorrer la
tabla entera.

**Propósito.** Previene que el atajo de performance mienta sin que nadie se entere.

**Evidencia.**
- `test_integrity.py::test_la_reconciliacion_detecta_una_desincronizacion_forzada` — **control
  positivo**: se corrompe a mano el saldo materializado y se verifica que la reconciliación
  *sí* lo reporta, distinguiendo además que el ledger sigue cuadrado y la mentira está en la
  columna. Un detector que nunca dice que no, no es un detector.

### 4.3 Un movimiento, un hecho contable

**Mecanismo.** Las patas de un split comparten `movement_id` y llevan `reference` con el id
de la comisión que las originó.

**Propósito.** Un split no son tres transferencias sueltas que ocurrieron juntas por
casualidad: es un único hecho, y el ledger lo refleja de forma auditable.

**Evidencia.** `test_split.py::test_el_split_es_un_solo_movimiento_en_el_ledger`.

### 4.4 Depósitos con contrapartida

**Mecanismo.** `deposit()` no crea dinero: emite dos patas, una que debita la cuenta externa
y otra que acredita al destino.

**Propósito.** Preserva §4.1 aun cuando entra dinero de fuera del sistema. El saldo de la
cuenta externa, cambiado de signo, es exactamente el total de dinero vivo adentro.

**Evidencia.** `test_wallet.py::test_deposito_carga_saldo_y_hunde_la_cuenta_externa`;
`test_integrity.py::test_el_ledger_completo_suma_cero_despues_de_operar` verifica
explícitamente que `-balance(externa) == suma de los saldos internos`.

### 4.5 El límite del invariante contable

**Este es el punto más importante del documento.**

`SUM(amount) == 0` es la afirmación más fuerte que hace el sistema, y **no detecta la fuga
por la cuenta externa**. Una transferencia ordinaria que use la cuenta externa como
contraparte emite dos patas que se compensan perfectamente: el invariante sigue dando cero,
`reconcile_all()` reporta `is_balanced: true`, y el sistema acuñó o destruyó dinero.

Verificado en vivo antes de cerrar el hueco: un split cuyo `listing_broker` era la cuenta
externa acreditó 400.000 fuera del sistema mientras `SUM(ledger)` daba `0` y la
reconciliación reportaba `is_balanced=true`.

La razón es que el invariante es **contable**, no **semántico**: garantiza que las patas
cuadran entre sí, no que las cuentas involucradas tengan derecho a participar. Esa garantía
la aportan la FK parcial (§1.3) y los guards de aplicación (§6.1), y por eso ninguna de las
tres es prescindible.

**Evidencia.** Los tests de §1.3 y §6.1. En particular
`test_system_accounts.py::test_no_se_puede_transferir_desde_la_cuenta_externa`, cuyo docstring
documenta que el ledger seguía sumando cero mientras el sistema acuñaba.

---

## Capa 5 — Aritmética del dinero

### 5.1 Enteros, nunca punto flotante

**Mecanismo.** Todo monto es `BIGINT` en la unidad mínima (centavos). Los porcentajes de
reparto se guardan en **basis points enteros** (10.000 bps = 100%): 33,33% es `3333`, un
entero exacto, y no `0.3333`, que ya trae error de representación desde el primer día.

**Propósito.** Previene el error de redondeo acumulado. `0.1 + 0.2 != 0.3` en punto flotante,
y ese error sobre miles de liquidaciones es dinero real que no cuadra.

**Evidencia.** `test_split.py::test_el_reparto_nunca_usa_float` — control explícito de tipo
sobre los tres montos resultantes.

### 5.2 El residuo lo absorbe la plataforma, por construcción

**Mecanismo.** `commissions.service.compute_shares()`. Las partes de los brokers salen de
división entera; la de la plataforma **no se calcula**, es lo que sobra:

```python
listing_share  = gross * listing_bps // 10_000
selling_share  = gross * selling_bps // 10_000
platform_share = gross - listing_share - selling_share
```

La suma cierra exacta siempre, sin repartir centavos sueltos a mano. `platform_bps` no entra
en la cuenta: es documentación del acuerdo. El `CHECK` de que los tres bps suman 10.000
(§1.5) es lo que garantiza que el residuo nunca sea negativo.

**Propósito.** Previene que un reparto que no divide exacto pierda o invente centavos.
10.001 en tercios da 3.333 + 3.333 + 3.335.

**Evidencia.**
- `test_split.py::test_el_residuo_se_lo_queda_la_plataforma`
- `test_split.py::test_un_centavo_no_se_puede_partir_en_tres` — el caso límite: los brokers
  reciben cero y la plataforma se queda el centavo entero. Feo, pero exacto.
- `test_split.py::test_el_reparto_siempre_suma_el_bruto_exacto` — barrido parametrizado de
  **84 combinaciones** (12 montos × 7 acuerdos) con una sola afirmación sin excepciones.
- `test_split.py::test_split_con_residuo_de_punta_a_punta` — el mismo 10.001 moviéndose de
  verdad contra el ledger; aritmética correcta con un movimiento mal armado seguiría siendo un
  sistema roto.

### 5.3 Patas por neto, no por rol

**Mecanismo.** `commissions.service.build_split_legs()` acumula el delta **neto** de cada
cuenta en un diccionario y descarta las que quedan en cero, en vez de emitir una pata por
rol.

**Propósito.** Previene los casos especiales que aparecen cuando dos roles caen sobre la
misma persona — y que, emitidos por rol, producirían movimientos que `post_movement` rechaza:

| caso | resultado |
|---|---|
| reportante == listing broker | su neto colapsa a `-(platform + selling)`: el que tiene el dinero paga hacia afuera |
| listing broker == selling broker | las dos partes se **fusionan en una pata** (por rol: cuenta repetida → rechazado) |
| plataforma al 0% | su pata **desaparece** (por rol: pata en cero → rechazado) |
| los tres son la misma cuenta y plataforma al 0% | no quedan patas: no hay dinero que mover, no se emite movimiento |

Ninguno de esos casos necesita una línea de código propia.

**Evidencia.** `test_split.py::test_tres_partes_distintas_producen_tres_patas`,
`test_si_el_listing_y_el_selling_broker_son_el_mismo_las_patas_se_fusionan`,
`test_una_parte_en_cero_no_genera_pata`,
`test_cuando_todo_se_resuelve_en_una_cuenta_no_hay_patas`.

### 5.4 Invariantes que sobreviven a `python -O`

**Mecanismo.** Las comprobaciones que protegen la aritmética del reparto son excepciones
`InvariantViolation` (HTTP 500), **no `assert`**.

`python -O` elimina los `assert`, y es una forma perfectamente normal de arrancar un proceso
en producción. Con `assert`, las invariantes centrales del reparto simplemente no existirían
donde más importa. No queda ningún `assert` en código de producción (`app/modules`,
`app/core`).

**Propósito.** Previene que el sistema liquide una comisión que no cuadra. Ante una invariante
rota, lo correcto es no mover dinero, no seguir adelante con un resultado que ya se sabe
inválido.

**Evidencia.**
- `test_split.py::test_la_invariante_del_reparto_no_depende_de_assert`
- `test_split.py::test_una_invariante_rota_produce_un_rollback_limpio` — una invariante que se
  levanta a mitad de camino solo sirve si la transacción se deshace entera.
- La suite completa pasa bajo `python -O -m pytest`.

---

## Capa 6 — Guards de aplicación

Devuelven errores de dominio con código y mensaje útiles. Duplican a propósito lo que la base
de datos garantiza estructuralmente: la BD da la garantía, la aplicación da el diagnóstico.

### 6.1 `require_settleable_account`

**Mecanismo.** `accounts.service.require_settleable_account()` es el único lugar del código
que sabe que existen cuentas no operables. Rechaza la cuenta externa con `422
restricted_account`. Aplicado en cuatro bordes:

| borde | ubicación |
|---|---|
| origen y destino de una transferencia | `ledger.service.transfer()` |
| destino de un depósito | `ledger.service.deposit()` |
| los tres roles de una comisión | `commissions.service.report_commission()` |
| broker que capta un inmueble | `listings.service.create_listing()` |

Se valida **en el borde de los casos de uso**, nunca dentro de `post_movement`: el motor de
movimientos permanece ciego al tipo de cuenta, solo mueve saldo entre ids. `deposit()`
conserva el permiso explícito de debitar la externa —es lo que la hace útil— pero no de
acreditarla.

El guard de `report_commission` cubre los **tres** roles, incluido `listing_broker`, que no
viene del request sino copiado del listing. Se revalida en el momento de congelar el
snapshot: es cuando ese valor deja de pertenecer al listing y pasa a ser el que va a mover
dinero.

**Propósito.** Previene la acuñación y la fuga descritas en §4.5, con un diagnóstico claro en
vez de un error de constraint.

**Evidencia.**
- `test_system_accounts.py::test_no_se_puede_transferir_desde_la_cuenta_externa`
- `test_system_accounts.py::test_no_se_puede_transferir_hacia_la_cuenta_externa`
- `test_system_accounts.py::test_no_se_puede_depositar_hacia_la_cuenta_externa` — verifica que
  el error sea `restricted_account` y **no** `invalid_movement`. Antes del guard el rechazo
  ocurría igual, pero por la regla de cuenta repetida: una defensa incidental que protegía sin
  saber que protegía.
- `test_system_accounts.py::test_la_cuenta_externa_no_puede_ser_broker_de_una_comision`
- `test_system_accounts.py::test_la_cuenta_externa_no_puede_captar_un_inmueble`
- `test_system_accounts.py::test_report_commission_revalida_el_listing_broker` — con la FK
  puesta (§1.3) este guard ya no se puede provocar con datos reales, así que el test simula el
  listing envenenado. Las dos capas se prueban por separado: si mañana alguien relaja la FK,
  este test sigue exigiendo que la aplicación no deje pasar el valor.
- `test_system_accounts.py::test_el_deposito_si_puede_tocar_la_cuenta_externa`,
  `test_la_plataforma_si_es_contraparte_valida`, `test_si_se_puede_depositar_a_la_plataforma` —
  la restricción es sobre la externa, no sobre las cuentas de sistema en general.
- `test_system_accounts.py::test_por_http_devuelve_422`

**Verificación por mutación.** Quitando el guard de `transfer()`, tres tests caen y la API
responde **`201 Created`** a una transferencia que acuña dinero desde la cuenta externa.

### 6.2 Máquina de estados de comisiones

**Mecanismo.** `commissions/state_machine.py` define las transiciones permitidas:

```
PENDING ──approve──> EXECUTED   (terminal)
   └─────reject────> REJECTED   (terminal)
```

`ensure_can_transition()` lanza `InvalidTransition` (409) ante cualquier otra.

**`APPROVED` no existe como estado persistido**, y es deliberado: aprobar y ejecutar el split
ocurren en la misma transacción atómica. Una comisión nunca queda "aprobada, esperando que le
muevan el dinero" — ese estado intermedio sería una ventana donde el sistema ya se comprometió
con un pago que todavía no ocurrió.

Ambos estados finales son terminales. Una comisión ejecutada no se revierte cambiándole el
estado: se revierte con una comisión de signo contrario, igual que el ledger es append-only
por la misma razón.

**Tampoco existe estado `FAILED`.** Si el saldo no alcanza al aprobar, `InsufficientFunds`
sube sin capturarse, la transacción hace rollback y la comisión sigue `PENDING`, reintentable.
Un fallo ahí no cambia nada: literalmente no pasó nada.

**Propósito.** Previene pagar una comisión ya descartada, revertir un pago ya ejecutado
mediante un cambio de estado, y que exista dinero comprometido pero no movido.

**Evidencia.**
- `test_commissions.py::test_una_comision_rechazada_no_se_puede_aprobar`
- `test_commissions.py::test_una_comision_ejecutada_no_se_puede_rechazar`
- `test_commissions.py::test_saldo_insuficiente_por_http_devuelve_409_y_deja_pendiente`
- `test_split.py::test_reintento_despues_de_un_approve_fallido_si_ejecuta` — la idempotencia
  protege éxitos, no fracasos.

### 6.3 Snapshot del acuerdo

**Mecanismo.** Al reportar, los bps y el `listing_broker_account_id` se **copian** del listing
a la fila de la comisión. `approve_commission` nunca lee el listing.

**Propósito.** Previene que una edición administrativa del acuerdo mueva dinero de una
comisión ya reportada bajo otras condiciones. La comisión se liquida con los porcentajes
pactados **cuando se reportó**.

Efecto lateral útil: aprobar es determinista y no depende del módulo `listings`.

**Evidencia.** `test_commissions.py::test_el_acuerdo_se_congela_al_reportar` — edita el
listing entre reporte y aprobación, y verifica que se liquida con el acuerdo viejo.

---

## Resumen de verificaciones por mutación

Un test que pasa no prueba nada si también pasaría con la defensa removida. Cada guard se
verificó quitándolo y observando qué se cae.

| defensa removida | resultado observado |
|---|---|
| `SELECT ... FOR UPDATE` en `apply_delta` (§2.2) | 5 de 6 tests de concurrencia fallan; dinero destruido (`480000 == 500000`). El de doble gasto falla de forma **no determinista**: `PASSED, FAILED, FAILED` en tres corridas |
| `FOR UPDATE` sobre la fila de comisión (§3.2) | **5 de 10 aprobaciones ejecutan el split**; se detiene por bancarrota, no por corrección |
| `require_settleable_account` en `transfer()` (§6.1) | 3 tests caen; la API responde `201 Created` a una transferencia que acuña dinero |
| `require_settleable_account` en `deposit()` (§6.1) | cae el test que exige `restricted_account` |
| revalidación de `listing_broker` en `report_commission` (§6.1) | cae `test_report_commission_revalida_el_listing_broker` |
| contrato de idempotencia en `reject` (§3.1) | caen 2 tests (header exigido, 409 ante payload distinto) |
| FK parcial, con una fila preexistente mala (§1.3) | `alembic upgrade head` termina con **exit code 1** y `ForeignKeyViolation` |

---

## Cómo verificar

```bash
docker compose up --build          # las migraciones se aplican al arrancar
docker compose exec api pytest     # 165 tests contra PostgreSQL real
docker compose exec api python -O -m pytest   # con assertions desactivadas
curl http://localhost:8000/ledger/reconciliation
```
