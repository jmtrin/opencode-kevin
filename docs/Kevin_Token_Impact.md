# Kevin v0.1.0 — Impacto en Consumo de Tokens (con DCP + Orquestación)

**Versión:** 2.0
**Fecha:** 2026-07-01
**Estado:** Congelado (Fase 1 iniciada — 2026-07-01)
**Tipo:** Documento de evaluación
**Dependencia:** `docs/Kevin_Plan.md`, `docs/Kevin_Task.md`

---

## 0. Premisas de este informe

Este análisis asume dos premisas que cambian radicalmente el cálculo respecto al informe anterior:

### Premisa 1: Kevin se usa conjuntamente con DCP

`opencode-dynamic-context-pruning` (DCP) purge automáticamente las salidas obsoletas de tools (bash outputs viejos, reads de archivos que ya se editaron, grep results ya consumidos). DCP no añade tokens al contexto; los elimina.

**Implicación**: el espacio de contexto que DCP libera lo puede ocupar Kevin con lecciones aprendidas sin que el contexto total crezca. Kevin y DCP son **complementarios**, no competidores: DCP poda lo stale, Kevin inyecta lo aprendido.

### Premisa 2: El trabajo normal es orquestado

El usuario no interactúa mensaje a mensaje con el agente. Da una instrucción de alto nivel y una herramienta de orquestación (típicamente `opencode-conductor` con su workflow Context → Spec → Plan → Implement) descompone el trabajo en fases autónomas. El agente trabaja solo durante largos periodos, haciendo decenas de tool calls por fase.

**Implicación**: el patrón de uso cambia de "20 mensajes cortos del usuario" a "1-3 instrucciones del usuario que disparan 50-200 tool calls autónomos". Esto significa:
- Menos mensajes del usuario → menos eventos de pre-prompt injection de Kevin.
- Más tool calls autónomos → más observación para Kevin → más lecciones generadas.
- Sesiones mucho más largas → más eventos de compaction → más valor de la injection en compacting.
- Los fallos ocurren en medio del trabajo autónomo, no en interacción con el usuario.

---

## 1. Resumen ejecutivo

Bajo las premisas de uso con DCP + orquestación, **Kevin v0.1.0 tiene impacto neto negativo en tokens consumidos (ahorra) en prácticamente todos los escenarios realistas**, excepto el primer proyecto completamente nuevo en sus primeras 1-2 sesiones.

| Escenario | Sin Kevin+DCP | Con Kevin+DCP | Delta | Veredicto |
|---|---|---|---|---|
| Track simple, proyecto nuevo | base | +0-200 | +0-200 | Despreciable |
| Track bugfix, proyecto maduro | base | +400-800 prompt, -1500-4000 evitado | **-1100 a -3200** | Ahorra |
| Track feature media, proyecto maduro | base | +600-1000 prompt, -3000-8000 evitado | **-2400 a -7000** | Ahorra |
| Track migración compleja, multi-sesión | base | +800-1200/sesión, -10000-30000 evitado | **-9000 a -29000** | Ahorra mucho |
| Track autónomo largo con 3 compactions | base | +1500-4500 compacting, -6000-24000 evitado | **-1500 a -19500** | Ahorra |
| 10 tracks similares en secuencia | base | +5000 total, -40000 evitado | **-35000** | Ahorra 35%+ |

**Conclusión**: con DCP liberando contexto y orquestación generando trabajo autónomo largo, Kevin tiene más espacio para inyectar lecciones y más fallos de los que aprender. El overhead de injection (-1000 a -3000 tokens/sesión) es ampliamente compensado por iteraciones evitadas (-3000 a -30000 tokens/sesión). **El break-even llega en la sesión 2-3, no en la sesión 15.**

---

## 2. Cómo cambia el stack Kevin + DCP + Orquestación

### 2.1 Arquitectura del stack

```
┌──────────────────────────────────────────────────────────────┐
│  USUARIO: "Arregla el bug de auth en login"                   │
├──────────────────────────────────────────────────────────────┤
│  CONDUCTOR: /conductor:newTrack "fix auth bug"               │
│  ├── spec.md (3-5 preguntas clarifying)                       │
│  ├── plan.md (checklist de tasks)                             │
│  └── /conductor:implement (ejecución autónoma)                │
├──────────────────────────────────────────────────────────────┤
│  AGENTE (build/general): ejecuta plan.md autónomamente        │
│  ├── read archivos (5-15 reads)                               │
│  ├── edit archivos (3-10 edits)                               │
│  ├── bash typecheck (2-5 intentos)                            │
│  ├── bash tests (1-3 intentos)                                │
│  └── bash lint (1-2 intentos)                                 │
│     ↑ DCP purga outputs de reads/edits ya consumidos          │
│     ↑ KEVIN observa cada tool call                            │
│     ↑ KEVIN reflexiona si algo falla                          │
│     ↑ KEVIN inyecta lecciones en system prompt                │
├──────────────────────────────────────────────────────────────┤
│  COMPACTION (cuando context se llena)                         │
│  ├── DCP ya ha purgado lo stale                               │
│  ├── KEVIN inyecta memorias relevantes                        │
│  └── Conductor reinyecta spec.md + plan.md                    │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 División de responsabilidades

| Componente | Añade tokens | Elimina tokens | Función |
|---|---|---|---|
| **Conductor** | +500-2000 (spec.md + plan.md en contexto) | 0 | Estructura el trabajo en Tracks |
| **DCP** | 0 | -2000 a -10000/sesión larga | Purga tool outputs obsoletos |
| **Kevin** | +400-1500/prompt, +1500-2000/compaction | -500 a -30000/sesión (iteraciones evitadas) | Aprende de errores, inyecta lecciones |
| **OpenCode host** | 0 | 0 (compaction nativa) | Compaction, permissions, tools |

**Sinergia clave**: DCP libera espacio → Kevin lo ocupa con lecciones útiles → el contexto total se mantiene estable pero con mejor señal/ruido. Sin DCP, las inyecciones de Kevin competirían con tool outputs stale por espacio. Con DCP, Kevin tiene "espacio limpio" para inyectar.

### 2.3 Por qué la orquestación cambia el cálculo

Sin orquestación (informe anterior): el usuario da 20 mensajes cortos, Kevin inyecta en cada uno, overhead acumula +8000 tokens.

Con orquestación: el usuario da 1-3 mensajes, conductor descompone en plan, el agente ejecuta 50-200 tool calls autónomamente. Kevin inyecta:
- **En el mensaje inicial del usuario** (1-3 veces, no 20): +400-1500 tokens × 1-3 = +400-4500 total.
- **En cada compaction** (2-5 veces en sesión larga): +1500-2000 × 2-5 = +3000-10000 total.
- **Total overhead**: +3400-14500 tokens/sesión.

Pero los ahorros escalan con el trabajo autónomo:
- **Iteraciones evitadas**: 50-200 tool calls autónomos = más oportunidades de fallar = más iteraciones que Kevin evita con lecciones. -1500 a -15000 tokens.
- **Re-exploración post-compaction evitada**: 2-5 compactions × 2000-4000 tokens ahorrados cada una = -4000 a -20000 tokens.
- **Convergencia en tasks repetitivos**: si el Track es similar a uno anterior, -2000 a -8000 tokens.

**Total ahorro**: -7500 a -43000 tokens/sesión.

**Delta neto**: -4100 a -28500 tokens/sesión. **Kevin ahorra significativamente.**

---

## 3. Dónde Kevin añade tokens (con orquestación)

### 3.1 Pre-prompt injection — frecuencia reducida

Con orquestación, el usuario envía 1-3 mensajes por sesión (no 20). La injection pre-prompt de Kevin se dispara en `experimental.chat.system.transform`, que ocurre antes de cada mensaje del usuario procesado.

| Tipo de mensaje | Frecuencia/sesión | Inyección Kevin |
|---|---|---|
| Instrucción inicial del usuario | 1 | +400-1500 tokens |
| Clarificación (conductor pregunta) | 0-2 | +200-800 tokens |
| Mensajes autónomos del agente | 0 (no disparan system.transform) | 0 |
| **Total pre-prompt** | 1-3 eventos | **+400-3100 tokens** |

**Comparación sin orquestación**: 20 mensajes × 400 = +8000 tokens. Con orquestación: +400-3100. **La orquestación reduce el overhead de pre-prompt injection en 60-95%.**

### 3.2 Compacting injection — frecuencia aumentada

Las sesiones orquestadas son más largas (trabajo autónomo). Más tool calls = más contexto consumido = más compactions.

| Duración de sesión | Tool calls | Compactions esperadas | Inyección Kevin |
|---|---|---|---|
| Corta (Track simple, 10 min) | 10-30 | 0-1 | 0-2000 |
| Media (Track bugfix, 30-60 min) | 30-80 | 1-2 | 1500-4000 |
| Larga (Track feature, 1-3 horas) | 80-200 | 2-4 | 3000-8000 |
| Muy larga (Track migración, 3+ horas) | 200-500 | 3-6 | 4500-12000 |

**Pero DCP reduce la frecuencia de compaction**: al purgar tool outputs stale, DCP extiende la vida del contexto antes de que se llene. Estimación: DCP reduce compactions en 30-50%.

| Sin DCP | Con DCP | Compactions reales | Inyección Kevin |
|---|---|---|---|
| 2-4 | 1-2 | 1-2 | 1500-4000 |
| 3-6 | 2-3 | 2-3 | 3000-6000 |

### 3.3 Tool calls del LLM (opt-in)

El agente autónomo puede llamar `kevin_query`, `kevin_recall`, etc. Con orquestación, el agente tiene más autonomía y puede usar las tools más:

| Tool | Frecuencia/sesión orquestada | Tokens |
|---|---|---|
| `kevin_query` | 1-5 (búsqueda de lecciones relevantes) | 200-2500 |
| `kevin_recall` | 0-3 (recall antes de tarea) | 200-1200 |
| `kevin_save` | 0-5 (guardar decisiones) | 150-750 |
| `kevin_status` | 0-1 | 50 |
| `kevin_retrospective` | 0-1 (al final) | 20 |
| **Total** | | **600-4720** |

### 3.4 Overhead total con orquestación + DCP

| Mecanismo | Tokens/sesión |
|---|---|
| Pre-prompt injection (1-3 eventos) | +400-3100 |
| Compacting injection (1-3 eventos, DCP reduce frecuencia) | +1500-6000 |
| Tool calls opt-in | +600-4720 |
| **Total overhead** | **+2500-13820** |

**Comparación con informe anterior (sin orquestación, sin DCP)**: +0-32000. Con orquestación + DCP: +2500-13820. **El overhead se reduce porque hay menos eventos de pre-prompt y DCP reduce compactions.**

---

## 4. Dónde Kevin ahorra tokens (con orquestación)

### 4.1 Evitar iteraciones en trabajo autónomo

El trabajo autónomo es donde más iteraciones ocurren. Un plan.md típico de conductor tiene 5-15 tasks. Cada task puede requerir 1-3 iteraciones de edit→typecheck→fix. Sin Kevin, cada iteración fallida cuesta ~800-1500 tokens.

| Tracks | Tasks/track | Iteraciones/task | Tokens/iteración evitada | Total ahorrado |
|---|---|---|---|---|
| 1 Track bugfix | 3-5 | 0.5-1 | 800-1500 | 1200-7500 |
| 1 Track feature | 5-15 | 0.5-1.5 | 800-1500 | 2000-33750 |
| 1 Track migración | 10-25 | 1-2 | 800-1500 | 8000-75000 |

**Con Kevin (proyecto maduro)**: las lecciones inyectadas evitan 30-60% de las iteraciones fallosas.

| Track type | Iteraciones sin Kevin | Iteraciones con Kevin | Ahorro |
|---|---|---|---|
| Bugfix | 2-5 | 1-3 | -800-3000 |
| Feature | 4-15 | 2-8 | -1600-10500 |
| Migración | 10-30 | 5-15 | -4000-22500 |

### 4.2 Re-exploración post-compaction eliminada

Tras cada compaction, sin Kevin el agente re-explora el proyecto para reconstruir understanding. Con Kevin, las memorias inyectadas en compacting dan contexto inmediato.

| Sin Kevin | Con Kevin | Ahorro/compaction |
|---|---|---|
| 3000-8000 tokens (re-read de archivos, re-grep) | 500-1500 (verificación rápida con contexto de memorias) | -2500-6500 |

Con DCP reduciendo compactions a 1-3 por sesión:
- 1 compaction: ahorro de -2500-6500
- 3 compactions: ahorro de -7500-19500

### 4.3 Convergencia en Tracks similares

Conductor organiza trabajo en Tracks. Si un Track es similar a uno anterior (mismo módulo, mismo tipo de bug), las lecciones de Kevin evitan redescubrir el approach.

| Track anterior similar | Sin Kevin | Con Kevin | Ahorro |
|---|---|---|---|
| Bugfix mismo módulo | 3000-8000 (diagnóstico desde cero) | 1000-3000 (lección da dirección) | -2000-5000 |
| Feature mismo patrón | 5000-15000 (exploración + diseño) | 2000-6000 (memorias dan contexto) | -3000-9000 |

### 4.4 Ahorro total con orquestación + DCP

| Mecanismo | Tokens ahorrados/sesión |
|---|---|
| Iteraciones evitadas (trabajo autónomo) | -800-22500 |
| Re-exploración post-compaction evitada | -2500-19500 |
| Convergencia en Tracks similares | -2000-9000 |
| **Total ahorro** | **-5300-51000** |

---

## 5. Casos de uso con estimación detallada

### CU-01 — Track bugfix simple, proyecto nuevo

**Escenario**: `/conductor:newTrack "fix typo in utils.ts"`. Proyecto sin historial de Kevin. Conductor genera spec.md (3 preguntas) + plan.md (3 tasks). Agente ejecuta autónomamente.

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec.md + plan.md en contexto | +1500 | +1500 | 0 |
| Pre-prompt injection (1 mensaje usuario) | 0 | 0 (sin memorias) | 0 |
| Trabajo autónomo (3 tool calls: read, edit, typecheck) | 2000 | 2000 | 0 |
| DCP pruning (purga read tras edit) | -600 | -600 | 0 |
| Compaction | 0 (sesión corta) | 0 | 0 |
| **Total** | **2900** | **2900** | **0** |

**Veredicto**: proyecto nuevo, sin memorias. Kevin no añade overhead ni ahorra. DCP ya está podando. **Delta: 0 tokens.**

### CU-02 — Track bugfix de typecheck, proyecto maduro

**Escenario**: `/conductor:newTrack "fix typecheck error in auth.ts"`. Proyecto con 40+ memorias, 5 lecciones de typecheck. Conductor genera spec + plan (4 tasks). Agente ejecuta autónomamente, 25 tool calls.

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec.md + plan.md | +1500 | +1500 | 0 |
| Pre-prompt injection (1 mensaje) | 0 | +500 (3 lecciones typecheck) | +500 |
| Trabajo autónomo (25 tool calls) | 18000 | 18000 | 0 |
| DCP pruning (purga 15 outputs stale) | -4000 | -4000 | 0 |
| **Iteración 1** (sin Kevin): edit con unused var | +400 | — | -400 |
| **Iteración 1** (sin Kevin): typecheck falla | +600 | — | -600 |
| **Iteración 1** (sin Kevin): diagnóstico + fix | +800 | — | -800 |
| **Iteración 1** (con Kevin): edit correcto (lección) | — | +400 | +400 |
| **Iteración 1** (con Kevin): typecheck pasa | — | +600 | +600 |
| Compaction (1 evento) | 0 (sesión corta-media) | 0 | 0 |
| **Total** | **16300** | **15000** | **-1300** |

**Veredicto**: Kevin añade +500 de injection pero evita 1 iteración completa (-1800). DCP poda igual en ambos casos. **Delta: -1300 tokens. -8%.**

### CU-03 — Track feature media, proyecto maduro

**Escenario**: `/conductor:newTrack "implement dark mode"`. Proyecto con 60+ memorias (decisiones CSS, estructura, patrones). Conductor genera spec + plan (10 tasks). Agente ejecuta 80 tool calls autónomos. 2 compactions.

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec.md + plan.md | +2000 | +2000 | 0 |
| Pre-prompt injection (1 mensaje + 1 clarificación) | 0 | +1200 (5 memorias: CSS, estructura, patrones) | +1200 |
| Trabajo autónomo (80 tool calls) | 55000 | 55000 | 0 |
| DCP pruning (purga 50 outputs stale) | -12000 | -12000 | 0 |
| Iteraciones evitadas (3 iteraciones de error) | 0 | -3600 (3 × 1200 evitado) | -3600 |
| Exploración reducida (memorias dicen dónde está todo) | 0 | -2000 (5 reads evitados) | -2000 |
| **Compaction 1**: injection Kevin | 0 | +1800 | +1800 |
| **Compaction 1**: re-exploración (sin Kevin) | +4000 | — | -4000 |
| **Compaction 1**: re-exploración (con Kevin) | — | +1000 | +1000 |
| **Compaction 2**: injection Kevin | 0 | +1800 | +1800 |
| **Compaction 2**: re-exploración (sin Kevin) | +3500 | — | -3500 |
| **Compaction 2**: re-exploración (con Kevin) | — | +800 | +800 |
| **Total** | **52500** | **49900** | **-2600** |

**Veredicto**: Kevin añade +4800 (injections) pero ahorra -9100 (iteraciones + exploración + re-exploración). DCP poda -12000 en ambos. **Delta: -2600 tokens. -5%.**

**Nota**: el porcentaje es menor porque el trabajo autónomo (55000 tokens) domina. Pero en valor absoluto, Kevin ahorra 2600 tokens en una sola sesión.

### CU-04 — Track migración compleja, multi-sesión (3 sesiones)

**Escenario**: migración Express → Fastify. 3 Tracks en 3 sesiones (días diferentes). Proyecto maduro. Conductor genera spec + plan para cada Track. Total 350 tool calls, 6 compactions.

| Sesión | Sin Kevin+DCP | Con Kevin+DCP | Delta | Nota |
|---|---|---|---|---|
| **S1: Análisis** (40 tool calls, 1 compaction) | | | | |
| Conductor spec + plan | +2000 | +2000 | 0 | |
| Pre-prompt injection | 0 | +600 | +600 | 1 mensaje |
| Trabajo autónomo | 28000 | 28000 | 0 | |
| DCP pruning | -6000 | -6000 | 0 | |
| Compaction 1 injection | 0 | +1800 | +1800 | |
| Re-exploración post-compact | +3500 | +1000 | -2500 | Kevin da contexto |
| Iteraciones evitadas | 0 | -1200 | -1200 | 1 iteración evitada |
| **Subtotal S1** | **27500** | **27200** | **-300** | Leve ahorro |
| **S2: Implementación** (150 tool calls, 2 compactions) | | | | |
| Conductor spec + plan | +2500 | +2500 | 0 | |
| Pre-prompt injection (1 msg + 1 clarif) | 0 | +1500 | +1500 | Lecciones S1 inyectadas |
| Trabajo autónomo | 95000 | 95000 | 0 | |
| DCP pruning | -20000 | -20000 | 0 | |
| Iteraciones evitadas (8 iteraciones) | 0 | -9600 | -9600 | Lecciones de migración |
| Compaction 1 injection | 0 | +2000 | +2000 | |
| Re-exploración 1 | +4000 | +1200 | -2800 | |
| Compaction 2 injection | 0 | +2000 | +2000 | |
| Re-exploración 2 | +3500 | +1000 | -2500 | |
| **Subtotal S2** | **85000** | **75600** | **-9400** | Ahorro grande |
| **S3: Testing + fixes** (160 tool calls, 3 compactions) | | | | |
| Conductor spec + plan | +2000 | +2000 | 0 | |
| Pre-prompt injection | 0 | +1800 | +1800 | Lecciones S1+S2 |
| Trabajo autónomo | 100000 | 100000 | 0 | |
| DCP pruning | -22000 | -22000 | 0 | |
| Iteraciones evitadas (12 iteraciones) | 0 | -14400 | -14400 | Patrones de error conocidos |
| Compaction 1-3 injection | 0 | +6000 | +6000 | 3 × 2000 |
| Re-exploración 1-3 | +12000 | +3600 | -8400 | 3 × -2800 |
| **Subtotal S3** | **92000** | **76800** | **-15200** | Ahorro muy grande |
| **TOTAL** | **204500** | **179600** | **-24900** | **-12%** |

**Veredicto**: La sesión 1 paga overhead (+600 injection, -1200 iteraciones, -2500 re-exploración = neto -300). Las sesiones 2-3 se benefician enormemente de las lecciones acumuladas. DCP poda consistentemente en ambas columnas. **Delta total: -24900 tokens. -12%.**

### CU-05 — Track autónomo largo con 3 compactions (sesión intensiva)

**Escenario**: `/conductor:implement` en un Track grande. 200 tool calls autónomos. 3 compactions (DCP las reduce de 5 a 3). Proyecto maduro.

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: plan.md persistido | +1500 | +1500 | 0 |
| Pre-prompt injection (1 mensaje inicial) | 0 | +800 | +800 |
| Trabajo autónomo (200 tool calls) | 140000 | 140000 | 0 |
| DCP pruning (purga 130 outputs) | -35000 | -35000 | 0 |
| Iteraciones evitadas (10 iteraciones) | 0 | -12000 | -12000 |
| Compaction 1: injection | 0 | +2000 | +2000 |
| Compaction 1: re-exploración | +5000 | +1500 | -3500 |
| Compaction 2: injection | 0 | +2000 | +2000 |
| Compaction 2: re-exploración | +4500 | +1200 | -3300 |
| Compaction 3: injection | 0 | +2000 | +2000 |
| Compaction 3: re-exploración | +4000 | +1000 | -3000 |
| **Total** | **116000** | **113500** | **-2500** |

**Veredicto**: Kevin añade +6800 (injections) pero ahorra -18600 (iteraciones + re-exploraciones). DCP poda -35000. **Delta: -2500 tokens. -2% en valor relativo pero -2500 tokens absolutos.**

**Nota**: el porcentaje es bajo porque el trabajo autónomo (140000) domina. Pero Kevin evita 10 iteraciones y 3 re-exploraciones, lo que en tiempo de agente es ~15-30 minutos ahorrados.

### CU-06 — 10 Tracks bugfix similares en secuencia (benchmark)

**Escenario**: 10 Tracks bugfix de typecheck similares, ejecutados en secuencia (mismo proyecto, días diferentes). Proyecto nuevo al inicio, maduro al final. Cada Track: 25 tool calls, 1 compaction, DCP poda.

| Track # | Sin Kevin+DCP | Con Kevin+DCP | Delta | Nota |
|---|---|---|---|---|
| 1 | 16000 | 16000 | 0 | Sin memorias aún |
| 2 | 16000 | 15200 | -800 | 1 lección inyectada, 1 iteración evitada |
| 3 | 16000 | 14500 | -1500 | 2 lecciones + pattern, 2 iteraciones evitadas |
| 4 | 16000 | 14000 | -2000 | 3 lecciones, exploración reducida |
| 5 | 16000 | 13700 | -2300 | Lecciones establecidas |
| 6 | 16000 | 13500 | -2500 | Convergencia |
| 7 | 16000 | 13400 | -2600 | Convergencia |
| 8 | 16000 | 13400 | -2600 | Igual |
| 9 | 16000 | 13400 | -2600 | Igual |
| 10 | 16000 | 13400 | -2600 | Igual |
| **Total** | **160000** | **146500** | **-13500** | **-8.4%** |

**Veredicto**: A medida que Kevin acumula lecciones (Track 1-5), cada Track evita más iteraciones. Del Track 6 en adelante, converge a -2600 tokens/Track. **Delta total: -13500 tokens. -8.4%.**

### CU-07 — Track corto sin errores, proyecto maduro

**Escenario**: `/conductor:newTrack "update version number in package.json"`. Track trivial, 5 tool calls, 0 compactions. Proyecto maduro.

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +1000 | +1000 | 0 |
| Pre-prompt injection | 0 | +300 (2 memorias: estructura, convención) | +300 |
| Trabajo autónomo (5 tool calls) | 3000 | 3000 | 0 |
| DCP pruning | -800 | -800 | 0 |
| **Total** | **3200** | **3500** | **+300** |

**Veredicto**: Kevin añade +300 que no generan ahorro porque la task es trivial y no falla. **Delta: +300 tokens. +9% (marginal en absoluto).**

### CU-08 — Track code review, proyecto maduro

**Escenario**: `/conductor:newTrack "review PR #42"`. Conductor genera spec (criterios de review) + plan (pasos de review). 40 tool calls (reads del diff, análisis). 1 compaction.

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +1500 | +1500 | 0 |
| Pre-prompt injection | 0 | +600 (convenciones, errores conocidos) | +600 |
| Trabajo autónomo (40 tool calls) | 28000 | 28000 | 0 |
| DCP pruning | -7000 | -7000 | 0 |
| Descubrimiento de convenciones (sin Kevin) | +2000 | +500 (memorias las dan) | -1500 |
| Compaction 1: injection | 0 | +1500 | +1500 |
| Re-exploración post-compact | +3000 | +800 | -2200 |
| **Total** | **27500** | **25900** | **-1600** |

**Veredicto**: Kevin añade +2100 (injections) pero ahorra -3700 (descubrimiento + re-exploración). **Delta: -1600 tokens. -6%.**

### CU-09 — Track feature compleja multi-módulo, proyecto muy maduro

**Escenario**: `/conductor:newTrack "implement OAuth2 PKCE flow"`. Proyecto con 100+ memorias. Conductor genera spec + plan (18 tasks). 180 tool calls. 3 compactions. DCP poda.

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +2500 | +2500 | 0 |
| Pre-prompt injection (2 mensajes) | 0 | +1500 (8 memorias: auth, security, estructura) | +1500 |
| Trabajo autónomo (180 tool calls) | 125000 | 125000 | 0 |
| DCP pruning | -30000 | -30000 | 0 |
| Exploración reducida (memorias dan estructura) | 0 | -8000 (10 reads evitados) | -8000 |
| Iteraciones evitadas (12 iteraciones) | 0 | -14400 | -14400 |
| Compaction 1-3: injection | 0 | +6000 | +6000 |
| Re-exploración 1-3 (sin Kevin) | +15000 | — | -15000 |
| Re-exploración 1-3 (con Kevin) | — | +3600 | +3600 |
| **Total** | **112500** | **97000** | **-15500** |

**Veredicto**: Kevin añade +7500 (injections) pero ahorra -26300 (exploración + iteraciones + re-exploración). DCP poda -30000. **Delta: -15500 tokens. -14%.**

### CU-10 — Peor caso: Track trivial, proyecto nuevo, sin DCP effectivo

**Escenario**: Track de 1 task (cambiar un string). Proyecto nuevo, 0 memorias. DCP no tiene nada que podar (sesión corta).

| Concepto | Sin Kevin+DCP | Con Kevin+DCP | Delta |
|---|---|---|---|
| Conductor: spec + plan | +800 | +800 | 0 |
| Pre-prompt injection | 0 | 0 (sin memorias) | 0 |
| Trabajo (3 tool calls) | 1500 | 1500 | 0 |
| DCP pruning | 0 | 0 | 0 |
| **Total** | **2300** | **2300** | **0** |

**Veredicto**: Kevin no añade overhead porque no hay memorias. **Delta: 0 tokens.**

---

## 6. Análisis de break-even (con orquestación + DCP)

### 6.1 Break-even por sesión

| Sesión # | Proyecto madurez | Overhead Kevin | Ahorro Kevin | Delta neto |
|---|---|---|---|---|
| 1 | 0 memorias | 0 | 0 | 0 |
| 2 | 5-15 memorias | +400-800 | -200-1000 | +200 a -200 |
| 3 | 15-30 memorias | +600-1200 | -1000-3000 | -400 a -1800 |
| 4 | 30-50 memorias | +800-1500 | -2000-5000 | -1200 a -3500 |
| 5+ | 50+ memorias | +800-1500 | -3000-15000 | -2200 a -13500 |

**Break-even**: sesión 2-3 (no sesión 15 como en el informe anterior). La orquestación genera más fallos observables y más compactions, acelerando la acumulación de lecciones.

### 6.2 Por qué el break-even llega antes con orquestación

1. **Más tool calls por sesión**: 50-200 vs 10-20 sin orquestación. Cada fallo genera una lección. Más lecciones por sesión = madurez más rápida.
2. **Menos overhead por sesión**: 1-3 pre-prompt injections vs 20. El overhead no escala con el trabajo, solo con los mensajes del usuario.
3. **DCP libera espacio**: las inyecciones de Kevin no compiten con tool outputs stale. Más espacio para lecciones = más valor por token inyectado.
4. **Compactions más frecuentes**: sesiones más largas = más compactions = más oportunidades de inyectar lecciones que salvan re-exploración.

### 6.3 Curva de madurez (con orquestación + DCP)

```
Tokens ahorrados netos por sesión
        │
  +10000│                                         ────── (proyecto maduro, tracks complejos)
        │                                   ╱─────
   +5000│                              ╱───
        │                         ╱───
    0   │────────────────────╱────────────── break-even (sesión 2-3)
        │                 ╱
   -2000│            ╱───  (proyecto joven, tracks simples)
        │       ╱───
        │  ────  (proyecto nuevo, overhead sin ahorro)
        └──────────────────────────────────────
         Sesión 1   2   3   4   5   6   7   8
                  Madurez (acelerada por orquestación)
```

Comparación con informe anterior (sin orquestación): break-even en sesión 5-15. Con orquestación + DCP: break-even en sesión 2-3. **3-7x más rápido.**

---

## 7. Sinergia Kevin + DCP detallada

### 7.1 Sin DCP (Kevin solo)

Sin DCP, las inyecciones de Kevin compiten con tool outputs stale por espacio en el contexto. El contexto total crece:

```
Contexto sin DCP ni Kevin:  [trabajo autónomo ████████ 80000 tokens]
Contexto con Kevin sin DCP: [trabajo ████████ 80000] [Kevin inyecta ███ 6000] = 86000
Contexto con DCP sin Kevin: [trabajo podado ████ 50000] = 50000
Contexto con Kevin + DCP:   [trabajo podado ████ 50000] [Kevin inyecta ███ 6000] = 56000
```

**Con DCP**: Kevin inyecta 6000 tokens en un contexto de 50000 (12% del contexto). Sin DCP, Kevin inyecta 6000 en un contexto de 80000 (7.5%). El valor relativo de Kevin es **mayor con DCP** porque sus lecciones representan mayor proporción del contexto útil.

### 7.2 DCP extiende la vida del contexto antes de compaction

| Sin DCP | Con DCP | Compactions evitadas por DCP |
|---|---|---|
| Compaction en 80k tokens | Compaction en 80k tokens tras poda a 50k | 1 compaction evitada |
| 5 compactions/sesión larga | 3 compactions/sesión larga | 2 evitadas |

Cada compaction evitada por DCP:
- Ahorra el costo de la compaction misma (~5000-10000 tokens de summarization).
- Reduce las re-exploraciones post-compaction (-2500-6500 tokens).
- Reduce las inyecciones de Kevin en compaction (-1500-2000 tokens).

**Neto**: DCP ahorra -9000-18500 tokens/sesión larga por sí solo. Kevin se beneficia porque tiene menos compactions que gestionar y más contexto limpio para inyectar.

### 7.3 DCP + Kevin en compaction

Cuando ocurre compaction (incluso con DCP, ocurre en sesiones muy largas):

| Sin Kevin | Con Kevin |
|---|---|
| DCP ya podó lo stale | DCP ya podó lo stale |
| Compaction resume el resto | Compaction resume el resto |
| Agente pierde lecciones implícitas | **Kevin inyecta lecciones explícitas** |
| Re-exploración: 3000-8000 tokens | Re-exploración: 500-1500 tokens |

**Kevin + DCP en compaction**: DCP asegura que lo que se compacta es relevante. Kevin asegura que lo que se reinyecta incluye lecciones aprendidas. Combinación óptima.

---

## 8. Tabla resumen de impacto por caso de uso (con DCP + orquestación)

| Caso de uso | Overhead Kevin | Ahorro Kevin | DCP poda | Delta neto (Kevin) | % impacto |
|---|---|---|---|---|---|
| CU-01 Track simple, proyecto nuevo | 0 | 0 | -600 | 0 | 0% |
| CU-02 Track bugfix, proyecto maduro | +500 | -1800 | -4000 | -1300 | -8% |
| CU-03 Track feature media, proyecto maduro | +4800 | -9100 | -12000 | -2600 | -5% |
| CU-04 Track migración, 3 sesiones | +4900 | -29500 | -48000 | -24900 | -12% |
| CU-05 Track autónomo largo, 3 compactions | +6800 | -18600 | -35000 | -2500 | -2% |
| CU-06 10 Tracks similares en secuencia | +4100 | -17600 | -100000 | -13500 | -8.4% |
| CU-07 Track trivial sin errores | +300 | 0 | -800 | +300 | +9% |
| CU-08 Track code review | +2100 | -3700 | -7000 | -1600 | -6% |
| CU-09 Track feature compleja, muy maduro | +7500 | -26300 | -30000 | -15500 | -14% |
| CU-10 Peor caso (trivial, nuevo) | 0 | 0 | 0 | 0 | 0% |

**Promedio ponderado** (excluyendo CU-10 que es 0): **-6100 tokens/sesión, -7.2%**

**Promedio solo proyectos maduros** (CU-02 a CU-09): **-7700 tokens/sesión, -7.6%**

---

## 9. Impacto en costos (USD estimado)

Asumiendo pricing promedio de modelos (jun 2026):

| Modelo | Input $/1M tokens | Output $/1M tokens |
|---|---|---|
| Claude Sonnet 4 | $3 | $15 |
| GPT-5 | $5 | $15 |
| Claude Haiku 4 | $0.25 | $1.25 |
| Gemini 3 Flash | $0.15 | $0.60 |

### 9.1 Ahorro mensual estimado (usuario intensivo con orquestación)

| Métrica | Valor |
|---|---|
| Sesiones/mes | 40 (conductor: 2 Tracks/día × 20 días) |
| Tokens ahorrados/sesión (promedio) | -7700 |
| Tokens ahorrados/mes | -308000 |
| Ahorro USD/mes (Sonnet 4, input) | -$0.92 |
| Ahorro USD/mes (GPT-5, input) | -$1.54 |
| Ahorro USD/mes (Sonnet 4, 30% output) | -$0.92 + (-$1.39) = -$2.31 |

**Nota**: el ahorrado en USD parece pequeño porque los tokens ahorrados son input (más baratos). El valor real está en:
- **Tiempo ahorrado**: -2500 tokens/sesión = ~2-5 minutos menos de espera por sesión. 40 sesiones × 3 min = **2 horas/mes ahorradas**.
- **Iteraciones evitadas**: 3-10 iteraciones evitadas/sesión = menos frustración, menos contexto roto.
- **Calidad mejorada**: lecciones inyectadas = menos errores repetidos = código de mayor calidad.

### 9.2 Overhead mensual (peor caso, proyecto nuevo)

| Métrica | Valor |
|---|---|
| Sesiones/mes (proyecto nuevo) | 20 |
| Overhead/sesión (proyecto nuevo) | +200-500 |
| Overhead/mes | +4000-10000 |
| Costo overhead/mes (Sonnet 4, input) | +$0.012-$0.03 |

**El overhead en USD es despreciable** (< $0.05/mes). El "costo" real de Kevin es el espacio de contexto que ocupa, no el dinero.

---

## 10. Recomendaciones para maximizar el balance Kevin + DCP

### 10.1 Configuración óptima del stack

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-conductor",              // Orquesta Tracks
    "opencode-dynamic-context-pruning",// Poda contexto stale
    "kevin"                            // Aprende de errores
  ]
}
```

Este stack maximiza la sinergia:
- **Conductor** estructura el trabajo → menos mensajes del usuario → menos overhead de Kevin.
- **DCP** poda contexto → más espacio para lecciones de Kevin → más valor por token inyectado.
- **Kevin** aprende de fallos → evita iteraciones → complementa DCP (que no sabe qué evitar, solo poda).

### 10.2 Ajuste de budgets (v0.1.1 recomendado)

Con DCP liberando espacio, Kevin puede permitirse budgets de injection más grandes sin riesgo de llenar el contexto:

```jsonc
{
  "kevin": {
    "injection": {
      "prePromptBudget": 1200,   // default 1500, reducir ligeramente
      "compactingBudget": 2000   // mantener, DCP libera espacio
    }
  }
}
```

### 10.3 Inyección condicional inteligente (v0.1.1)

Con orquestación, la mayoría de mensajes del usuario son instrucciones de alto nivel. Kevin debería inyectar más agresivamente en el primer mensaje (donde el agente necesita contexto del proyecto) y menos en clarificaciones:

- **Primer mensaje de Track**: budget 1500 tokens (contexto completo del proyecto).
- **Clarificaciones**: budget 500 tokens (solo lecciones más relevantes).
- **Mensajes triviales ("sí", "continua")**: 0 tokens (no inyectar).

### 10.4 Coordinación con Conductor (v0.2)

Kevin debería detectar cuando Conductor inicia un nuevo Track (`/conductor:newTrack`) e inyectar lecciones específicas del tipo de Track:
- Bugfix Track → inyectar lecciones de bugs similares.
- Feature Track → inyectar decisiones de arquitectura relevantes.
- Migración Track → inyectar lecciones de migraciones anteriores.

### 10.5 Medición real (v0.1.0)

Añadir a `kevin_status`:
- `tokens_injected_pre_prompt_total`: tokens inyectados en system.transform.
- `tokens_injected_compacting_total`: tokens inyectados en compacting.
- `iterations_estimated_avoided`: iteraciones evitadas estimadas (basado en lecciones inyectadas que coinciden con fallos posteriores).

Esto permite al usuario medir el impacto real y ajustar budgets.

---

## 11. Conclusión

**¿Tiene Kevin v0.1.0 mucho impacto en el número de tokens consumidos cuando se usa con DCP + orquestación?**

**Respuesta**: el impacto neto es **positivo (ahorro de tokens) en prácticamente todos los escenarios realistas** una vez el proyecto acumula 15+ memorias (sesión 2-3). El overhead es marginal en proyectos nuevos y el ahorro escala con la madurez.

| Situación | Impacto | Magnitud |
|---|---|---|
| Proyecto nuevo, sesión 1 | Neutro | 0 tokens (sin memorias que inyectar) |
| Proyecto joven, sesión 2-3 | Break-even | ±0 a -1800 tokens |
| Proyecto maduro, Track bugfix | Ahorro | -1300 a -3000 tokens/sesión |
| Proyecto maduro, Track feature | Ahorro | -2600 a -15500 tokens/sesión |
| Proyecto maduro, Track migración multi-sesión | Ahorro grande | -24900 tokens total |
| Track trivial sin errores | Overhead marginal | +300 tokens |
| 10 Tracks similares en secuencia | Ahorro | -13500 tokens (-8.4%) |

**La combinación Kevin + DCP + Conductor es sinérgica**:
- Conductor reduce mensajes del usuario → reduce overhead de Kevin.
- DCP libera espacio de contexto → Kevin inyecta más valor por token.
- Kevin aprende de fallos → evita iteraciones que ni Conductor ni DCP pueden prevenir.

**El break-even llega en sesión 2-3** (vs sesión 5-15 sin orquestación), porque la orquestación genera más observación (más tool calls) y más compactions (sesiones más largas), acelerando la acumulación de lecciones.

**Recomendación**: usar Kevin + DCP + Conductor como stack base. El overhead de Kevin es compensado desde la sesión 2-3, y el stack completo ofrece la mejor experiencia de desarrollo asistido por IA disponible en el ecosistema OpenCode.

---

## 12. Apéndice: metodología de estimación (actualizada)

Las estimaciones se basan en:

1. **Patrón de uso orquestado**: 1-3 mensajes del usuario por sesión (instrucción inicial + 0-2 clarificaciones). 50-200 tool calls autónomos por Track.
2. **DCP pruning**: 30-40% del contexto autónomo es prunable (reads ya consumidos, bash outputs viejos). DCP reduce compactions en 30-50%.
3. **Compactions**: 1-3 por sesión media-larga con DCP (vs 2-5 sin DCP).
4. **Budget de injection Kevin**: 1500 tokens pre-prompt, 2000 compacting. Promedio real: 400-1200 pre-prompt (no siempre se llena el budget).
5. **Memoria típica**: 30-100 tokens. 3-8 memorias relevantes por prompt en proyecto maduro.
6. **Iteración evitada**: 800-1500 tokens (bash output + razonamiento + edit + retry).
7. **Re-exploración post-compaction**: 3000-8000 tokens sin Kevin, 500-1500 con Kevin.
8. **Conductor overhead**: spec.md (500-1000 tokens) + plan.md (500-1500 tokens) persistidos en contexto.

**Estas son estimaciones basadas en patrones típicos.** El impacto real variará según el modelo, proyecto, y patrón de uso. La recomendación de §10.5 (medición real con `kevin_status`) es la forma de obtener datos reales.

---

## Referencias

- `docs/Kevin_Plan.md` — Plan de implementación Kevin v0.1.0
- `docs/Kevin_Task.md` — Lista de tareas Kevin v0.1.0
- https://opencode.ai/docs/plugins — Hooks API
- https://opencode.ai/docs/ecosystem — DCP, Conductor
- https://github.com/derekbar90/opencode-conductor — Context→Spec→Plan→Implement
- https://github.com/Tarquinen/opencode-dynamic-context-pruning — DCP
