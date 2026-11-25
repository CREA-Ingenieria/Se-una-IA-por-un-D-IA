# Rediseño dinámica · Sé una IA por un d-IA

**Objetivo:** el rol deja de estar atado al iPad y pasa a estar atado a la persona (su celular). Al rotar, el celular indica *"ahora eres REVISOR, ve al puesto 12"* y carga el historial de ese slot.

**Fecha límite:** desarrollo miércoles en la noche · versión final desplegada jueves 4:00 pm.

**Fuera de alcance (por ahora):** dos salas simultáneas. Solo va el cambio de dinámica.

**Estado general:** refactor núcleo completo y validado (smoke + carga de 72 jugadores con 3 rotaciones, todo verde). Falta solo la prueba manual con celulares reales (T5.5) y, opcional, la grilla numerada pre-creada (T4.2).

**Rama:** `rediseno-dinamica` (sin commit todavía; pendiente de aprobación).

---

## Resumen de fases

| Fase | Qué | Riesgo | Estado |
|---|---|---|---|
| 0 | Red de seguridad (branch + baseline) | Bajo | ✅ Hecho |
| 1 | Modelo de datos: asientos vs personas | Alto | ✅ Hecho |
| 2 | Identidad: el navegador = la persona | Alto | ✅ Hecho |
| 3 | Rotación centrada en la persona | Alto | ✅ Hecho |
| 4 | Escala y puestos numerados | Medio | 🟡 T4.1/4.3 hechos · T4.2 diferido |
| 5 | Carga real, datos y validación final | Medio | 🟡 T5.1–5.4 hechos · T5.5 (manual) pendiente |

---

## Fase 0 — Red de seguridad

- [x] **T0.1** Branch `rediseno-dinamica` desde `main`.
- [x] **T0.2** Baseline antes de tocar nada: `npm test` pasó en verde.

## Fase 1 — Modelo de datos: asientos (slots) vs personas

- [x] **T1.1** Asientos como entidad (`id, pc, role, team, personId`) + persona con `browserId`/`online`; helpers `personByBrowser`, `seatOfPerson`, `seatOnline`, `onlineCount`.
- [x] **T1.2** `SNAPSHOT_VERSION` → 4 (los respaldos v3 no cargan; arranca sesión nueva sin crash).

## Fase 2 — Identidad: el navegador = la persona

- [x] **T2.1** `hello { browserId }` → persona → su asiento (`personView`).
- [x] **T2.2** `join` crea persona con `browserId` y la asigna a un asiento libre.
- [x] **T2.3** `reclaim` simplificado: re-vincula `browserId` (ya no mueve asientos); `moveDevice` eliminado.
- [x] **T2.4** Cliente: `deviceId()` → `browserId()`; `hello`, subida de archivos (`X-Device`) y "released" actualizados.
- [x] **Validación:** smoke — reconexión por nickname y no-duplicado de nick, en verde.

## Fase 3 — Rotación centrada en la persona

- [x] **T3.1** `computeAssignment`/`finishRotation` sin cambios (ya permutan personas entre asientos; `browserId` no cambia).
- [x] **T3.2** Vista de rotación person-céntrica: *"levántate y ve al PC X · AHORA ERES {rol}"* + botón **¡YA LLEGUÉ!**. `ready` usa la persona del teléfono.
- [x] **Validación:** smoke — cada persona conserva su nick pero cambia de puesto y de rol; 1 rotación completa. Carga — 3 rotaciones seguidas con 72 jugadores, reanuda en ~360 ms.

## Fase 4 — Escala y puestos numerados

- [x] **T4.1** `MAX_TEAMS` 8 → **30** (~90 personas); el tope viaja al cliente vía `maxTeams`.
- [ ] **T4.2** _(Diferido)_ Pre-crear grilla numerada team-major desde el admin. Hoy la numeración es por orden de llegada (funcional; el admin puede reordenar). Refinamiento de UX, no bloquea el evento.
- [x] **T4.3** Panel admin ya lista por persona (nick, PC, rol, equipo, online) con assign/kick/release; funciona con el nuevo modelo.

## Fase 5 — Carga real, datos y validación final

- [x] **T5.1** `tools/bots.js` y `test/smoke.js` migrados al nuevo modelo. `npm test` verde.
- [x] **T5.2** `tools/carga.js` nuevo: 72 jugadores (24 equipos) + 3 rotaciones → **CARGA OK**, sin atrasos ni caídas.
- [x] **T5.3** Exportar historial: botón admin **Descargar historial** + endpoint `/export` (gated por token; 403 sin token). Verificado.
- [x] **T5.4** README actualizado (celulares personales, puestos numerados, rotación, export, nota de dos-salas).
- [ ] **T5.5** _(Para el miércoles)_ E2E manual con 2-3 celulares reales + una rotación en vivo, antes del despliegue final.

---

## Cómo probar localmente

```bash
npm install --omit=dev
npm start                 # servidor en http://localhost
npm test                  # prueba de humo (flujo completo)
# en otra terminal, con el servidor arriba:
node tools/carga.js 24 3 http://localhost   # 72 jugadores, 3 rotaciones
```

## Supuestos usados (confirmar si cambian)

- Personas por sala: ~70-80 → `MAX_TEAMS = 30`.
- Numeración de puestos por orden de llegada (grid pre-creada = T4.2, diferido).
- Emparejamiento revisor/arnés: regla hablada, no impuesta por el sistema.
