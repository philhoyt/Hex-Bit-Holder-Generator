// The mesh is checked two ways: every edge must be shared by two faces running opposite ways (watertight), and the
// enclosed volume must match what the holder's dimensions say it should be.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedVolume, hexArea, roundedRect, earClip, insertCuts, notch, hexPoints, sincos, COS30 } from "../src/geometry.js";
import { fresh, meshErrors, shoelace } from "./helpers.js";

var SQ = { cornerR: 0, chamfer: 0, labelCap: 3 }; // square corners and no flare: the volume is easy to work out
function close(a, b, tol) { assert.ok(Math.abs(a - b) <= (tol || 1e-6) * Math.max(1, Math.abs(b)), a + " vs " + b); }

test("deterministic trig agrees with Math to 1e-13", () => {
  for (var a = -7; a < 7; a += 0.37) { var sc = sincos(a); close(sc[0], Math.cos(a), 1e-13); close(sc[1], Math.sin(a), 1e-13); }
});

test("hex points are the right size and the notches are the right halves", () => {
  var h = hexPoints(10, 20, 3), R = 3 / COS30;
  close(h[0].x, 10 + R); close(h[1].y, 23); assert.equal(h.length, 6);
  var below = notch(h, 20, "below"), above = notch(h, 20, "above");
  assert.deepEqual(below.map(p => [+p.x.toFixed(4), p.y]), [[+(10 + R).toFixed(4), 20], [+(10 + R / 2).toFixed(4), 17], [+(10 - R / 2).toFixed(4), 17], [+(10 - R).toFixed(4), 20]]);
  assert.deepEqual(above.map(p => p.y), [20, 23, 23, 20]);
  var cut = insertCuts(h, [19, 21]);
  assert.equal(cut.length, 10);
  assert.equal(cut.filter(p => p.y === 19).length, 2);
  assert.equal(notch(cut, 21, "above").length, 4);
});

test("ear clipping keeps collinear points and covers the polygon", () => {
  var O = roundedRect(40, 20, 3, 6), cut = insertCuts(O, [5, 10, 15]);
  assert.equal(cut.length, O.length + 6);
  var tris = earClip(cut), area = tris.reduce((s, t) => s + shoelace(t), 0);
  close(area, shoelace(O));
  var used = {}; tris.forEach(t => t.forEach(p => { used[p.x + "," + p.y] = 1; }));
  assert.equal(Object.keys(used).length, cut.length); // every inserted point is a vertex of some triangle
});

test("through holes, square corners: watertight, volume is the slab minus the hex prisms", () => {
  var t = fresh(Object.assign({ through: true }, SQ), [{ count: 4 }]), tris = t.build(), M = t.model();
  assert.deepEqual(meshErrors(tris), []);
  var ir = (6.35 + 0.3) / 2;
  close(M.W, 3 * (2 * ir / COS30 + 2.4) + 2 * ir / COS30 + 6); close(M.D, 2 * ir + 6);
  close(signedVolume(tris), M.W * M.D * 15 - 4 * hexArea(ir) * 15);
});

test("closed bottom leaves a floor under each hole", () => {
  var t = fresh(SQ, [{ count: 3 }, { count: 2, size: "4mm" }]), tris = t.build(), M = t.model();
  assert.deepEqual(meshErrors(tris), []);
  var a = hexArea((6.35 + 0.3) / 2), b = hexArea((4 + 0.3) / 2);
  close(signedVolume(tris), M.W * M.D * 15 - (3 * a + 2 * b) * (15 - 1.2));
});

test("rounded corners and a flared mouth: watertight, volume follows the outline and the flare", () => {
  var t = fresh({ cornerR: 2, chamfer: 0.5 }, [{ count: 5 }, { count: 5 }]), tris = t.build(), M = t.model();
  assert.deepEqual(meshErrors(tris), []);
  var ir = (6.35 + 0.3) / 2, c = 0.5, area = shoelace(roundedRect(M.W, M.D, 2, 6));
  var flare = 2 * Math.sqrt(3) * (ir * c * c + c * c * c / 3); // the frustum ring each mouth removes
  close(signedVolume(tris), area * 15 - 10 * hexArea(ir) * (15 - 1.2) - 10 * flare);
});

test("flex slots cut through each row and out the sides", () => {
  var t = fresh(Object.assign({ through: true, slots: true, slotPct: 60, slotW: 1.6 }, SQ), [{ count: 3 }, { count: 4, size: "5mm" }]);
  var tris = t.build(), M = t.model();
  assert.deepEqual(meshErrors(tris), []);
  var depth = 9, vol = M.W * M.D * 15;
  M.rows.forEach(r => {
    var ir = r.holes[0].ir, R = ir / COS30, n = r.holes.length;
    vol -= n * hexArea(ir) * 15;
    vol -= (M.s * M.W - n * (2 * R * M.s - M.s * M.s / (2 * Math.sqrt(3)))) * depth; // the slot, less where it crosses the holes
  });
  close(signedVolume(tris), vol);
});

test("slots with a flare and a floor stay watertight", () => {
  var t = fresh({ slots: true, chamfer: 0.6, cornerR: 3 }, [{ count: 6 }, { count: 2, size: "5/16" }, { count: 8, size: "4mm" }]);
  var tris = t.build();
  assert.deepEqual(meshErrors(tris), []);
  assert.ok(signedVolume(tris) > 0);
});

test("labels add raised letters in a band in front of the row and shrink to fit the pitch", () => {
  var plain = fresh({}, [{ count: 4 }]), lab = fresh({}, [{ count: 4, labels: ["PH1", "PH2", "T25 TORX LONG", ""] }]);
  var Mp = plain.model(), Ml = lab.model();
  close(Ml.D - Mp.D, 3 + 1.2 + 0.5); // one label band
  assert.equal(Ml.rows[0].holes[0].shown, "PH1"); assert.equal(Ml.rows[0].holes[0].cap, 3);
  var longOne = Ml.rows[0].holes[2];
  assert.ok(longOne.shown.length < longOne.text.length && longOne.dropped > 0 && longOne.cap >= 2);
  var tris = lab.build();
  assert.deepEqual(meshErrors(tris), []);
  assert.ok(signedVolume(tris) > signedVolume(plain.build()));
});

test("settings are clamped so the geometry stays valid", () => {
  var t = fresh({ chamfer: 2, wall: 1, edge: 1, slots: true, slotW: 4, slotPct: 90, through: true }, [{ count: 2, size: "4mm" }]), M = t.model();
  close(M.c, 0.4); close(M.s, 2 * (4.3 / 2) - 0.6); assert.ok(M.zS >= 0.5);
  assert.deepEqual(meshErrors(t.build()), []);
});
