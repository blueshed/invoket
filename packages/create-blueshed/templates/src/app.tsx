import { provide, list, when, mount } from "@blueshed/railroad";
import { connectWs, WS, openDoc } from "@blueshed/delta/client";
import type { BoardDoc, Message } from "./types";

provide(WS, connectWs("/ws"));
const doc = openDoc<BoardDoc>("board:main");

function Board() {
  const messages = doc.data.map((d) => (d ? Object.values(d.messages) : []));
  let input: HTMLInputElement | null = null;

  async function send() {
    const text = input?.value.trim();
    if (!text || !input) return;
    input.value = "";
    // Send only — no local append. The op echoes back through doc.data
    // and renders itself; touching the DOM here would show it twice.
    await doc.send([
      {
        op: "add",
        path: `/messages/${crypto.randomUUID()}`,
        value: { author: "me", text, at: new Date().toISOString() },
      },
    ]);
  }

  return when(
    doc.data,
    () => (
      <div class="board">
        <h1>__NAME__</h1>
        <div class="log">
          {list(
            messages,
            (m: Message) => m.at + m.author,
            (m$) => (
              <div class="msg">
                <b>{m$.map((m) => m.author)}</b> <span>{m$.map((m) => m.text)}</span>
              </div>
            ),
          )}
        </div>
        <form
          onsubmit={(e: Event) => {
            e.preventDefault();
            void send();
          }}
        >
          <input ref={(el: HTMLInputElement) => (input = el)} placeholder="Say something…" />
          <button type="submit">Send</button>
        </form>
      </div>
    ),
    () => <div>connecting…</div>,
  );
}

mount(document.getElementById("root")!, () => <Board />);
