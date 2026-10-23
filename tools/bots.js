// Jugadores de prueba para ensayar sin gente.
// Uso: node tools/bots.js [cantidad=7] [url=http://localhost]
// Entran repartidos entre los 4 roles, responden en su canal y marcan LISTO al rotar.
const { io } = require("socket.io-client");
const N = Number(process.argv[2]) || 7;
const URL = process.argv[3] || "http://localhost";
const ROLES = ["modelo", "arnes", "revisor", "thinking"];
const LINES = {
  thinking: ["Plan: base con triángulos, 30 cm de largo.", "Reforcemos el centro con doble capa.", "Hagamos un arco debajo para repartir el peso."],
  modelo: ["1. Corta 6 palitos de 10 cm. 2. Une 3 en triángulo.", "Pon una segunda capa encima del tablero.", "Dobla 3 tallarines en arco bajo el centro."],
  revisor: ["El lado izquierdo se dobla.", "Las uniones están firmes.", "El tablero se hunde en el centro."],
};
const LISTEN = { thinking: ["A", "D"], modelo: ["B"], revisor: ["C"] };

for (let i = 0; i < N; i++) {
  const role = ROLES[i % 4], s = io(URL, { forceNew: true });
  let seen = new Set(), line = 0, joined = false, readySent = false;
  s.on("connect", () => s.emit("hello", { deviceId: "bot-" + i }, () => {
    if (!joined) s.emit("join", { nick: "bot" + (i + 1), role }, () => (joined = true));
  }));
  s.on("view", (v) => {
    if (v.phase === "rotate" && v.rotation && v.rotation.incoming && !v.rotation.incoming.ready && !readySent) {
      readySent = true;
      setTimeout(() => s.emit("ready", { personId: v.rotation.incoming.id }, () => {}), 1500 + Math.random() * 5000);
    }
    if (v.phase !== "rotate") readySent = false;
    if (v.phase !== "activity" || !v.msgs || v.paused) return;
    const myRole = v.you.role, listen = LISTEN[myRole] || [];
    const fresh = v.msgs.filter((m) => !seen.has(m.id));
    fresh.forEach((m) => seen.add(m.id));
    if (v.channel && fresh.some((m) => !m.mine && listen.includes(m.ch))) {
      const arr = LINES[myRole] || LINES.revisor;
      setTimeout(() => s.emit("send", { text: arr[line++ % arr.length] }, () => {}), 2500 + Math.random() * 3500);
    }
  });
}
console.log(`${N} bots conectándose a ${URL}…`);
