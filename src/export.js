// Names and files: the STL and zip writers, the file stem, the OpenSCAD settings block, the fit test.
// createExport(S) binds the naming to the app state; the writers are pure.
import { SIZES, sizeOf, sizeName } from "./state.js";
import { cleanLabel } from "./font.js";
import { layoutModel, buildHolder } from "./geometry.js";

// ---------------------------------------------------------------- file formats
export function toSTL(tris, label) {
  var buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  var head = "Hex bit holder " + label;
  for (var i = 0; i < head.length && i < 80; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  var o = 84;
  tris.forEach(function (t) {
    var a = t[0], b = t[1], c = t[2];
    var ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    [nx/l, ny/l, nz/l].concat(a, b, c).forEach(function (v) { dv.setFloat32(o, v, true); o += 4; });
    dv.setUint16(o, 0, true); o += 2;
  });
  return new Uint8Array(buf);
}
var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zip(files) {
  var enc = new TextEncoder(), locals = [], central = [], offset = 0;
  files.forEach(function (f) {
    var name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data), size = data.length;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    locals.push(new Uint8Array(lh.buffer), name, data);
    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  });
  var cSize = central.reduce(function (s, a) { return s + a.length; }, 0);
  var end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
  return new Blob(locals.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
}

// ---------------------------------------------------------------- bound to the app state
export function rowSpecs(S) { return S.rows.map(function (r) { var mm = sizeOf(r), sizes = []; for (var i = 0; i < r.count; i++) sizes.push(mm); return { sizes: sizes, labels: r.labels }; }); }
export function createExport(S) {
  function model() { return layoutModel(S, rowSpecs(S)); }
  function sizeTag(r) { if (r.size === "custom") return sizeOf(r) + "mm"; return SIZES.find(function (q) { return q.key === r.size; }).tag; }
  function hasLabels() { return S.rows.some(function (r) { return r.labels.some(function (l) { return cleanLabel(l); }); }); }
  function fileStem() {
    if (!S.rows.length) return "hex-holder-empty";
    var tags = S.rows.map(sizeTag), counts = S.rows.map(function (r) { return r.count; });
    var same = tags.every(function (t) { return t === tags[0]; }), sameN = counts.every(function (n) { return n === counts[0]; });
    var s = "hex-holder-" + (same ? tags[0] : "mixed") + "-" + (sameN ? counts[0] + "x" + S.rows.length : counts.join("+")) + "-" + Math.round(S.height) + "mm";
    if (S.through) s += "-thru";
    if (S.slots) s += "-slots";
    if (hasLabels()) s += "-lbl";
    return s;
  }
  function describe(r) {
    var bits = [r.count + " × " + sizeName(r)], n = r.labels.filter(function (l) { return cleanLabel(l); }).length;
    if (n) bits.push(n + " label" + (n > 1 ? "s" : ""));
    return bits.join(" · ");
  }
  function codeOf() {
    if (!S.rows.length) return "No rows";
    var counts = S.rows.map(function (r) { return r.count; }), sameN = counts.every(function (n) { return n === counts[0]; });
    return sameN ? counts[0] + " × " + S.rows.length : counts.join(" + ");
  }
  function sizeSummary() {
    var names = []; S.rows.forEach(function (r) { var nm = sizeName(r); if (names.indexOf(nm) < 0) names.push(nm); });
    return names.join(" + ");
  }
  function num(v) { return Math.round(v * 1000) / 1000; }
  function scadText() {
    var rows = S.rows.map(function (r) { return "[" + num(sizeOf(r)) + ", " + r.count + "]"; }).join(", ");
    var labels = S.rows.map(function (r) { var l = []; for (var i = 0; i < r.count; i++) l.push('"' + cleanLabel(r.labels[i]).replace(/[\\"]/g, "") + '"'); return "[" + l.join(", ") + "]"; }).join(", ");
    return [
      "rows = [" + rows + "];  // [bit size across the flats, holes] per row, front row first",
      "labels = [" + labels + "];  // one text per hole, front row first, left to right",
      "height = " + num(S.height) + ";", "through = " + !!S.through + ";", "floor_t = " + num(S.floorT) + ";", "chamfer = " + num(S.chamfer) + ";",
      "slots = " + !!S.slots + ";", "slot_pct = " + num(S.slotPct) + ";", "slot_w = " + num(S.slotW) + ";", "corner_r = " + num(S.cornerR) + ";",
      "clearance = " + num(S.clearance) + ";", "wall = " + num(S.wall) + ";", "edge = " + num(S.edge) + ";",
      "label_cap = " + num(S.labelCap) + ";", "label_raise = " + num(S.labelRaise) + ";"
    ].join("\n");
  }
  function stlFile() { var stem = fileStem(); return { name: stem + ".stl", data: toSTL(buildHolder(model()), stem) }; }
  // A short strip of four holes at different clearances, labeled in hundredths of a millimeter, to pick the one that grips.
  function fitTestFiles() {
    var base = S.rows.length ? S.rows[0] : { size: "1/4", custom: 6.35 }, mm = sizeOf(base), steps = [0.1, 0.15, 0.2, 0.25];
    var T = Object.assign({}, S, { clearance: 0, height: Math.min(S.height, 10), through: false, slots: false, rows: [] });
    var M = layoutModel(T, [{ sizes: steps.map(function (c) { return mm + 2 * c; }), labels: steps.map(function (c) { return String(Math.round(c * 100)); }) }]);
    var stem = "hex-holder-fit-test-" + sizeTag(base);
    return { name: stem + ".zip", files: [
      { name: stem + ".stl", data: toSTL(buildHolder(M), stem) },
      { name: "README.txt", data: [
        "Hex bit holder fit test", "",
        "One strip, four holes for " + sizeName(base) + " bits, each with a different clearance per side:",
        steps.map(function (c) { return "  " + Math.round(c * 100) + "  " + c.toFixed(2) + " mm"; }).join("\n"), "",
        "Print it flat, no supports. Push a bit into each hole.",
        "Pick the hole that grips the bit without forcing, and enter its clearance under Fit and print > Hole clearance per side.", "",
        "Wall " + S.wall + " mm, edge " + S.edge + " mm, flare " + S.chamfer + " mm, as set in the app."
      ].join("\n") }
    ] };
  }
  return { model: model, fileStem: fileStem, describe: describe, codeOf: codeOf, sizeSummary: sizeSummary, scadText: scadText, stlFile: stlFile, fitTestFiles: fitTestFiles, hasLabels: hasLabels };
}
