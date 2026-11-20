# 03 · Funcional del MVP

Fuente: propuesta §7 (Necesidades), §8 (HU), §9 (CU). Aquí está condensado lo que el MVP implementa.

## Actores del MVP

| Actor | Rol de realm | Qué hace en el MVP |
|---|---|---|
| Gestor de Estrategias | `GESTOR_ESTRATEGIAS` | Crea/edita estrategias de **sus** entidades, vincula estudiantes |
| Tutor Líder | `TUTOR_LIDER` | Programa el plan mensual y registra el seguimiento semanal (también sin señal) a **sus** tutores docentes |
| Tutor Docente | `TUTOR_DOCENTE` | Solo en stretch (confirma el acompañamiento) |
| Administrador Funcional | `ADMIN_FUNCIONAL` | Sin UI en el MVP; existe para el seed |

Glosario: el **Tutor Docente** es quien da la clase; el **Tutor Líder** acompaña pedagógicamente a varios tutores docentes. Una **entidad** ejecuta estrategias. Las asignaciones Tutor Líder–Tutor Docente–Estrategia vienen precargadas (`acompanamiento.asignacion`).

## Necesidades que cubre

- **N1** — Evaluar si reemplazar las hojas de cálculo por un sistema que administre estrategias y estudiantes con las reglas del programa (en especial, que una estrategia no cambie una vez tiene estudiantes).
- **N2** — Evaluar si el acompañamiento pedagógico (plan mensual + seguimiento semanal, individual o grupal) funciona en un sistema único **con conectividad limitada**, sin perder ni duplicar trabajo.
- **N4** — Que cada participante entre desde cualquier región, vea solo lo de su rol, que los datos de menores estén protegidos y que el sistema aguante millones de registros.

---

## HU_002 / CU_002 — Ingresar según el rol

**Flujo principal**
1. Abre el portal y pulsa **'Ingresar'** → redirección a Keycloak (Authorization Code + PKCE S256).
2. Escribe correo y contraseña, pulsa **'Continuar'** → Keycloak verifica y pide segundo factor.
3. Digita el código TOTP de 6 dígitos → Keycloak emite tokens; la API registra `LOGIN` en bitácora.
4. Ve la pantalla de inicio: menú solo con las opciones de su rol; arriba **nombre, rol y fecha/hora del último ingreso**.

Menús:
- Gestor: **'Estrategias'**.
- Tutor Líder: **'Acompañamientos'**, **'Pilotaje'** (deshabilitado, "Próximo sprint"), **'Ayuda'** (lleva a 'Mis casos', D31).
- Tutor Docente (stretch): **'Mi acompañamiento'**.

Mensaje de confianza en el inicio (HU_002): cada consulta o cambio queda registrado a su nombre.

## HU_011 / CU_013 — Reportar un inconveniente (Línea B, adelanto del Sprint 4, D31)

1. Botón **'Ayuda'** en el encabezado de **cualquier pantalla** y para cualquier rol.
2. Elige el tipo de inconveniente (Bloqueante / Funcional / Consulta), describe lo que pasó y pulsa **'Enviar'**.
   El aplicativo adjunta por su cuenta la pantalla, el navegador y el identificador de correlación (`traceparent`).
3. Ve en pantalla su **número de caso** `INC-AAAA-NNNNNN` (severidad inicial Alta/Media/Baja según el tipo, estado 'Abierto').
4. En **'Mis casos'** ve sus casos con estado ('Abierto', 'En atención', 'Resuelto', 'Cerrado') y las horas de atención.

Fuera del MVP: notificación por correo al Coordinador del Pilotaje, panel de soporte y alertas de monitoreo (RQ_021).

## HU_003 / CU_003 — Crear estrategia

1. Menú **'Estrategias'** → **'Nueva estrategia'**. El sistema lista solo las entidades activas que el gestor administra.
2. Diligencia **entidad, nombre (máx. 150), objetivo (máx. 2.000), población, fecha inicio, fecha fin**. Validaciones: fin > inicio y dentro de la vigencia del programa; nombre único por entidad (sin distinguir mayúsculas); entidad activa.
3. **'Guardar'** → estrategia en estado **'Editable'**, evento en bitácora.
4. Ve la **ficha de la estrategia**: estado, entidad, contador de estudiantes vinculados = 0.

## HU_003 / CU_004 — Editar estrategia sin estudiantes vinculados

1. Desde el listado abre la estrategia y pulsa **'Editar'**. El sistema cuenta vinculados; si es 0, habilita el formulario con la versión vigente (ETag).
2. Ajusta nombre, objetivo, población o fechas (mismas validaciones).
3. **'Guardar cambios'** → en la misma transacción re-verifica 0 vinculados y versión sin cambios; actualiza e incrementa versión; bitácora con valores antes/después.
4. Ve la ficha actualizada.

Si tiene vinculados: la ficha muestra **'Bloqueada para edición'**, campos deshabilitados, botón 'Editar' oculto/deshabilitado. Si otro gestor vinculó mientras se editaba: el guardado se rechaza con el mismo aviso (409 `ESTRATEGIA_BLOQUEADA`). Si cambió la versión: 412, "La estrategia fue modificada por otra persona, recarga".

## HU_004 / CU_005 — Asociar estudiantes (flujo principal)

1. Abre la estrategia → **'Asociar estudiantes'**. Ve el buscador y la lista de ya vinculados.
2. Escribe **tipo y número de documento** → **'Buscar'**. La API calcula la huella HMAC, localiza al estudiante y muestra **nombre, sede educativa y municipio** (nada más).
3. Marca uno o varios → **'Vincular'**. Inserción en una transacción, descarta duplicados, si es el primer vínculo la estrategia pasa a 'Bloqueada para edición'; bitácora.
4. Revisa la pestaña **'Estudiantes vinculados'** (lista paginada, contador actualizado, sin duplicados).

Tipos de documento: `RC` (registro civil), `TI` (tarjeta de identidad), `CC`, `CE`, `PPT`, `NUIP`.
'Cargar listado' (masivo) aparece deshabilitado con "Próximo sprint".

## HU_005 / CU_006 — Programar acompañamientos del mes

1. **'Acompañamientos'** → **'Plan mensual'** → elige el mes. Ve sus tutores docentes **agrupados por estrategia**.
2. Elige modalidad **Individual** (un plan por docente) o **Grupal** (un plan con varios docentes de la misma estrategia, máx. 30); marca docentes; escribe **temas**; selecciona **semanas del mes** (1..5, ISO 8601).
3. **'Programar'** → valida que los docentes estén asignados al tutor en esa estrategia y que no exista ya un plan del mismo mes para ese docente (409). Crea el plan y **un hito por semana en estado 'Programada'**. El plan se guarda también en el dispositivo (IndexedDB).
4. Ve el **calendario del mes** con las semanas programadas y **cumplimiento 0 %**.

## HU_006 / CU_007 — Registrar seguimiento semanal, con o sin señal

**Con conexión**
1. En 'Plan mensual' selecciona la semana → **'Registrar seguimiento'**. Recibe el hito con sus docentes y su versión.
2. Marca **asistencia por docente**, describe **actividades** (máx. 4.000) y **avances**, adjunta **hasta 5 fotos** (se reducen en el navegador a 1.280 px lado mayor, calidad 0,7, JPEG/WebP ≤ 1 MB).
3. **'Guardar'** → la API comprueba versión (412 si cambió), registra, marca la semana **'Registrada'**, recalcula cumplimiento; bitácora.
4. La semana aparece **en verde 'Registrada'** y sube el **porcentaje de cumplimiento del mes**.

**Sin conexión (alterno, desde el paso 2)**
2. El aviso **'Sin conexión: tus registros se guardarán en este dispositivo'** aparece; el formulario usa el plan guardado localmente.
3. **'Guardar'** → cifra y guarda en IndexedDB con clave de idempotencia; estado **'Pendiente'**.
4. Al recuperar la señal, la sincronización envía los pendientes en orden → **'Sincronizado'**. Si la versión del hito cambió en el servidor: **'En conflicto'**, se muestran ambas versiones y el tutor decide.

**Reabrir la app sin señal (D39)**
- Si el dispositivo ya ingresó antes y no se pulsó 'Salir', la app abre sola en modo sin conexión con el último plan guardado; al volver la señal renueva la sesión en silencio y sincroniza.
- Si el inicio público se abre sin señal: con ingreso previo ofrece **'Continuar sin conexión como {nombre}'**; sin ingreso previo explica **'Necesitas señal para el primer ingreso en este dispositivo'** y deshabilita 'Ingresar'.

## D40 / D41 — "Mi desempeño" del Tutor Líder e informe mensual

Pestaña de 'Acompañamientos' (**'Plan mensual' | 'Mi desempeño'**; HU_002 fija los ítems del menú):
1. Indicadores: cumplimiento del mes actual ('Sin plan' si aún no programa), registros hechos **sin señal** en 6 meses, % **confirmado por los docentes**, % **registro a tiempo** (≤ 2 días tras la semana, D24 con fecha de captura).
2. Gráfico de los últimos 6 meses: semanas registradas en línea / sin conexión (barras apiladas) y cumplimiento (línea).
3. **'Semanas por registrar'** (vencidas sin seguimiento) con acceso a 'Registrar seguimiento', y tabla 'Detalle por mes'.
4. **'Descargar reporte del mes'**: PDF del acompañamiento del mes elegido con código de verificación y huella SHA-256; el código se valida en `/verificar` igual que un reporte de ley.
- Sin señal muestra la última copia guardada; generar el informe requiere conexión.

---

## Estados

| Objeto | Estados | Transiciones |
|---|---|---|
| Estrategia | `EDITABLE` → `BLOQUEADA` | Primer vínculo. No hay vuelta atrás en el MVP. |
| Hito semanal | `PROGRAMADA` → `REGISTRADA` (→ `CONFIRMADO` / `OBSERVADO` en stretch) | Seguimiento guardado |
| Registro local (front) | `Pendiente` → `Sincronizado` \| `En conflicto` → `Sincronizado` | Sync / resolución |

## Textos de UI obligatorios (copiar literal)

`'Ingresar'`, `'Continuar'`, `'Estrategias'`, `'Nueva estrategia'`, `'Guardar'`, `'Editable'`, `'Editar'`,
`'Guardar cambios'`, `'Bloqueada para edición'`, `'Asociar estudiantes'`, `'Buscar'`, `'Vincular'`,
`'Estudiantes vinculados'`, `'Cargar listado'`, `'Acompañamientos'`, `'Plan mensual'`, `'Programar'`,
`'Registrar seguimiento'`, `'Registrada'`, `'Programada'`, `'Sin conexión: tus registros se guardarán en este dispositivo'`,
`'Pendiente'`, `'Sincronizado'`, `'En conflicto'`, `'Pilotaje'`, `'Ayuda'`, `'Enviar'`, `'Mis casos'`, `'Mi desempeño'`, `'Descargar reporte del mes'`.

## Pantallas del MVP

1. Inicio público (marca Sinapsis Andina / SSES, botón 'Ingresar').
2. Shell autenticado: menú lateral por rol (en móvil, barra inferior o drawer), encabezado con nombre/rol/último ingreso, indicador de conexión y de pendientes por sincronizar.
3. Estrategias: listado (filtro por entidad y estado, paginación por llave de 50) → ficha (tabs 'Datos' / 'Estudiantes vinculados') → formulario crear/editar → modal/página 'Asociar estudiantes'.
4. Acompañamientos → Plan mensual: selector de mes, docentes agrupados por estrategia, formulario de programación, calendario del mes con barra de cumplimiento.
5. Registrar seguimiento: formulario móvil-first (checklist de asistencia, textareas, cámara/galería), estado de sincronización por registro.
4b. Acompañamientos → Mi desempeño: indicadores, gráfico de 6 meses, semanas por registrar, detalle por mes y 'Descargar reporte del mes' (D40, D41).
6. Panel de conflictos: comparación lado a lado ("En este dispositivo" vs "En el servidor"), botones "Conservar el mío" / "Conservar el del servidor".
