import index from "./index.html";
import { createWs, registerDoc } from "@blueshed/delta/server";
import type { BoardDoc } from "./src/types";

// JSON-file backend — the smallest delta backend that fits. Graduate to
// SQLite/Postgres per the delta-doc skill when queries or multi-process
// fan-out demand it; the browser code does not change.
const ws = createWs();

await registerDoc<BoardDoc>(ws, "board:main", {
  file: "./board.json",
  empty: { messages: {} },
});

const server = Bun.serve({
  port: 3000,
  routes: { "/": index, [ws.path]: ws.upgrade },
  websocket: ws.websocket,
  development: { hmr: true },
});
ws.setServer(server);

console.log(`__NAME__ → http://localhost:${server.port}`);
