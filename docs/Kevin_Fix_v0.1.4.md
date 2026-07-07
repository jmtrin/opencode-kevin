# Opencode-kevin — Fix v0.1.4

**Versión:** 0.1.4
**Fecha:** 2026-07-07
**Estado:** Borrador para implementación
**Dependencia:** `docs/Kevin_Plan.md`, `docs/Kevin_Task.md`, `CHANGELOG.md` (entrada 0.1.3)
**ID Convención:** `K-046`…`K-050` (continúa la numeración de `Kevin_Task.md`)
**Tipo:** Documento de fix — detección de fallos robusta independiente del evento v2

---

## 1. Resumen ejecutivo

El fix **v0.1.3** intentó corregir F#1 (detección de fallos → reflexión) cambiando la precedencia del hook `tool.execute.after` para escanear `output.output` cuando `metadata.success === true`. El supuesto empírico del autor fue: *"el bash tool de opencode devuelve `metadata.success === true` incluso cuando el subproceso wrapping termina con exit code ≠ 0"*. **Ese supuesto no se verificó contra el bash tool real de opencode** (los tests `plugin-tools.test.ts:236-297` usan mocks con `metadata:{success:true}`; el e2e `plugin-complete.test.ts:282` usa `metadata:{}` + `output:"command finished"` y depende del evento `session.next.tool.failed` para rescatar el caso).

La validación manual K-045 en `C:\Desarrollo\Misc\0-undefined` demostró que **F#1 sigue roto en producción**: tras un `tsc` con `error TS2304`, `kevin_status` reporta `memories: 0`. La investigación (sesión de diagnóstico) concluyó que el bash tool de opencode popula el texto del comando en `output.output` (string top-level, según el contrato SDK `@opencode-ai/plugin` `index.d.ts:249-258`) y `output.metadata` **no** contiene `success:false`, ni `exitCode` numérico, ni `stderr` con marcadores de error — es decir, `metadata` llega vacío o sin las claves esperadas.

Cuando `metadata = {}`, la heurística de v0.1.3 cae al `else` (`index.ts:291`) y devuelve `success = true` **sin escanear `output.output`** → el Reflector nunca se invoca → 0 memorias. La única red de seguridad restante es el evento `session.next.tool.failed`, que es **v2-only** en el tipado del SDK y, en producción, **no se emite para un bash exit-1** (un comando no-cero es una tool call *exitosa que devuelve contenido de error*, no un fallo de ejecución del tool).

**El fix v0.1.4 hace la heurística auto-suficiente**: escanea `output.output`/`stdout` con marcadores **fuertes** (no ambiguos) en TODOS los casos sin señal definitiva, independientemente de la forma de `metadata` y sin depender del evento v2. Esto cubre ambos escenarios empíricos posibles (`metadata:{success:true}` o `metadata:{}`) y mantiene el guard de falsos positivos F#28.

| Dimensión | Valor |
|---|---|
| Archivos modificados | 2 (`plugin/index.ts`, `plugin/Reflector.ts`) |
| Archivos de test modificados | 2 (`tests/unit/plugin-tools.test.ts`, `tests/e2e/plugin-complete.test.ts`) |
| Tareas | K-046…K-050 (5) |
| Riesgo | 🟡 medio (cambia detección de fallos; riesgo de falsos positivos mitigado por regex fuerte) |
| Breaking | No (la red de seguridad del evento se conserva; los tests existentes pasan sin cambio) |

**Criterio de salida**: tras `npm run typecheck` fallido en el proyecto K-045, `kevin_status` reporta `memories ≥ 1`, `kevin_query "typecheck"` retorna la lección `When bash fails with typecheck: …`, y en una sesión nueva `system.transform` la inyecta en `<kevin-context>` — todo sin intervención manual y sin depender de `session.next.tool.failed`.

---

## 2. Contexto — por qué v0.1.3 no fue suficiente

### 2.1 Contrato SDK del hook `tool.execute.after`

`@opencode-ai/plugin` (`dist/index.d.ts:249-258`) define:

```typescript
"tool.execute.after"?: (input: {
    tool; sessionID; callID; args
}, output: {
    title: string;
    output: string;     // el texto del comando va AQUÍ (top-level)
    metadata: any;       // shape dependiente de cada tool; NO garantiza claves
}) => Promise<void>;
```

El nivel superior de `output` **solo** tiene `title`, `output` (string) y `metadata` (any). **No existen** `output.success`, `output.stderr`, `output.stdout`, `output.exitCode` en el nivel superior. La heurística debe leer todo desde `output.metadata` (claves no garantizadas) y/o desde `output.output` (el texto del comando, siempre presente).

### 2.2 Lo que hace v0.1.3 hoy (`plugin/index.ts:271-293`)

```typescript
"tool.execute.after": async (hookInput, output) => {
    const meta = (output.metadata ?? {}) as Record<string, unknown>;
    const outputText = String(output.output ?? "");
    const stderr = String(meta.stderr ?? "");
    const stdout = String(meta.stdout ?? outputText);
    const exitCode = typeof meta.exitCode === "number" ? meta.exitCode : undefined;
    let success: boolean;
    if (meta.success === false) {
        success = false;
    } else if (exitCode !== undefined) {
        success = exitCode === 0;
    } else if (meta.success === true) {          // ← SOLO aquí escanea output.output
        const stream = stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : outputText;
        success = !(stream.length > 0 && ERROR_LINE_RE.test(stream));
    } else {
        success = true;                           // ← metadata vacía: NO escanea
    }
    // … observer.onAfter + if(!success) → reflector.invoke
}
```

### 2.3 El gap

| `metadata` real del bash tool | Rama ejecutada | ¿Escanea `output.output`? | ¿Reflector se invoca? |
|---|---|---|---|
| `{success:false}` | rama 1 | — | ✅ sí (definitivo) |
| `{exitCode:2}` | rama 2 | — | ✅ sí (exitCode≠0) |
| `{success:true}` + error en output | rama 3 | ✅ sí (ERROR_LINE_RE amplio) | ✅ sí |
| `{success:true}` sin error | rama 3 | ✅ sí (no match) | ❌ no (correcto) |
| **`{}` (vacío)** + error en output | **`else`** | **❌ NO** | **❌ no (BUG)** |
| **`{}` (vacío)** sin error | **`else`** | ❌ no | ❌ no (correcto) |

Las dos filas marcadas son el bug. La validación K-045 cayó en la fila 5 (`metadata` vacío + `error TS2304` en `output.output`) → 0 memorias.

### 2.4 Por qué la red de seguridad del evento no rescata en producción

El e2e `plugin-complete.test.ts:282-330` prueba exactamente la fila 5 **simulando manualmente** el evento `session.next.tool.failed` con `error.message` conteniendo el TS error. Ese test pasa **porque el test emite el evento a mano**. En producción:

1. El evento `session.next.tool.failed` pertenece al **contrato v2** del SDK (`sdk/dist/v2/gen/types.gen.d.ts:898, 3812`). El hook `event` del plugin está tipado con `Event` **v1** (`sdk/dist/gen/types.gen.d.ts:602`), cuya unión **no incluye** `session.next.tool.*`. (Nota: el código ya hace acceso sin tipar — `index.ts:357-359` usa `(event as {type?:string})` — así que el tipado v1 NO bloquea la recepción en runtime; el bloqueo real es el punto 2.)
2. **Opencode no clasifica un bash exit-1 como fallo de tool**: el tool se ejecutó correctamente y devolvió un resultado (con contenido de error). `session.next.tool.failed` se reserva para fallos de *ejecución* del tool (permiso denegado, tool lanza excepción, timeout del tool). Un subproceso no-cero **no** dispara este evento.

⇒ En producción la fila 5 no es rescatada por el evento ⇒ la heurística debe ser auto-suficiente.

### 2.5 El supuesto no verificado de v0.1.3

El `CHANGELOG.md` (entrada 0.1.3) afirma: *"opencode's bash tool returns `metadata.success === true` even when the executed process exits non-zero"*. Ningún test lo verifica contra el bash tool real; todos usan mocks. La evidencia de K-045 (0 memorias) es consistente con `metadata = {}` (vacío), **no** con `metadata = {success:true}` (que habría disparado la rama 3 y persistido la lección). El fix v0.1.4 es **robusto a ambas formas** para no depender de verificar cuál es la real — pero incluye un paso de diagnóstico empírico (§7) para confirmarlo y, si se confirma `metadata:{success:true}`, documentarlo.

---

## 3. Diseño del fix

### 3.1 Principios

1. **Auto-suficiencia**: la heurística de `tool.execute.after` debe detectar el fallo por sí sola, sin depender del evento v2.
2. **Robustez empírica**: debe funcionar tanto si `metadata = {}` como si `metadata = {success:true}` o `{exitCode:N}`.
3. **Sin falsos positivos en stdout**: el output de un comando exitoso puede mencionar "error"/"panic"/"fail" en prosa (caso F#28, `plugin-complete.test.ts:380`). Escanear stdout con el regex *amplio* `ERROR_LINE_RE` rompería F#28. ⇒ stdout se escanea con un regex **fuerte** (marcadores no ambiguos).
4. **stderr es señal fuerte**: el contenido de stderr rara vez aparece en comandos exitosos. stderr se escanea con el regex amplio `ERROR_LINE_RE` (como en v0.1.1 F#28).
5. **Conservar la red de seguridad del evento**: `handleToolFailed` (vía `session.next.tool.failed`) se mantiene para fallos de *ejecución* reales del tool (no para bash exit-1). No se elimina.
6. **Minimalidad**: 2 archivos fuente cambiados, sin migración de DB, sin cambios de esquema.

### 3.2 Nueva precedencia de detección

```
1. metadata.success === false                         → FAIL (definitivo)
2. exitCode (numérico, claves alternas) !== undefined  → exitCode === 0 ? OK : FAIL
3. stderr no vacío + ERROR_LINE_RE (amplio)            → FAIL
4. stream(stdout|output.output) + STRONG_ERROR_RE      → FAIL si match, else OK
   (cubre metadata={success:true} Y metadata={} )
```

La rama 4 reemplaza tanto la rama 3 (`meta.success===true`) como el `else` de v0.1.3. Ya no se bifurca sobre `meta.success` para decidir si escanear: **siempre** se escanea stdout con marcadores fuertes cuando no hay señal definitiva.

### 3.3 Regex fuerte vs amplio

**`ERROR_LINE_RE` (amplio, existente en `Reflector.ts:30-31`)** — se mantiene, se usa **solo para stderr**:
```typescript
/\b(error|failed|fail|cannot find|cannot resolve|TS\d{4,}|exception|traceback|panic|fatal|referenceerror|typeerror|syntaxerror|command failed|non-zero exit)\b/i
```

**`STRONG_ERROR_RE` (NUEVO, para stdout/output.output)** — marcadores no ambiguos que no aparecen en prosa de éxito:
```typescript
/\b(cannot find|cannot resolve|TS\d{4,}|error TS\d|command failed|non-zero exit|exit code [1-9]\d*|traceback|referenceerror|typeerror|syntaxerror|fatal error|exception|failed to compile|build failed|compilation failed)\b/i
```

Diferencias clave vs `ERROR_LINE_RE`:
- **Eliminados** (ambiguos en prosa): `error`, `fail`, `failed`, `panic`, `fatal` (la palabra suelta).
- **Mantienen/Especializados**: `fatal error` (con "error"), `error TS\d` (tsc), `exit code [1-9]` (exit numérico en texto), `build failed` / `failed to compile` / `compilation failed` (errores de build explícitos).

Verificación contra los tests existentes:

| Test | `metadata` | `output.output` | ¿Match `STRONG_ERROR_RE`? | `success` esperado | ¿Test pasa? |
|---|---|---|---|---|---|
| `plugin-tools:237` "0 errors" | `{success:true}` | `"0 errors"` | ❌ ("error" suelto no está en fuerte) | true → 0 mem | ✅ |
| `plugin-tools:252` bash+tsc | `{success:true}` | `"...error TS2304: Cannot find name 'foo'."` | ✅ (`TS2304`, `cannot find`) | false → ≥1 mem | ✅ |
| `plugin-tools:284` exitCode=2 | `{success:true,exitCode:2}` | `"ok"` | — (rama 2) | false → ≥1 mem | ✅ |
| `plugin-complete:380` F#28 | `{}` | `"Build succeeded. Note: avoid panic in error paths."` | ❌ ("panic" no está en fuerte; "build failed" no matchea "Build succeeded") | true → 0 mem | ✅ |
| `plugin-complete:282` event-fail | `{}` | `"command finished"` | ❌ | true → 0 mem (rescatado por evento) | ✅ |
| **NUEVO** K-048 regresión | `{}` | `"...error TS2304: Cannot find name 'foo'."` | ✅ | false → ≥1 mem | ✅ (nuevo) |

La última fila es el caso de producción de K-045 que v0.1.3 no cubre y v0.1.4 sí.

> **Trade-off documentado**: `STRONG_ERROR_RE` no detecta un `panic` suelto de Go (se excluyó para no romper F#28). Un panic real de Go imprime `panic:` o `panic: ...` — si se desea detectarlo, añadir `panic:` con boundaries cuidadosos (el `:` rompe `\b` final; usar `(?<![A-Za-z])panic:`). Se deja como afinamiento opcional; el núcleo del fix (tsc/build/runtime JS) queda cubierto.

### 3.4 Claves alternas de exit code

El bash tool podría nombrar el exit code distinto en `metadata`. Para robustez defensiva, `pickExitCode(meta)` revisa `exitCode`, `exit_code`, `exit` (en ese orden) y retorna el primer valor **numérico**. No se incluyen `code`/`status` (pueden ser HTTP status legítimos o strings). Esto es **especulativo** — el afianzamiento primario es la rama 4 (scan fuerte de stdout), que no depende de exit code.

---

## 4. Implementación — cambios por archivo

### 4.1 `plugin/Reflector.ts`

**Añadir** la constante `STRONG_ERROR_RE` exportada, junto a `ERROR_LINE_RE` (línea 30-31):

```typescript
export const ERROR_LINE_RE =
    /\b(error|failed|fail|cannot find|cannot resolve|TS\d{4,}|exception|traceback|panic|fatal|referenceerror|typeerror|syntaxerror|command failed|non-zero exit)\b/i;

export const STRONG_ERROR_RE =
    /\b(cannot find|cannot resolve|TS\d{4,}|error TS\d|command failed|non-zero exit|exit code [1-9]\d*|traceback|referenceerror|typeerror|syntaxerror|fatal error|exception|failed to compile|build failed|compilation failed)\b/i;
```

Sin otros cambios en `Reflector.ts`. `ERROR_LINE_RE` se conserva tal cual (lo usa `extractFirstErrorLine` en `Reflector.ts:145-158` sobre el `sourceOutput`, que ya es stderr-o-stdout del fallo confirmado — ahí el regex amplio es correcto porque solo se llega tras confirmar `success=false`).

### 4.2 `plugin/index.ts`

**Añadir import** de `STRONG_ERROR_RE` (línea 10):

```typescript
import { ERROR_LINE_RE, STRONG_ERROR_RE, Reflector } from "./Reflector.js";
```

**Añadir helper** `pickExitCode` (junto a `handleToolFailed`, ~línea 86):

```typescript
function pickExitCode(meta: Record<string, unknown>): number | undefined {
    for (const k of ["exitCode", "exit_code", "exit"]) {
        const v = meta[k];
        if (typeof v === "number") return v;
    }
    return undefined;
}
```

**Reemplazar** el bloque de cómputo de `success` en `tool.execute.after` (`index.ts:271-293`). Estado actual:

```typescript
"tool.execute.after": async (hookInput, output) => {
    const meta = (output.metadata ?? {}) as Record<string, unknown>;
    const outputText = String(output.output ?? "");
    const stderr = String(meta.stderr ?? "");
    const stdout = String(meta.stdout ?? outputText);
    const exitCode =
        typeof meta.exitCode === "number" ? meta.exitCode : undefined;
    let success: boolean;
    if (meta.success === false) {
        success = false;
    } else if (exitCode !== undefined) {
        success = exitCode === 0;
    } else if (meta.success === true) {
        const stream =
            stderr.length > 0
                ? stderr
                : stdout.length > 0
                    ? stdout
                    : outputText;
        success = !(stream.length > 0 && ERROR_LINE_RE.test(stream));
    } else {
        success = true;
    }
    // … (resto sin cambios: observer.onAfter + if(!success) reflector.invoke)
```

Estado propuesto:

```typescript
"tool.execute.after": async (hookInput, output) => {
    const meta = (output.metadata ?? {}) as Record<string, unknown>;
    const outputText = String(output.output ?? "");
    const stderr = String(meta.stderr ?? "");
    const stdout = String(meta.stdout ?? outputText);
    const exitCode = pickExitCode(meta);
    let success: boolean;
    if (meta.success === false) {
        success = false;
    } else if (exitCode !== undefined) {
        success = exitCode === 0;
    } else if (stderr.length > 0 && ERROR_LINE_RE.test(stderr)) {
        // stderr es señal fuerte de fallo → regex amplio OK (F#28 solo restringe stdout)
        success = false;
    } else {
        // Sin señal definitiva: escanear stdout/output.output con marcadores FUERTES.
        // Cubre metadata={} (bash tool real) y metadata={success:true} (caso v0.1.3).
        // STRONG_ERROR_RE evita falsos positivos en prosa de éxito (F#28: "panic"/"error").
        const stream = stdout.length > 0 ? stdout : outputText;
        success = !(stream.length > 0 && STRONG_ERROR_RE.test(stream));
    }
    observer.onAfter(
        {
            tool: hookInput.tool,
            args: hookInput.args as Record<string, unknown>,
            sessionId: hookInput.sessionID,
            callID: hookInput.callID,
        },
        { success, stdout, stderr, exitCode },
    );
    if (!success) {
        const errorType = observer.inferErrorType(stderr, stdout, exitCode);
        fireAndForget(
            reflector.invoke({
                toolName: hookInput.tool,
                argsSummary: observer.summarizeArgs(
                    hookInput.args as Record<string, unknown>,
                ),
                stderr,
                stdout,
                exitCode,
                errorType,
                sessionId: hookInput.sessionID,
            }),
        );
    }
},
```

**Notas**:
- La rama `meta.success === true` explícita **desaparece**: cae al `else` y se escanea con `STRONG_ERROR_RE`. Si el stream tiene un marcador fuerte → fail; si no → success (correcto: `meta.success:true` + output limpio = éxito).
- La rama 3 nueva (stderr + `ERROR_LINE_RE` amplio) es **adicional** vs v0.1.3 (que no escaneaba stderr en el `else`). Es segura: stderr con marcador de error es fallo. Y no rompe F#28 porque F#28 tiene `stderr=""`.
- `inferErrorType(stderr, stdout, exitCode)` (`ToolCallObserver.ts:117-138`) recibe `stdout = outputText` cuando `meta.stdout` ausente → ve `error TS2304` → retorna `"typecheck"` ✅. Sin cambios en `ToolCallObserver.ts`.
- El Reflector (`Reflector.ts:73-74`) hace `sourceOutput = stderr if non-empty else stdout` → con `stderr=""` usa `stdout=outputText` → `extractFirstErrorLine` encuentra la línea `error TS2304` → la lección es correcta. Sin cambios en el Reflector.

**Sin cambios** en: `tool.execute.before`, `chat.message`, `experimental.chat.system.transform`, `experimental.session.compacting`, `event` (la red de seguridad del evento se conserva intacta), `dispose`, ni en ninguna herramienta `kevin_*`.

---

## 5. Tareas (K-046…K-050)

### K-046 — Añadir `STRONG_ERROR_RE` en `Reflector.ts`

- **Prioridad:** P0
- **Estimación:** S (30m)
- **Dependencias:** —
- **Riesgo:** 🟢
- **Archivos:** `plugin/Reflector.ts`
- **Descripción:** Exportar la constante `STRONG_ERROR_RE` (§3.3) junto a `ERROR_LINE_RE` (línea 30-31). Sin tocar `extractFirstErrorLine` (sigue usando `ERROR_LINE_RE` sobre `sourceOutput` post-confirmación).
- **Criterios de aceptación:**
  - `STRONG_ERROR_RE` está exportada y coincide con la especificación de §3.3.
  - `npm run typecheck` pasa.
  - `npx vitest run tests/unit/reflector.test.ts` pasa (sin regresión).
- **Verificación:** `npm run typecheck && npx vitest run tests/unit/reflector.test.ts`

### K-047 — Heurística robusta en `index.ts` + `pickExitCode`

- **Prioridad:** P0
- **Estimación:** M (2h)
- **Dependencias:** K-046
- **Riesgo:** 🟡
- **Archivos:** `plugin/index.ts`
- **Descripción:** (1) Importar `STRONG_ERROR_RE`. (2) Añadir helper `pickExitCode` (§4.2). (3) Reemplazar el cómputo de `success` en `tool.execute.after` (líneas 271-293) por la nueva precedencia de §3.2/§4.2. Conservar `observer.onAfter` e `if(!success) reflector.invoke` sin cambios.
- **Criterios de aceptación:**
  - `npm run typecheck` pasa.
  - Todos los tests existentes pasan sin modificación (`npm test`).
  - La rama `else` ahora escanea `stdout`/`output.output` con `STRONG_ERROR_RE`.
- **Verificación:** `npm run typecheck && npm run lint && npm test`

### K-048 — Tests de regresión en `plugin-tools.test.ts`

- **Prioridad:** P0
- **Estimación:** S (1h)
- **Dependencias:** K-047
- **Riesgo:** 🟢
- **Archivos:** `tests/unit/plugin-tools.test.ts`
- **Descripción:** Añadir al `describe("tool.execute.after — …")` (línea 236) los casos de la tabla de §3.3 que faltan:
  1. **Regresión K-045 (núcleo del fix)**: `metadata:{}`, `output.output = "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'."` → `kevin_status.memories ≥ 1` Y `kevin_query("typecheck")` retorna lección con `"Verify types and imports"`.
  2. **Negativo empty-metadata**: `metadata:{}`, `output.output = "0 errors"` → `memories == 0`.
  3. **Negativo F#28 variante empty**: `metadata:{}`, `output.output = "Build succeeded. Note: avoid panic in error paths."` → `memories == 0` (guard de falso positivo en el branch por defecto).
  4. **exit_code alterna**: `metadata:{exit_code:2}`, `output.output="ok"` → `memories ≥ 1` (verifica `pickExitCode`).
- **Criterios de aceptación:**
  - Los 4 tests pasan.
  - Los tests existentes (líneas 237-297) siguen pasando sin cambio.
- **Verificación:** `npx vitest run tests/unit/plugin-tools.test.ts`

### K-049 — Test e2e: ciclo completo con metadata vacía (sin evento)

- **Prioridad:** P0
- **Estimación:** M (2h)
- **Dependencias:** K-047
- **Riesgo:** 🟡
- **Archivos:** `tests/e2e/plugin-complete.test.ts`
- **Descripción:** Añadir un test e2e que reproduzca el escenario real de K-045 **sin emitir** `session.next.tool.failed`:
  - `tool.execute.before` (bash, `npx tsc --noEmit`) → `tool.execute.after` con `metadata:{}` y `output.output = "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'."`.
  - `waitForAsync` hasta que `kevin_query("typecheck")` retorne una lección con `"Verify types and imports"`.
  - `chat.message` con texto "fix the typecheck error" → `system.transform` → assert `<kevin-context>` contiene la lección.
  - **No** emitir `session.next.tool.failed` en este test (demostrar que la heurística es auto-suficiente).
  - Espejo de `plugin-complete.test.ts:82-171` pero con `metadata:{}` en lugar de `metadata:{success:false,stderr,exitCode}`.
- **Criterios de aceptación:**
  - Lección persistida sin evento.
  - Inyección en `system.transform` funciona.
  - El test existente `plugin-complete.test.ts:282` (que sí usa el evento) sigue pasando.
- **Verificación:** `npx vitest run tests/e2e/plugin-complete.test.ts`

### K-050 — Bump 0.1.4 + CHANGELOG + README-K045

- **Prioridad:** P0
- **Estimación:** S (30m)
- **Dependencias:** K-048, K-049
- **Riesgo:** 🟢
- **Archivos:** `package.json`, `CHANGELOG.md`, `C:\Desarrollo\Misc\0-undefined\README-K045.md`
- **Descripción:**
  1. `package.json` `version`: `0.1.3` → `0.1.4`.
  2. Añadir entrada `## [0.1.4] — 2026-07-07` en `CHANGELOG.md` (ver §10 draft).
  3. Corregir `README-K045.md` (§9): DB path `~/.opencode-kevin/kevin.db` (no `.kevin/kevin.db`), plugin `@jmtrin/opencode-kevin@latest` (no `opencode-kevin@0.1.1`), y reemplazar el diagnóstico `npx better-sqlite3 …` por `kevin_status` (better-sqlite3 no expone bin CLI).
- **Criterios de aceptación:**
  - `node -e "console.log(require('./package.json').version)"` → `0.1.4`.
  - Entrada CHANGELOG presente.
  - `README-K045.md` coherente con el README del plugin.
- **Verificación:** `npm run typecheck && npm run lint && npm test && npm run verify`

---

## 6. Tests — detalle de los casos nuevos

### 6.1 K-048 caso 1 (regresión K-045, núcleo del fix)

```typescript
it("metadata vacia + error TS2304 en output.output dispara reflection sin evento (K-045)", async () => {
    const sess = "empty-meta-sess";
    await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: sess, callID: "em1" },
        { args: { command: "npx tsc --noEmit" } },
    );
    await hooks["tool.execute.after"]?.(
        {
            tool: "bash",
            sessionID: sess,
            callID: "em1",
            args: { command: "npx tsc --noEmit" },
        },
        {
            title: "bash",
            output: "src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'.",
            metadata: {},                       // ← el caso real del bash tool
        },
    );
    await new Promise((r) => setTimeout(r, 10));
    const status = await hooks.tool?.kevin_status.execute({}, ctx);
    const parsed = parse(status as { output: string }) as { memories: number };
    expect(parsed.memories).toBeGreaterThanOrEqual(1);
    const query = await hooks.tool?.kevin_query.execute(
        { query: "typecheck", limit: 10 },
        ctx,
    );
    const mems = parse(query as { output: string }) as Array<{ content: string }>;
    expect(mems.some((m) => m.content.includes("Verify types and imports"))).toBe(true);
    expect(mems.some((m) => m.content.includes("TS2304"))).toBe(true);
});
```

### 6.2 K-048 caso 3 (guard de falso positivo, rama por defecto)

```typescript
it("metadata vacia + prosa con 'panic'/'error' sin marcador fuerte → success=true (F#28 en rama default)", async () => {
    const sess = "fp-default-sess";
    await hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: sess, callID: "fpd1" },
        { args: { command: "npm run build" } },
    );
    await hooks["tool.execute.after"]?.(
        { tool: "bash", sessionID: sess, callID: "fpd1", args: {} },
        {
            title: "bash",
            output: "Build succeeded. Note: avoid panic in error paths.",
            metadata: {},
        },
    );
    await new Promise((r) => setTimeout(r, 10));
    const status = await hooks.tool?.kevin_status.execute({}, ctx);
    const parsed = parse(status as { output: string }) as { memories: number };
    expect(parsed.memories).toBe(0);
});
```

> Nota: el test existente `plugin-complete.test.ts:380` ("heuristica F#28") ya cubre `metadata:{}` + output con "panic"/"error" pero **no** asserts explícitamente la rama por defecto. El nuevo caso 3 lo hace explícito en `plugin-tools.test.ts` (unidad) para fijar la semántica de `STRONG_ERROR_RE`.

### 6.3 K-049 e2e (ciclo auto-suficiente, sin evento)

Modelar sobre `plugin-complete.test.ts:82-171`, pero el `tool.execute.after` del fallo usa `metadata:{}` y `output.output` con el TS error. **Omitir** el bloque `hooks.event?.({ event: { type: "session.next.tool.failed", … } })` (líneas 304-316 del test existente). El `waitForAsync` debe cumplir sin el evento. Esto prueba que la heurística de `tool.execute.after` basta.

---

## 7. Diagnóstico empírico (pre-implementación, opcional pero recomendado)

Antes de implementar K-047, confirmar la forma real de `output.metadata` del bash tool de opencode. Esto convierte el fix de "robusto a ambas posibilidades" en "basado en evidencia".

### 7.1 Sondar la metadata

Añadir temporalmente en `plugin/index.ts` dentro de `tool.execute.after` (línea 271), al inicio:

```typescript
try {
    const fs = await import("node:fs");
    fs.appendFileSync(
        join(homedir(), ".opencode-kevin", "debug-metadata.log"),
        `[${new Date().toISOString()}] tool=${hookInput.tool} meta=${JSON.stringify(meta)} outputText=${JSON.stringify(outputText.slice(0, 200))}\n`,
    );
} catch {}
```

Luego:
1. `npm run build` en `C:\opencode-kevin`.
2. Limpiar caché de opencode (§8) y reiniciar opencode.
3. En el proyecto K-045 (`C:\Desarrollo\Misc\0-undefined`), ejecutar `npm run typecheck` (falla con TS2304).
4. Inspeccionar `~/.opencode-kevin/debug-metadata.log`:

```
tool=bash meta={} outputText="src/test-fail.ts(5,19): error TS2304: Cannot find name 'foo'."
```
o
```
tool=bash meta={"success":true,"exitCode":2} outputText="…"
```

### 7.2 Decisión según el hallazgo

- Si `meta={}` (esperado según evidencia K-045) → el fix §4.2 es **necesario y suficiente** (la rama 4 lo atrapa).
- Si `meta={success:true}` → la rama 4 también lo atrapa (y la rama 3 de v0.1.3 ya lo hacía, pero ahora de forma unificada y sin falso positivos en stdout). El fix sigue siendo correcto y más robusto.
- Si `meta={exitCode:2}` (numérico) → la rama 2 ya lo atrapaba en v0.1.3; si K-045 mostró 0 memorias, este NO es el caso. (Si lo fuera, el bug sería otro — investigar por qué `reflector.invoke` no persiste.)

**Retirar** la sonda de debug antes del commit final (K-050). El fix §4.2 es válido sin necesidad de este paso, pero la evidencia documenta la causa raíz en el CHANGELOG.

---

## 8. Despliegue — refresco del caché de opencode

**Crítico**: el caché de opencode en `~/.cache/opencode/packages/@jmtrin/opencode-kevin@latest/` puede quedar **stale** tras publicar 0.1.4. La validación K-045 original corrió contra la **v0.1.2 instalada en caché** (no contra la v0.1.3 publicada), por lo que incluso el fix 0.1.3 nunca se ejecutó localmente. Sin refrescar el caché, v0.1.4 tampoco correrá.

### 8.1 Procedimiento (Windows / PowerShell)

```powershell
# 1. Publicar 0.1.4 (maintainer)
cd C:\opencode-kevin
npm run build
npm publish --access public

# 2. Cerrar opencode completamente

# 3. Limpiar el caché stale del plugin
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\@jmtrin\opencode-kevin*"

# 4. (Opcional) verificar que ya no hay residuo
Get-ChildItem "$env:USERPROFILE\.cache\opencode\packages\@jmtrin\" -ErrorAction SilentlyContinue

# 5. Reiniciar opencode — re-resuelve @latest → descarga 0.1.4
```

### 8.2 Verificación de que la versión correcta cargó

Tras reiniciar opencode, en el proyecto K-045:

```
kevin_status   # → { memories: 0, tool_calls: N, retrospectives: 0 }  (DB global, N acumulado)
```

Inspeccionar la versión del caché recién descargado:

```powershell
Get-Content "$env:USERPROFILE\.cache\opencode\packages\@jmtrin\opencode-kevin@latest\node_modules\@jmtrin\opencode-kevin\package.json" | Select-String '"version"'
# → "version": "0.1.4"
```

### 8.3 Desarrollo local sin publicar

Para iterar sin npm publish, usar el `opencode.json` del repo del plugin con path local:

```jsonc
// C:\opencode-kevin\opencode.json
{ "$schema": "https://opencode.ai/config.json", "plugin": ["./plugin/index.ts"] }
```

Y lanzar opencode con `--config` apuntando a `C:\opencode-kevin\opencode.json` (opencode carga el `.ts` vía tsx). Esto evita el caché stale durante el desarrollo.

> **Config del usuario**: `~/.config/opencode/opencode.jsonc` debe declarar **siempre** `"@jmtrin/opencode-kevin@latest"` (no fijar `@0.1.4`) para recibir futuras versiones automáticamente.

---

## 9. Correcciones de documentación (K-050 c)

El `README-K045.md` del proyecto de validación (`C:\Desarrollo\Misc\0-undefined\README-K045.md`) tiene tres discrepancias que impiden incluso el diagnóstico. Corregir:

| Sección | Actual (incorrecto) | Corregir a |
|---|---|---|
| Ruta del DB | `.kevin/kevin.db` (dentro del proyecto) | `~/.opencode-kevin/kevin.db` (global, fijado en `index.ts:43`) |
| Plugin | `opencode-kevin@0.1.1` | `@jmtrin/opencode-kevin@latest` (actualmente v0.1.4) |
| Diagnóstico DB | `npx better-sqlite3 .kevin/kevin.db "SQL"` | `kevin_status` (better-sqlite3 no expone bin CLI; el plugin expone la tool `kevin_status` para conteos) |

El `README.md` del plugin (`C:\opencode-kevin\README.md`) **ya es correcto** (dice `~/.opencode-kevin/kevin.db`, `@jmtrin/opencode-kevin@latest`, `node:sqlite`). Sin cambios.

---

## 10. Entrada CHANGELOG (draft)

```markdown
## [0.1.4] — 2026-07-07

### Fixed

- **F#1-v2 — detección de fallos auto-suficiente (sin depender del evento v2)**: el fix v0.1.3
  solo escaneaba `output.output` cuando `metadata.success === true`. La validación K-045
  demostró que el bash tool de opencode entrega `metadata = {}` (vacío) con el texto del
  comando en `output.output` (string top-level del contrato SDK), por lo que la heurística
  caía al `else` y devolvía `success = true` sin escanear → 0 memorias tras un `tsc`
  fallido garantizado. La red de seguridad del evento `session.next.tool.failed` (v2-only)
  no rescata este caso en producción: opencode no emite ese evento para un bash exit-1
  (es una tool call exitosa que devuelve contenido de error, no un fallo de ejecución).
  - Nueva precedencia en `tool.execute.after`: `meta.success===false` → fail;
    `exitCode` numérico (claves `exitCode`/`exit_code`/`exit` vía `pickExitCode`) → fail si ≠0;
    `stderr` no vacío + `ERROR_LINE_RE` (amplio) → fail; **siempre** escanea
    `stdout`/`output.output` con `STRONG_ERROR_RE` (marcadores no ambiguos) como fallback.
  - `STRONG_ERROR_RE` excluye las palabras sueltas ambiguas (`error`, `fail`, `failed`,
    `panic`, `fatal`) para evitar falsos positivos en prosa de éxito (guard F#28 mantenido);
    retiene `TS\d{4,}`, `cannot find`, `error TS\d`, `command failed`, `non-zero exit`,
    `exit code [1-9]`, `traceback`, `referenceerror`, `typeerror`, `syntaxerror`,
    `fatal error`, `build failed`, `failed to compile`, `compilation failed`, `exception`.
  - stderr sigue usando `ERROR_LINE_RE` amplio (stderr es señal fuerte; F#28 solo
    restringe stdout).
  - La red de seguridad del evento `session.next.tool.failed` se conserva para fallos
    reales de ejecución del tool (no bash exit-1).

### Tests

- `plugin-tools.test.ts +4`: (1) `metadata:{}` + `error TS2304` en `output.output`
  → reflection sin evento (regresión K-045, núcleo del fix); (2) `metadata:{}` + `"0 errors"`
  → 0 memorias (negativo); (3) `metadata:{}` + prosa con `panic`/`error` → 0 memorias
  (guard F#28 en rama por defecto); (4) `metadata:{exit_code:2}` → reflection (verifica
  `pickExitCode`).
- `plugin-complete.test.ts +1`: ciclo completo (before → after con `metadata:{}` → lección
  → `system.transform` inyecta) **sin** emitir `session.next.tool.failed` (auto-suficiencia).

### Changed

- `package.json` version `0.1.3` → `0.1.4`.
- `README-K045.md` (proyecto de validación): DB path `~/.opencode-kevin/kevin.db`,
  plugin `@jmtrin/opencode-kevin@latest`, diagnóstico vía `kevin_status` (no `npx better-sqlite3`).
```

---

## 11. Fuera de alcance (diferido)

| Item | Razón | Destino |
|---|---|---|
| Detectar `panic` suelto de Go | Excluido de `STRONG_ERROR_RE` para no romper F#28; requiere `panic:` con boundaries | v0.1.5 (afinamiento de regex) |
| Throttle por-tool (no global 60s) | El throttle global (`Reflector.ts:65`) puede omitir un segundo fallo distinto dentro de 60s; no afecta K-045 (fallo único) | v0.2 |
| `handleToolFailed` con `error.message` genérico | Si el evento v2 sí se emite con `message="Command exited with code 1"`, `inferErrorType` retorna `unknown` (lección poco específica). Mejorable pasando el output cacheado al evento. | v0.2 |
| Suscripción tipada a eventos v2 | El acceso sin tipar actual (`event as {type?:string}`) ya recibe eventos v2 en runtime si opencode los emite. No requiere cambio. | — |
| Embeddings / búsqueda semántica | ABI complexity | v0.2 (roadmap `Kevin_Plan.md` §14) |

---

## 12. Verificación final

```bash
cd C:\opencode-kevin
npm run typecheck   # tsc --noEmit (strict) — debe pasar
npm run lint        # biome check .
npm test            # vitest run (unit + integration + e2e) — incluye K-048 y K-049
npm run verify      # post-install verification
```

Luego, validación manual K-045 en `C:\Desarrollo\Misc\0-undefined` (tras §8 refresco de caché):

1. `npm run typecheck` → falla con `error TS2304: Cannot find name 'foo'`.
2. `kevin_status` → `memories ≥ 1` (era 0 antes del fix).
3. `kevin_query({ query: "typecheck" })` → retorna lección `When bash fails with typecheck: error TS2304: Cannot find name 'foo'… / Suggestion: Verify types and imports before running.`
4. Sesión nueva → primer prompt mencionando "typecheck" → `system.transform` inyecta `<kevin-context>` con la lección (verificar en log o vía `experimental.chat.system.transform`).

**Criterio de salida cumplido** cuando los 4 pasos pasan sin intervención manual.

---

## 13. Resumen de cambios

| Archivo | Cambio | Líneas aprox. |
|---|---|---|
| `plugin/Reflector.ts` | +`export const STRONG_ERROR_RE` | +2 (junto a línea 31) |
| `plugin/index.ts` | +import `STRONG_ERROR_RE`; +`pickExitCode`; reemplaza cómputo de `success` en `tool.execute.after` | ~271-293 (±5 neto) |
| `tests/unit/plugin-tools.test.ts` | +4 tests en `describe` existente | +~80 |
| `tests/e2e/plugin-complete.test.ts` | +1 test e2e auto-suficiente | +~60 |
| `package.json` | `version` 0.1.3→0.1.4 | 1 |
| `CHANGELOG.md` | +entrada `[0.1.4]` | +~30 |
| `C:\Desarrollo\Misc\0-undefined\README-K045.md` | 3 correcciones (DB path, plugin, diagnóstico) | 3 líneas |

**Total**: 2 archivos fuente, 2 archivos de test, 3 de meta/docs. Sin migración de DB. Sin breaking change.

---

## 14. Referencias

- `docs/Kevin_Plan.md` — arquitectura, schema, decisiones (D5 storage, D6 throttle)
- `docs/Kevin_Task.md` — tareas K-001…K-045 (K-045 = validación manual)
- `CHANGELOG.md` — entradas 0.1.1 (F#1, F#28), 0.1.3 (F#1-fix success=true override)
- `plugin/index.ts:271-293` — heurística actual (a reemplazar)
- `plugin/Reflector.ts:30-31` — `ERROR_LINE_RE` (a acompañar con `STRONG_ERROR_RE`)
- `plugin/ToolCallObserver.ts:117-138` — `inferErrorType` (sin cambios; recibe stdout=outputText)
- `tests/unit/plugin-tools.test.ts:236-297` — tests 0.1.3 (deben pasar sin cambio)
- `tests/e2e/plugin-complete.test.ts:282-330` — test del evento (debe pasar sin cambio)
- `tests/e2e/plugin-complete.test.ts:380-407` — guard F#28 (debe pasar sin cambio)
- Contrato SDK: `@opencode-ai/plugin` `dist/index.d.ts:249-258` (`output: {title, output, metadata}`)
- Eventos v1 vs v2: `@opencode-ai/sdk` `dist/gen/types.gen.d.ts:602` (v1, sin `session.next.tool.*`) vs `dist/v2/gen/types.gen.d.ts:898, 3812` (v2, con `SessionNextToolFailed`)
