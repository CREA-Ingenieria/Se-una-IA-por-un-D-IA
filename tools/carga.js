// Prueba de carga: simula muchos jugadores reales (un teléfono por persona) y varias rotaciones,
// para verificar que el servidor sostiene ~70-80 personas sin atrasarse ni caerse.
// Uso: node tools/carga.js [equipos=24] [rondas=3] [url=http://localhost]
const { io } = require("socket.io-client");
const ROLES = ["modelo", "arnes", "revisor"];
const TEAMS = Number(process.argv[2]) || 24;
const ROUNDS = Number(process.argv[3]) || 3;
const URL = process.argv[4] || "http://localhost";
const N = TEAMS * 3;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (s, ev, data) => new Promise((r) => s.timeout(8000).emit(ev, data || {}, (err, res) => r(err ? { error: "timeout" } : res || {})));
const now = () => Number(process.hrtime.bigint() / 1000000n);

(async () => {
  console.log(`Carga: ${N} jugadores (${TEAMS} equipos), ${ROUNDS} rondas → ${URL}`);
  const players = [];
  const t0 = now();
  // conexión + join de todos
  for (let i = 0; i < N; i++) {
    const s = io(URL, { forceNew: true, reconnection: false });
    s.last = null; s.on("view", (v) => (s.last = v));
    await new Promise((r) => s.on("connect", r));
    await call(s, "hello", { browserId: "load-" + i });
    const r = await call(s, "join", { nick: "L" + i, role: ROLES[i % 3] });
    if (r.error) { console.log(`  FALLA join ${i}: ${r.error}`); }
    players.push(s);
    if (i % 30 === 29) process.stdout.write(`  conectados ${i + 1}/${N}\r`);
  }
  console.log(`\n  conexión + join: ${now() - t0} ms`);

  const admin = io(URL, { forceNew: true, reconnection: false });
  admin.last = null; admin.on("view", (v) => (admin.last = v));
  await new Promise((r) => admin.on("connect", r));
  await call(admin, "admin:login", { password: process.env.ADMIN_PASSWORD || "crea2026" });
  await wait(300);
  const teamsFormed = admin.last && admin.last.teams.length;
  console.log(`  equipos armados: ${teamsFormed} (esperado ${TEAMS})`);
  console.log(`  dispositivos vistos por admin: ${admin.last && admin.last.devices.length}`);

  const st = await call(admin, "admin:start", {});
  console.log(`  iniciar actividad: ${st.ok ? "ok" : "FALLA " + st.error}`);
  await call(admin, "admin:prompt", { text: "Construyan un puente de pasta que aguante un celular.", team: "all" });

  // carga de mensajes: cada modelo y revisor manda un par de mensajes
  const tMsg = now();
  for (const s of players) {
    const role = s.last && s.last.you && s.last.you.role;
    if (role === "modelo") call(s, "send", { text: "Busca 6 palitos y arma un triángulo.", to: "arnes" });
    if (role === "revisor") call(s, "send", { text: "El arnés está uniendo las piezas del centro.", to: "modelo" });
  }
  await wait(500);
  console.log(`  ráfaga de ${N} mensajes despachada en ${now() - tMsg} ms`);

  // rotaciones
  let worstRotation = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const tr = now();
    const r = await call(admin, "admin:rotate", {});
    if (!r.ok) { console.log(`  FALLA rotar ronda ${round}: ${r.error}`); break; }
    await wait(250); // que llegue la vista de rotación a todos
    const assigned = players.filter((s) => s.last && s.last.phase === "rotate" && s.last.rotation && s.last.rotation.me).length;
    for (const s of players) if (s.last && s.last.rotation && s.last.rotation.me) call(s, "ready", {});
    // esperar a que la actividad se reanude
    let back = false;
    for (let k = 0; k < 40 && !back; k++) { await wait(100); back = players.every((s) => s.last && s.last.phase === "activity"); }
    const dt = now() - tr;
    worstRotation = Math.max(worstRotation, dt);
    console.log(`  ronda ${round}: ${assigned}/${N} recibieron destino · reanudó=${back} · ${dt} ms`);
  }

  // salud final
  await wait(300);
  const online = admin.last && admin.last.devices.filter((d) => d.online).length;
  console.log(`\n  online al final: ${online}/${N}`);
  console.log(`  peor rotación: ${worstRotation} ms`);
  const ok = teamsFormed === TEAMS && st.ok && online === N && worstRotation < 15000;
  console.log(ok ? "\n  CARGA OK" : "\n  CARGA CON PROBLEMAS (revisa arriba)");
  players.forEach((s) => s.close()); admin.close();
  process.exit(ok ? 0 : 1);
})();
