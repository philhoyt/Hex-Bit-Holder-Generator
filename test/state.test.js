import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, restoreState, makeRow, sizeOf, sizeName } from "../src/state.js";

test("restore drops bad rows, resets bad fields, and clamps numbers", () => {
  const S = createState();
  const next = restoreState(S, { height: 999, through: "yes", wall: "abc", chamfer: -3, selId: 7, rows: [
    { id: 1, size: "1/4", count: 50, labels: ["ph1", 5, "t25"] },
    { id: 2, size: "weird", custom: 100, count: "3" },
    { id: 1, size: "4mm", count: 2 },
    { id: 0, size: "4mm", count: 2 },
    null, "junk", { id: 7, size: "custom", custom: 7.5, count: 2, labels: ["ONE", "", ""] }
  ] });
  assert.equal(S.height, 60); assert.equal(S.through, false); assert.equal(S.wall, 2.4); assert.equal(S.chamfer, 0);
  assert.deepEqual(S.rows.map(r => [r.id, r.size, r.count, r.labels]), [[1, "1/4", 30, ["PH1", "", "T25"]], [2, "1/4", 8, []], [7, "custom", 2, ["ONE"]]]);
  assert.equal(S.rows[1].custom, 25); assert.equal(S.selId, 7); assert.equal(next, 8);
});

test("a missing or empty save leaves the defaults", () => {
  const S = createState();
  assert.equal(restoreState(S, null), 1); assert.equal(restoreState(S, {}), 1);
  assert.equal(S.rows.length, 0); assert.equal(S.selId, null); assert.equal(S.height, 15);
});

test("sizes resolve by key and custom sizes stay in range", () => {
  assert.equal(sizeOf(makeRow(1, { size: "5/16" })), 7.9375);
  assert.equal(sizeOf(makeRow(1, { size: "custom", custom: 0.5 })), 2);
  assert.equal(sizeName(makeRow(1, { size: "custom", custom: 6.5 })), "6.5 mm");
  const a = makeRow(1), b = makeRow(2); a.labels.push("X");
  assert.deepEqual(b.labels, []); // rows never share label arrays
});
