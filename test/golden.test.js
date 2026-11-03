// Golden exports. Each checksum was recorded by building the same holder in Chrome through the real modules and is
// checked here in Node, so the two engines agree byte for byte. If one changes, the geometry or the export format
// changed; re-record only on purpose, and confirm the browser produces the same value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fresh, hashBytes, hashZip } from "./helpers.js";

test("two rows of eight 1/4 in holes, defaults", async () => {
  const { ex } = fresh({}, [{ count: 8 }, { count: 8 }]);
  assert.equal(ex.fileStem(), "hex-holder-1-4in-8x2-15mm");
  assert.equal(await hashBytes(ex.stlFile().data), "c66a407c4d547c9e:35084");
});

test("labeled driver set with flex slots", async () => {
  const { ex } = fresh({ slots: true }, [{ count: 6, labels: ["PH1", "PH2", "PH3", "SL4", "SL6", "SQ2"] }, { count: 6, labels: ["T10", "T15", "T20", "T25", "T30", "H4"] }]);
  assert.equal(ex.fileStem(), "hex-holder-1-4in-6x2-15mm-slots-lbl");
  assert.equal(await hashBytes(ex.stlFile().data), "497c32bdb0d65c59:174084");
});

function mixed() {
  return fresh({ through: true, chamfer: 0.8, cornerR: 4, clearance: 0.2, wall: 3, edge: 4, height: 20, slots: true, slotPct: 50 },
    [{ count: 5 }, { size: "4mm", count: 7, labels: ["A", "B"] }, { size: "custom", custom: 6.5, count: 3 }]);
}
test("three sizes, through holes, big flare and corners, changed fit settings, half-depth slots", async () => {
  const { ex } = mixed();
  assert.equal(ex.fileStem(), "hex-holder-mixed-5+7+3-20mm-thru-slots-lbl");
  assert.equal(await hashBytes(ex.stlFile().data), "30701c5339854d0f:81884");
});

test("fit test kit with changed fit settings", async () => {
  const z = mixed().ex.fitTestFiles();
  assert.equal(z.name, "hex-holder-fit-test-1-4in.zip");
  assert.equal(await hashZip(z.files), "6a09dfc65ede68a8:44930");
});
