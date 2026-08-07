# Property Broker — Liquidación de comisiones entre brokers

# Para entrar visitar el siguiente link: https://property-broker-production.up.railway.app/

Una red de brokers inmobiliarios que reparten comisiones compartidas. Cuando se
vende un inmueble, la comisión se divide entre el broker que lo captó, el que
trajo al cliente y la plataforma. 
Lo mas importante en lo que me enfoque: **el sistema no puede perder ni crear ni un
peso**

```bash
cp backend/.env.example backend/.env
docker compose up --build
docker compose exec api python -m app.seed    # datos de demostración
```

| | |
|---|---|
| Aplicación | http://localhost:3000 |
| API + docs | http://localhost:8000 · http://localhost:8000/docs |
| Adminer (explorar la base) | http://localhost:8080 — servidor `postgres`, usuario/clave `broker` |
| Postgres | `localhost:5432` · tests en `localhost:5433` |

```bash
docker compose exec api pytest        # 171 tests
```

---

# Por qué elegí este stack

**Python + FastAPI + SQLAlchemy + PostgreSQL** en el backend, **Next.js + Tailwind**
en el frontend, todo en Docker Compose.

## Por qué elegí este stack

Python + FastAPI + SQLAlchemy + PostgreSQL en el backend, Next.js + Tailwind en el front, todo en Docker Compose.


**Postgres** lo agarré por practicidad, es lo que mejor conozco para levantar rápido. Y terminó siendo la elección correcta: casi toda la integridad que documento abajo se apoya en la base —`SELECT ... FOR UPDATE`, constraints, triggers, no en el código.

**FastAPI** un backend rápido de escribir. Que además me deja usar la validación de Pydantic.

**Next** porque ya lo conocía. Lo que sí decidí con intención fue el App Router para que todo el fetch salga del servidor: sin CORS, backend intacto, y una API key futura vive server-side.

**Docker Compose** para que quien reciba esto corra un comando y tenga todo.

**SQLAlchemy síncrono, no async.**

Lo que dejé fuera: Redis y colas. El bus de eventos es in-process detrás de una interfaz en `core/events.py` — sobra para esta carga, pero queda listo para sacarlo a una cola sin tocar el dominio.

**Lo que decidí NO usar: Redis y colas.** El bus de eventos es in-process, detrás de
una interfaz en `core/events.py`. Agregar Redis para un sistema con esta carga
habría sido sobre ingenieria.
---

# Decisiones clave

## 1. El saldo es la restricción, no un número que sigue al split

Podría haber modelado la comisión como plata que "aparece" al aprobarse. Elegí lo
contrario: **el broker que reporta ya tiene la comisión bruta en su cuenta, y al
aprobarse paga desde su propio saldo** a la plataforma y al otro broker.

Es más incómodo hay que registrar el ingreso antes pero es donde el doble gasto
se vuelve demostrable: si dos aprobaciones concurrentes pudieran ejecutarse, se
pagaría dos veces desde un saldo que solo alcanza para una. 

## 2. Defensas apiladas, no una sola

Cada capa cubre un modo de falla que las otras no ven:

1. **`CHECK (balance >= 0)`** en la tabla — última línea. Aunque toda mi lógica
   falle, Postgres rechaza físicamente el saldo negativo.
2. **Atomicidad** — el split entero (débito, créditos y anotaciones) en UNA
   transacción. Falla algo, no queda una cuenta debitada y otra sin acreditar.
3. **`SELECT ... FOR UPDATE`** sobre la cuenta origen. Pesimista y no optimista:
   en dinero la contención real es baja, pero el costo de equivocarse es máximo.
4. **Idempotencia** con `Idempotency-Key`, guardando la clave **antes** de mover
   un peso.


## 3. Verifiqué las defensas quitándolas

Un test que pasa no prueba nada si también pasaría con el sistema roto. Cada
defensa la probé sacándola a propósito:

- Sin `FOR UPDATE`: **5 de 6** tests de concurrencia fallan, con firmas de dinero
  destruido (`assert 480000 == 500000`). Y el de doble gasto falla de forma **no
  determinista** — `PASSED, FAILED, FAILED` en tres corridas. Eso es exactamente
  cómo se ve un bug de concurrencia en producción: pasa una de cada tres veces y te
  deja creer que está bien.
- Sin el lock de fila de la comisión: **5 de 10 aprobaciones simultáneas ejecutaron
  el mismo split**, y el sistema se detuvo por bancarrota, no por corrección.
- Sin el guard de la cuenta externa: la API responde `201 Created` a una
  transferencia que **acuña dinero**.

## 4. Ledger append-only, en partida doble

`ledger_entries` no admite `UPDATE` ni `DELETE` — hay un trigger que lo impide
incluso desde la base. Poder editar una anotación es poder reescribir la historia
del dinero. Corregir se hace con una anotación de reversión, como en contabilidad
real.

Cada movimiento son N filas que suman cero, así que `SUM(amount) = 0` sobre toda la
tabla significa que el sistema no creó ni destruyó un peso.

## 5. El invariante contable NO alcanza — y esto es lo que más me enseñó el reto

`SUM = 0` es la afirmación más fuerte del sistema y **no detecta una fuga real**.

Si alguien usa la cuenta externa —la única sin `CHECK (>= 0)`, porque representa el
dinero que entró de afuera— como contraparte de una transferencia normal, las dos
patas se compensan igual: el invariante sigue dando cero mientras el sistema acuña
plata. Lo demostré: se fueron 400.000 con `SUM(ledger) = 0` y la reconciliación
diciendo `is_balanced: true`.

La respuesta fueron dos capas más: guards en la aplicación, y una **FK parcial vía
columna generada** en la base. Elegí FK y no trigger por una razón concreta: al
crear la constraint, Postgres valida la tabla entera, así que una fila preexistente
que la viole **hace fallar la migración** en vez de quedar viva en silencio. Un
trigger solo cubre escrituras futuras.

## 6. Dinero en enteros, y el residuo por construcción

Todo en centavos, `BIGINT`, nunca float. Los porcentajes en **basis points enteros**
(10.000 bps = 100%).

Cuando la división no da exacta, **la parte de la plataforma no se calcula: es lo que
sobra**.

```python
listing_share  = gross * listing_bps // 10000
selling_share  = gross * selling_bps // 10000
platform_share = gross - listing_share - selling_share
```

Por eso la suma cierra siempre. 10.001 en tercios da 3.333,33 + 3.333,33 + 3.334,34.

## 7. Aprobar es mover la plata

No existe un estado `APPROVED` persistido. `POST /approve` valida, mueve saldos,
anota en el libro y deja `EXECUTED`, todo en la misma transacción. Una comisión
nunca queda "aprobada esperando el pago" — ese estado intermedio es la ventana por
donde se pierde dinero cuando algo se cae.


## 9. SQLAlchemy síncrono

Async es lo "moderno", pero todo el modelo de integridad descansa en `FOR UPDATE` y
en fronteras transaccionales explícitas. El código síncrono las hace obvias al
leerlas, y permite que los tests de concurrencia usen threads reales con conexiones
reales. 

---

# Supuestos que hice

**El backend no tiene autenticación, y el frontend simula la sesión.** Asumí que
auth es un dominio aparte, resuelto y no interesante para lo que se está evaluando.
El selector de identidad de la barra superior escribe una cookie; no es un login.
Está aislado en una función (`getActiveBroker`), así que reemplazarlo por auth real
es cambiar su cuerpo y nada más.

**Una cuenta es un broker.** No hay entidad "persona": `accounts` tiene id, nombre,
tipo, saldo. Sin email, sin teléfono, sin rating. Asumí que el reto pedía un motor
de liquidación, no un directorio.

**`listings` no es un MLS.** Es el portador del acuerdo de reparto: dirección y tres
porcentajes. Sin búsqueda, sin fotos, sin publicación. Las imágenes de las tarjetas
son decorativas y la interfaz lo dice.

**El acuerdo se congela al reportar.** Si alguien edita los porcentajes de un
inmueble entre el reporte y la aprobación, la comisión se liquida con lo pactado
**cuando se reportó**. Asumí que un cambio administrativo no puede mover plata ya
reportada.

**El saldo de un broker es privado.** Cuánto tiene en su cuenta es asunto suyo; lo
que sí es compartido son los montos de un negocio en el que ambos participan. Ese
criterio lo apliqué después de construir varias pantallas, y me obligó a corregir
una que ya estaba hecha.

**COP sin centavos en la realidad, pero centavos en el sistema.** Trabajo en la
unidad mínima igual, porque es lo único que deja demostrar que un reparto cuadra
exacto.

---

# Qué dejé fuera, y por qué

**Autenticación y autorización.** Es un dominio grande y resuelto. Meterlo habría
consumido tiempo que preferí gastar en concurrencia e integridad, que es lo que el
reto pedía demostrar.

**Redis, colas y workers.** Sin carga que lo justifique, es complejidad sin
beneficio. Dejé el bus de eventos detrás de una interfaz para poder extraerlo
después.

**Notificaciones, chat, matching, mapas, ratings.** Los mockups de diseño incluían
"Mensajes"; lo saqué del navegador. Preferí una cosa bien hecha a cinco a medias.

**Precio del inmueble, metros, habitaciones.** Los mockups los mostraban. No los
inventé: el modelo no los tiene, y llenar la interfaz con datos falsos me parecía
peor que mostrar menos.

**PITR y backups continuos.** Agregué snapshots con `pg_dump` y retención, que es lo
proporcional. El archivado continuo del WAL es una decisión de producción.

**Deshacer un movimiento confirmado.** La
forma correcta es una anotación de reversión.

---

# Qué haría distinto con más tiempo

**Desplegar en railway.** La aplcación esta hecha para correrse en forma local, pero la hubiera podido desplegar en railway para que las personas pudieran acceder facilmente a través de un simple link.

**Idempotencia en crear inmueble y broker.** Hoy solo las operaciones de dinero la
tienen, porque es lo que el backend soporta. Un doble click crea dos inmuebles; lo
frena que el botón se deshabilita, que es una defensa más débil.

**Índices pensados con datos reales.** Agregué uno compuesto para "mis comisiones" y
lo verifiqué con `EXPLAIN`, pero con tablas casi vacías. Con volumen real revisaría
los planes de nuevo.

**Tests del frontend.** El backend tiene 171; el frontend no tiene ninguno. Verifiqué
a mano y con `curl`, pero no es lo mismo.

---


# Qué NO sé

No sé cómo se manejaría un alto nivel de concurrencia de usuarios haciéndolo asíncrono — lo hice síncrono a propósito, pero no tengo claro cómo se vería la versión async bajo carga real. Aunque usé monolito modular, no tengo del todo claro cómo se escala esto a microservicios en la práctica. Y si esto fuera de verdad un core bancario en producción, hay una capa entera —cumplimiento, auditoría regulatoria, reconciliación con bancos reales— que no sé cómo se haría.

---

# Cómo usé IA

# Cómo usé IA

La herramienta principal fue Claude Code. La idea de la red inmobiliaria y el stack ya los tenía pensados; el código sí lo escribió Claude Code, pero lo desarrollé por etapas. Primero dejé listo el backend con sus tests, porque era lo más importante por el foco que le di: un sistema que no puede crear ni perder dinero.

Antes de arrancar el frontend usé Stitch AI para crear mockups a partir de una descripción de lo que quería que fuera el producto, y exporté esas vistas a HTML para que Claude Code se guiara al construir el front. Aprendí que conviene diseñar aparte: Claude Code es excelente para código, pero para diseño prefiero darle una referencia visual ya hecha.

Algunas decisiones las tenía claras desde el principio y se las pedí explícitamente: las cláusulas en la base de datos como capa de protección para no crear ni perder dinero, y la idempotencia y atomicidad — sabía que las necesitaba aunque no recordara todo el detalle técnico de cómo implementarlas.

Como fui por fases, al final de cada una verificaba que estuviera cumplida antes de avanzar. Varias cosas las corregí bajándole complejidad a lo que la IA proponía, para que no se fuera a sobre-ingeniería: no meter un login, definir que todos los depósitos entran desde una única cuenta externa, y que cuando actúo como un broker solo se vean sus movimientos y las comisiones que él ganó.
---

# Qué aprendí

Dos cosas principales.

La primera, sobre el flujo de trabajo: conviene diseñar los mockups aparte, aunque sea con otra IA. Claude Code me parece extremadamente bueno para código, pero no para diseño. Usé Stitch AI, pero se lograba igual con otros modelos — lo que importa es entrarle a Claude Code con la referencia visual ya resuelta.

La segunda, técnica: no me acordaba de cómo funcionaban las llaves de idempotencia. Entendía el concepto, pero no cómo se implementaba desde el lado técnico. Trabajar este reto me obligó a entender el mecanismo real —guardar la llave antes de mover plata, devolver el resultado guardado ante un reintento— y no solo la idea.

Sabía en teoría por qué un sistema de dinero necesita respaldos y redundancia para poder recuperar el estado si algo se cae, pero nunca los había montado en Postgres. En este reto los implementé con un backup con `pg_dump` que corre en intervalos y rota los archivos y verifiqué que al restaurar vuelven también las defensas —el trigger append-only, los `CHECK`, las constraints de la cuenta externa—, no solo los datos.
>

---

# Arquitectura

**Monorepo** con dos deployables, orquestados por un `docker-compose.yml` en la raíz.

```
├── docker-compose.yml
├── docs/INTEGRITY.md        # referencia técnica de todas las defensas
├── ops/backup.sh            # snapshots periódicos de la base
├── backend/
│   ├── alembic/             # migraciones
│   └── app/
│       ├── core/            # config, transacciones, idempotencia, eventos
│       ├── modules/
│       │   ├── accounts/    # brokers + saldos       (núcleo bancario)
│       │   ├── ledger/      # anotaciones inmutables (fuente de verdad)
│       │   ├── listings/    # inmueble + acuerdo de reparto
│       │   └── commissions/ # motor de split + máquina de estados
│       └── tests/           # 171
└── frontend/
    ├── app/                 # 7 pantallas + route handlers
    ├── components/
    └── lib/
```

**Monolito modular:** organizado por dominio de negocio, no por capa técnica. Cada
módulo es autocontenido (`router → service → repository → models → schemas`).

**Regla de fronteras:** un módulo nunca consulta las tablas de otro. `commissions`
no toca la tabla de `accounts` — llama a `accounts.service`. Es lo que permitiría
extraer un módulo a su propio servicio sin reescribir dominio.

**Composición de transacciones:** solo el caller más externo abre la transacción.
Los services reciben la sesión y nunca comitean. Por eso un split completo compone
tres módulos dentro de una sola unidad atómica.

## Cuentas de sistema

| cuenta | `CHECK (>= 0)` | rol |
|---|---|---|
| Plataforma | sí | recibe su % de cada comisión |
| Mundo exterior | **no** | contrapartida de todo ingreso desde afuera |

El saldo de la externa, cambiado de signo, es el dinero vivo dentro del sistema. Es
la única que puede ir en negativo, y por eso es la única que hay que proteger: solo
`deposit()` puede tocarla.

## El frontend

Siete pantallas sobre la API. Ni un cálculo de negocio en el cliente.

| ruta | qué es |
|---|---|
| `/` | La red desde mi lugar: lo mío primero, la actividad después |
| `/inmuebles` | Mercado — lo que puedo vender y cuánto me llevo |
| `/mis-propiedades` | Mi portafolio |
| `/comisiones` | Tablero de colaboraciones por estado |
| `/perfil` | Mi cuenta: saldo, transacciones y actividad con contexto |
| `/brokers` | La red — sin saldos ajenos |
| `/integridad` | Es una pantalla de contabilidad, en lenguaje de negocio pero la idea es que esta pantalla no exista, solo la agregue para validar funcionamiento de las transferencias en el front |

**El `Idempotency-Key` nace en el navegador** con `crypto.randomUUID()` en el
momento del click, y los route handlers de Next lo propagan **sin tocarlo**. Si el
servidor generara uno nuevo por llamada, cada reintento sería una operación distinta
para el backend. La clave identifica la intención del usuario, no la llamada HTTP.

**El ledger contado como negocio.** Un banco muestra `COMMISSION_SPLIT −8.000.000`.
Acá cada movimiento dice de qué inmueble vino, con qué broker y por qué rol tocaba
esa parte. Mismos datos, otro idioma.

---

# API

**Núcleo bancario**

| método | ruta | |
|---|---|---|
| `POST` | `/accounts` | crea un broker; nace en cero |
| `GET` | `/accounts` · `/accounts/{id}` · `/accounts/{id}/balance` | |
| `POST` | `/deposits` | **Idempotency-Key** |
| `POST` | `/transfers` | **Idempotency-Key** |
| `GET` | `/accounts/{id}/ledger` | historial de la cuenta |
| `GET` | `/ledger/movements/{id}` | las patas de un movimiento — revela la contraparte |
| `GET` | `/accounts/{id}/reconciliation` · `/ledger/reconciliation` | saldo vs. su propio historial |

**Motor de comisiones**

| método | ruta | |
|---|---|---|
| `POST` | `/listings` | acuerdo de reparto en bps |
| `GET` | `/listings` · `/listings/{id}` | |
| `POST` | `/commissions` | reporta → `PENDING`. **Idempotency-Key** |
| `POST` | `/commissions/{id}/approve` | aprueba **y ejecuta el split**. **Idempotency-Key** |
| `POST` | `/commissions/{id}/reject` | → `REJECTED`. **Idempotency-Key** |
| `GET` | `/commissions?status=&reported_by_account_id=` | filtros componibles |

Misma key + mismo payload → se repite la respuesta guardada. Misma key + otro
payload → `409`.

---

# Tests

```bash
docker compose exec api pytest              # 171
docker compose exec api python -O -m pytest # con assertions desactivadas
```

Corren contra **Postgres real**, en una base separada sobre tmpfs. No es una
preferencia: SQLite acepta `SELECT ... FOR UPDATE` y lo ignora, así que un test de
concurrencia contra SQLite **pasa siempre**, incluso con el locking roto. Sería un
falso verde justo sobre lo único que este sistema debe garantizar.

Los tests aplican las **migraciones de Alembic**, no `create_all`: el trigger
append-only y el sembrado de cuentas de sistema solo existen en la migración.

| archivo | qué cubre |
|---|---|
| `test_split.py` | aritmética del residuo, 84 combinaciones parametrizadas, rollback |
| `test_commissions.py` | máquina de estados, 10 aprobaciones concurrentes, snapshot del acuerdo |
| `test_concurrency.py` | doble gasto, lost update, deadlock, depósitos concurrentes |
| `test_idempotency.py` | insert-first, replay, conflicto, la clave no se quema al fallar |
| `test_integrity.py` | `CHECK` de saldo, append-only, `SUM = 0`, control positivo del reconciliador |
| `test_system_accounts.py` | la cuenta externa fuera de todo camino que mueva plata |
| `test_wallet.py` | el núcleo bancario como wallet genérico |

Todo test que mueve dinero cierra con `assert_system_is_balanced()`.

---

# Operación

**Snapshots de la base** (no arrancan por defecto):

```bash
docker compose --profile backup up -d       # pg_dump cada 15 min, conserva 12
docker compose exec -T postgres psql -U broker -d broker < backups/<archivo>.sql
```

Verifiqué que una restauración devuelve **los datos y también las defensas**:
trigger append-only, `CHECK` de saldo y las constraints de la cuenta externa siguen
activos después de restaurar.

**Resetear la demo:**

```bash
docker compose exec api python -m app.seed --reset
```

El seed siembra **solo por las rutas de servicio**, nunca con `INSERT` directo: un
insert se saltaría los guards y podría dejar un estado que la API jamás habría
permitido crear. Los saldos entran por `deposit`, así que cada peso sembrado tiene
su contrapartida y el sistema arranca cuadrado.
