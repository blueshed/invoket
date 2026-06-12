import { test, expect } from "bun:test";
import { applyOps } from "@blueshed/delta/core";
import type { BoardDoc } from "../src/types";

test("board ops apply to the doc shape", () => {
  const doc: BoardDoc = { messages: {} };
  applyOps(doc, [
    {
      op: "add",
      path: "/messages/x",
      value: { author: "a", text: "hi", at: "2026-01-01T00:00:00Z" },
    },
  ]);
  expect(doc.messages["x"]).toMatchObject({ text: "hi" });
});
