import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, toSTL, zip } from "../src/export.js";
import { fresh, unzip } from "./helpers.js";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("STL is binary with an 80 byte header, a count, and 50 bytes per triangle", () => {
  const tris = [[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 1, 0], [0, 0, 1]]];
  const u = toSTL(tris, "test");
  assert.equal(u.length, 84 + 2 * 50);
  assert.equal(new DataView(u.buffer).getUint32(80, true), 2);
  assert.equal(new TextDecoder().decode(u.subarray(0, 19)), "Hex bit holder test");
  assert.ok(Math.abs(new DataView(u.buffer).getFloat32(84 + 8, true) - 1) < 1e-6); // the first triangle's normal points +z
});

test("zip round-trips names, sizes, and text", async () => {
  const files = [{ name: "a.txt", data: "hello" }, { name: "b.bin", data: new Uint8Array([1, 2, 3]) }];
  const got = await unzip(files);
  assert.deepEqual(got.map(f => [f.name, f.size]), [["a.txt", 5], ["b.bin", 3]]);
  assert.equal(got[0].text, "hello");
  const u = new Uint8Array(await zip(files).arrayBuffer());
  assert.equal(new DataView(u.buffer).getUint32(u.length - 22, true), 0x06054b50);
});

test("file names describe the holder", () => {
  const { S, ex } = fresh({}, [{ count: 8 }, { count: 8 }]);
  assert.equal(ex.fileStem(), "hex-holder-1-4in-8x2-15mm");
  assert.equal(ex.codeOf(), "8 × 2");
  S.rows[1].size = "4mm"; S.rows[1].count = 6; S.through = true; S.slots = true; S.rows[0].labels = ["ph2"];
  assert.equal(ex.fileStem(), "hex-holder-mixed-8+6-15mm-thru-slots-lbl");
  assert.equal(ex.codeOf(), "8 + 6"); assert.equal(ex.sizeSummary(), "1/4 in + 4 mm");
  assert.equal(ex.describe(S.rows[0]), "8 × 1/4 in · 1 label");
  S.rows[1].size = "custom"; S.rows[1].custom = 6.5; S.rows.pop();
  S.rows[0].size = "custom"; S.rows[0].custom = 6.5;
  assert.equal(ex.fileStem(), "hex-holder-6.5mm-8x1-15mm-thru-slots-lbl");
  S.rows = []; assert.equal(ex.fileStem(), "hex-holder-empty");
});

test("the STL file carries the model and the OpenSCAD settings carry every row", () => {
  const { S, ex } = fresh({ chamfer: 0.4 }, [{ count: 3, labels: ["A", "B\"C"] }, { count: 2, size: "5mm" }]);
  const f = ex.stlFile();
  assert.equal(f.name, "hex-holder-mixed-3+2-15mm-lbl.stl");
  assert.ok(new DataView(f.data.buffer).getUint32(80, true) > 100);
  const t = ex.scadText();
  assert.match(t, /^rows = \[\[6\.35, 3\], \[5, 2\]\];/);
  assert.match(t, /labels = \[\["A", "BC", ""\], \["", ""\]\];/);
  assert.match(t, /chamfer = 0\.4;/); assert.match(t, /through = false;/);
  S.through = true; assert.match(ex.scadText(), /through = true;/);
});

test("the fit test is one strip of four labeled holes with a README", async () => {
  const { ex } = fresh({}, [{ size: "4mm" }]);
  const z = ex.fitTestFiles(), files = await unzip(z.files);
  assert.equal(z.name, "hex-holder-fit-test-4mm.zip");
  assert.deepEqual(files.map(f => f.name), ["hex-holder-fit-test-4mm.stl", "README.txt"]);
  assert.ok(files[0].tris > 100);
  assert.match(files[1].text, /25 {2}0\.25 mm/);
});
