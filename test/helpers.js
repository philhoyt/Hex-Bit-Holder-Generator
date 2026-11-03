// Shared bits for the tests: a fresh state with rows, mesh checks, and a hash of exported bytes.
import { createState, makeRow } from "../src/state.js";
import { createExport, rowSpecs, zip } from "../src/export.js";
import { layoutModel, buildHolder } from "../src/geometry.js";

export function fresh(opts, rows) {
  var S = Object.assign(createState(), opts || {}), id = 1;
  (rows || [{}]).forEach(function (r) { S.rows.push(makeRow(id++, r)); });
  S.selId = S.rows.length ? S.rows[0].id : null;
  return { S: S, ex: createExport(S), model: function () { return layoutModel(S, rowSpecs(S)); }, build: function () { return buildHolder(layoutModel(S, rowSpecs(S))); } };
}

// Every directed edge must be matched by the same number of edges running the other way: true for one closed shell
// and for a union of closed shells (the letters). Also flags triangles with no area.
export function meshErrors(tris) {
  var edges = {}, errs = [], key = function (p) { return p[0] + "," + p[1] + "," + p[2]; };
  tris.forEach(function (t, i) {
    var a = t[0], b = t[1], c = t[2];
    var ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    if (Math.sqrt(nx * nx + ny * ny + nz * nz) < 1e-9) errs.push("degenerate triangle " + i);
    [[a, b], [b, c], [c, a]].forEach(function (e) { var k = key(e[0]) + "|" + key(e[1]); edges[k] = (edges[k] || 0) + 1; });
  });
  Object.keys(edges).forEach(function (k) {
    var rev = k.split("|").reverse().join("|");
    if (edges[k] !== (edges[rev] || 0)) errs.push("edge " + k + " used " + edges[k] + "x, reverse " + (edges[rev] || 0) + "x");
  });
  return errs;
}

export function shoelace(poly) { var a = 0; for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return a / 2; }

// Two FNV-style passes plus the byte count, the same checksum the browser probe computes when baselines are recorded.
export async function hashBytes(u) {
  var h1 = 0x811c9dc5, h2 = 0x1000193;
  for (var i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 0x01000193) >>> 0; h2 = Math.imul(h2 ^ u[i], 0x9E3779B1) >>> 0; }
  return h1.toString(16) + h2.toString(16) + ":" + u.length;
}
export async function hashZip(files) { return hashBytes(new Uint8Array(await zip(files).arrayBuffer())); }

export async function unzip(files) { // names and STL triangle counts of a file list, via the real zip bytes
  var u = new Uint8Array(await zip(files).arrayBuffer()), dv = new DataView(u.buffer), out = [], o = 0;
  while (o + 30 <= u.length && dv.getUint32(o, true) === 0x04034b50) {
    var size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), el = dv.getUint16(o + 28, true);
    var name = new TextDecoder().decode(u.subarray(o + 30, o + 30 + nl)), start = o + 30 + nl + el;
    out.push({ name: name, size: size, tris: name.endsWith(".stl") ? new DataView(u.buffer, start).getUint32(80, true) : null, text: name.endsWith(".txt") ? new TextDecoder().decode(u.subarray(start, start + size)) : null });
    o = start + size;
  }
  return out;
}
