import { Context } from "invoket/context";
import { Ctx, Session } from "invoket/agent";

export class Tasks {
  ctx = new Ctx();
  session = new Session();

  /** Typecheck and run the test suite — the gate, keep it green */
  async check(c: Context) {
    await c.run("bunx tsc --noEmit");
    await c.run("bun test", { stream: true });
  }
}
