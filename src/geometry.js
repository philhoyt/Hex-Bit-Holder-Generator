// The holder as a triangle list ready for STL: one closed shell for the body, plus raised letters that overlap its top.
// layoutModel(S, rows) turns settings into positions; buildHolder(M) turns a model into triangles. Both are pure.
//
// The body is built from 2D regions. The outline is cut into horizontal bands at each row, hex-shaped notches are carved
// into the band edges, and each band is ear-clipped into triangles. Walls are strips between the same 2D points at two
// heights, so every vertex is shared exactly and the shell is watertight (the tests check every edge).
import { FONT, LABEL, labelUnits, labelAdvance, cleanLabel, strokeFor } from "./font.js";

var COS30 = Math.sqrt(3) / 2, TAN30 = 1 / Math.sqrt(3), EPS = 1e-9;

// ---------------------------------------------------------------- trig that gives the same bits in every engine
// Engines differ in the last bit of Math.sin and friends, which would show up in exported STL bytes and make golden
// tests engine-dependent. Reduce to [-pi/4, pi/4], then a short series in plain arithmetic. Accurate to about 1e-14.
export function sincos(a) {
  var k = Math.round(a / (Math.PI / 2)), r = a - k * (Math.PI / 2), r2 = r * r;
  var s = r * (1 - r2 / 6 * (1 - r2 / 20 * (1 - r2 / 42 * (1 - r2 / 72 * (1 - r2 / 110 * (1 - r2 / 156 * (1 - r2 / 210)))))));
  var c = 1 - r2 / 2 * (1 - r2 / 12 * (1 - r2 / 30 * (1 - r2 / 56 * (1 - r2 / 90 * (1 - r2 / 132 * (1 - r2 / 182))))));
  switch (((k % 4) + 4) % 4) { case 0: return [c, s]; case 1: return [-s, c]; case 2: return [-c, -s]; default: return [s, -c]; }
}
function hyp(a, b) { return Math.sqrt(a * a + b * b); }

// ---------------------------------------------------------------- 2D shapes
function P(x, y, side) { return { x: x, y: y, side: side }; }
// A hexagon with points along x and flats along y, counterclockwise, starting at the right point.
export function hexPoints(cx, cy, ir) {
  var R = ir / COS30;
  return [P(cx + R, cy), P(cx + R / 2, cy + ir), P(cx - R / 2, cy + ir), P(cx - R, cy), P(cx - R / 2, cy - ir), P(cx + R / 2, cy - ir)];
}
// Rounded rectangle from (0,0) to (W,D), counterclockwise, starting at the right end of the bottom edge. Each point is
// tagged with the chain it belongs to: "R" climbs the right side, "L" descends the left side. The bottom and top edges
// join the chains.
export function roundedRect(W, D, r, seg) {
  r = Math.max(0, Math.min(r, W / 2 - 0.05, D / 2 - 0.05));
  if (r < 0.05) return [P(W, 0, "R"), P(W, D, "R"), P(0, D, "L"), P(0, 0, "L")];
  var pts = [];
  function arc(cx, cy, a0, side) { for (var i = 0; i <= seg; i++) { var sc = sincos((a0 + 90 * i / seg) * Math.PI / 180); pts.push(P(cx + r * sc[0], cy + r * sc[1], side)); } }
  arc(W - r, r, -90, "R"); arc(W - r, D - r, 0, "R"); arc(r, D - r, 90, "L"); arc(r, r, 180, "L");
  return pts;
}
// The same polygon with a point inserted wherever an edge crosses one of the horizontal lines. Points already on a line stay as they are.
export function insertCuts(poly, ys) {
  var out = [];
  for (var i = 0; i < poly.length; i++) {
    var p = poly[i], q = poly[(i + 1) % poly.length], hits = [];
    out.push(p);
    ys.forEach(function (Y) {
      if ((p.y < Y && Y < q.y) || (q.y < Y && Y < p.y)) { var t = (Y - p.y) / (q.y - p.y); hits.push({ t: t, pt: P(p.x + t * (q.x - p.x), Y, p.side) }); }
    });
    hits.sort(function (a, b) { return a.t - b.t; }).forEach(function (h) { out.push(h.pt); });
  }
  return out;
}
function onLine(poly, Y) { return poly.filter(function (p) { return p.y === Y; }).sort(function (a, b) { return a.x - b.x; }); }
// The part of a hex outline that intrudes into a band whose edge runs along y = Y. "below": the band is below the line,
// so the notch is the lower part of the hex, listed right to left. "above": the upper part, listed left to right.
export function notch(ring, Y, mode) {
  var cuts = onLine(ring, Y);
  if (cuts.length !== 2) throw new Error("hex does not cross y=" + Y);
  if (mode === "below") return [cuts[1]].concat(ring.filter(function (p) { return p.y < Y; }).sort(function (a, b) { return b.x - a.x; }), [cuts[0]]);
  return [cuts[0]].concat(ring.filter(function (p) { return p.y > Y; }).sort(function (a, b) { return a.x - b.x; }), [cuts[1]]);
}
// A horizontal band of the outline between y = lo and y = hi, counterclockwise, with notches along its two edges.
// notchesHi runs right to left along the top edge, notchesLo left to right along the bottom edge.
function bandPolygon(outline, lo, hi, notchesHi, notchesLo) {
  var R = outline.filter(function (p) { return p.side === "R" && p.y >= lo && p.y <= hi; });
  var L = outline.filter(function (p) { return p.side === "L" && p.y >= lo && p.y <= hi; });
  var poly = R.concat(notchesHi, L, notchesLo), out = [];
  poly.forEach(function (p) { var l = out[out.length - 1]; if (!l || l.x !== p.x || l.y !== p.y) out.push(p); }); // joints where a notch meets the chain
  if (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  return out;
}

// ---------------------------------------------------------------- ear clipping
function area2(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
// Triangles of a simple counterclockwise polygon. Collinear points are never ears but stay as vertices of their
// neighbors' ears, so a point inserted on a straight edge is still part of the triangulation and walls can share it.
export function earClip(pts) {
  var idx = pts.map(function (_, i) { return i; }), tris = [];
  function blocked(a, b, c) { // another vertex inside the ear, or sitting on its new diagonal
    for (var j = 0; j < idx.length; j++) {
      var p = pts[idx[j]];
      if (p === a || p === b || p === c) continue;
      if (area2(a, b, p) > EPS && area2(b, c, p) > EPS && area2(c, a, p) > EPS) return true;
      if (Math.abs(area2(c, a, p)) <= EPS && p.x >= Math.min(a.x, c.x) - EPS && p.x <= Math.max(a.x, c.x) + EPS && p.y >= Math.min(a.y, c.y) - EPS && p.y <= Math.max(a.y, c.y) + EPS) return true;
    }
    return false;
  }
  var guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    var n = idx.length, found = false;
    for (var i = 0; i < n; i++) {
      var a = pts[idx[(i + n - 1) % n]], b = pts[idx[i]], c = pts[idx[(i + 1) % n]];
      if (area2(a, b, c) <= EPS || blocked(a, b, c)) continue;
      tris.push([a, b, c]); idx.splice(i, 1); found = true; break;
    }
    if (!found) throw new Error("ear clipping stuck with " + idx.length + " points");
  }
  if (idx.length === 3) { var t = [pts[idx[0]], pts[idx[1]], pts[idx[2]]]; if (area2(t[0], t[1], t[2]) > EPS) tris.push(t); }
  return tris;
}

// ---------------------------------------------------------------- 3D pieces
function V(p, z) { return [p.x, p.y, z]; }
function lift(out, tris2, z, flip) { tris2.forEach(function (t) { out.push(flip ? [V(t[0], z), V(t[2], z), V(t[1], z)] : [V(t[0], z), V(t[1], z), V(t[2], z)]); }); }
function normal(t) {
  var a = t[0], b = t[1], c = t[2], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
function flipTri(t) { var s = t[1]; t[1] = t[2]; t[2] = s; return t; }
function nonDegenerate(t) { var n = normal(t); return hyp(hyp(n[0], n[1]), n[2]) > 1e-9; }
// A wall between polyline A at height zA and polyline B at height zB (same point count). Each quad is turned so its
// normal points away from (cx, cy) when inward is false, or toward it when inward is true.
function wall(out, A, B, zA, zB, closed, inward, cx, cy) {
  var n = A.length, last = closed ? n : n - 1;
  for (var i = 0; i < last; i++) {
    var j = (i + 1) % n, quad = [[V(A[i], zA), V(A[j], zA), V(B[j], zB)], [V(A[i], zA), V(B[j], zB), V(B[i], zB)]];
    var mx = (A[i].x + A[j].x + B[i].x + B[j].x) / 4, my = (A[i].y + A[j].y + B[i].y + B[j].y) / 4;
    quad.forEach(function (t) {
      if (!nonDegenerate(t)) return;
      var nn = normal(t), dot = nn[0] * (cx - mx) + nn[1] * (cy - my);
      if ((dot > 0) !== inward) flipTri(t);
      out.push(t);
    });
  }
}
// A planar polygon given as 3D points, triangulated in the plane of its first two axes that vary, facing `want`.
function planar(out, pts3, want) {
  var pts2 = pts3.map(function (p) { return { x: p[0], y: p[2] }; }); // every such face here lies in a plane y = const
  var tris = earClip(pts2), back = {};
  pts3.forEach(function (p, i) { back[pts2[i].x + "," + pts2[i].y] = p; });
  tris.forEach(function (t) {
    var T = t.map(function (p) { return back[p.x + "," + p.y]; }), nn = normal(T);
    if (nn[0] * want[0] + nn[1] * want[1] + nn[2] * want[2] < 0) flipTri(T);
    out.push(T);
  });
}
// Raised letters: each stroke is a box that starts 0.3 mm inside the top face so it fuses with it.
function letters(out, text, cap, cx, cy, zTop, raise) {
  var hw = strokeFor(cap) / 2, x = cx - labelUnits(text) * cap / 2, y = cy - cap / 2, z0 = zTop - 0.3, z1 = zTop + raise;
  var F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  for (var i = 0; i < text.length; i++) {
    var g = FONT[text[i]];
    if (g) g.forEach(function (poly) {
      for (var k = 0; k + 1 < poly.length; k++) {
        var x1 = x + poly[k][0] * cap, y1 = y + poly[k][1] * cap, x2 = x + poly[k + 1][0] * cap, y2 = y + poly[k + 1][1] * cap;
        var dx = x2 - x1, dy = y2 - y1, l = hyp(dx, dy) || 1, ex = dx / l * hw, ey = dy / l * hw, px = -dy / l * hw, py = dx / l * hw;
        var c = [[x1 - ex - px, y1 - ey - py], [x2 + ex - px, y2 + ey - py], [x2 + ex + px, y2 + ey + py], [x1 - ex + px, y1 - ey + py]];
        var v = c.map(function (q) { return [q[0], q[1], z0]; }).concat(c.map(function (q) { return [q[0], q[1], z1]; }));
        F.forEach(function (f) { out.push([v[f[0]], v[f[1]], v[f[2]]]); });
      }
    });
    x += labelAdvance(text[i]) * cap;
  }
}

// ---------------------------------------------------------------- layout
// rows: [{ sizes: [mm per hole], labels: [text per hole] }], front row first. Returns positions and the clamped
// settings the mesh is built from. Rows are centered across the holder; the widest row sets its width.
export function layoutModel(S, rows) {
  var c = Math.max(0, Math.min(S.chamfer, 0.4 * S.wall, S.edge - 0.5)); // the flared mouth must not touch its neighbors or the edge
  var W = 0, R = [], minIr = Infinity;
  rows.forEach(function (row) {
    var holes = row.sizes.map(function (mm, i) { var ir = (mm + 2 * S.clearance) / 2; return { ir: ir, R: ir / COS30, text: cleanLabel((row.labels || [])[i]) }; });
    var Rmax = Math.max.apply(null, holes.map(function (h) { return h.R; })), irMax = Math.max.apply(null, holes.map(function (h) { return h.ir; }));
    var pitch = 2 * Rmax + S.wall, span = (holes.length - 1) * pitch + 2 * Rmax, hasLabels = holes.some(function (h) { return h.text; });
    W = Math.max(W, span + 2 * S.edge);
    minIr = Math.min(minIr, Math.min.apply(null, holes.map(function (h) { return h.ir; })));
    R.push({ holes: holes, pitch: pitch, span: span, ir: irMax, Rmax: Rmax, band: hasLabels ? S.labelCap + 1.2 + c : 0 });
  });
  var y = S.edge;
  R.forEach(function (r) { y += r.band + r.ir; r.y = y; y += r.ir + S.wall; });
  var D = R.length ? y - S.wall + S.edge : 2 * S.edge;
  if (!R.length) W = 2 * S.edge;
  var H = S.height, zF = S.through ? 0 : Math.min(S.floorT, H - 1), zC = H - c;
  var s = Math.min(S.slotW, 2 * minIr - 0.6), depth = Math.max(c + 0.3, Math.min(H * S.slotPct / 100, H - zF - 0.5)), zS = H - depth;
  var slots = !!S.slots && R.length > 0;
  R.forEach(function (r, k) {
    r.index = k; r.a = r.y - s / 2; r.b = r.y + s / 2;
    var x0 = (W - r.span) / 2 + r.Rmax;
    r.holes.forEach(function (h, j) {
      h.x = x0 + j * r.pitch; h.y = r.y;
      var avail = r.pitch - 1, shown = h.text, cap = S.labelCap; // letters fit between neighbors with 0.5 mm to spare
      if (shown) {
        cap = Math.min(S.labelCap, avail / labelUnits(shown));
        while (cap < LABEL.capMin && shown.length > 1) { shown = shown.slice(0, -1).trim(); cap = Math.min(S.labelCap, avail / labelUnits(shown)); }
        if (cap < LABEL.capMin) shown = "";
      }
      h.shown = shown; h.cap = cap; h.dropped = h.text.length - shown.length;
      h.labelY = r.y - h.ir - c - 0.6 - S.labelCap / 2; // centered in the label band in front of the hole
    });
  });
  return { W: W, D: D, H: H, zF: zF, zC: zC, zS: zS, c: c, s: s, r: Math.min(S.cornerR, S.edge), slots: slots, through: !!S.through,
           raise: S.labelRaise, rows: R, holes: R.reduce(function (a, r) { return a.concat(r.holes); }, []) };
}

// ---------------------------------------------------------------- the holder
export function buildHolder(M) {
  var out = [], seg = 6, cutYs = [];
  M.rows.forEach(function (r) { cutYs.push(r.y); if (M.slots) cutYs.push(r.a, r.b); });
  var O = insertCuts(roundedRect(M.W, M.D, M.r, seg), cutYs), cx = M.W / 2, cy = M.D / 2;
  var hasC = M.c > 0, zTopC = hasC ? M.zC : M.H;
  M.rows.forEach(function (r) {
    r.holes.forEach(function (h) {
      h.ring = hexPoints(h.x, r.y, h.ir); h.ring2 = hasC ? hexPoints(h.x, r.y, h.ir + M.c) : h.ring;
      if (M.slots) { h.ring = insertCuts(h.ring, [r.a, r.b]); h.ring2 = hasC ? insertCuts(h.ring2, [r.a, r.b]) : h.ring; }
    });
  });
  function byX(holes, desc) { return holes.slice().sort(function (a, b) { return desc ? b.x - a.x : a.x - b.x; }); }
  function notches(row, Y, mode, key) { return byX(row.holes, mode === "below").reduce(function (acc, h) { return acc.concat(notch(h[key], Y, mode)); }, []); }
  // top face: bands between rows (or between slots), notched by the flared hex mouths
  var n = M.rows.length;
  for (var k = 0; k <= n; k++) {
    var below = k > 0 ? M.rows[k - 1] : null, above = k < n ? M.rows[k] : null;
    var lo = below ? (M.slots ? below.b : below.y) : 0, hi = above ? (M.slots ? above.a : above.y) : M.D;
    var poly = bandPolygon(O, lo, hi, above ? notches(above, hi, "below", "ring2") : [], below ? notches(below, lo, "above", "ring2") : []);
    lift(out, earClip(poly), M.H, false);
  }
  // bottom face: the plain outline, or the outline with the holes through it
  if (M.through) {
    for (var k2 = 0; k2 <= n; k2++) {
      var bl = k2 > 0 ? M.rows[k2 - 1] : null, ab = k2 < n ? M.rows[k2] : null;
      var p2 = bandPolygon(O, bl ? bl.y : 0, ab ? ab.y : M.D, ab ? notches(ab, ab.y, "below", "ring") : [], bl ? notches(bl, bl.y, "above", "ring") : []);
      lift(out, earClip(p2), 0, true);
    }
  } else lift(out, earClip(O), 0, true);
  // outer wall, in stacked quads so its vertical edges match the slot walls that meet it
  var levels = [0];
  if (M.slots) levels.push(M.zS);
  if (hasC && M.slots) levels.push(M.zC);
  levels.push(M.H);
  for (var i = 0; i < O.length; i++) {
    var p = O[i], q = O[(i + 1) % O.length], my = (p.y + q.y) / 2;
    var inSlot = M.slots && M.rows.some(function (r) { return my > r.a && my < r.b; });
    var lv = inSlot ? [0, M.zS] : levels;
    for (var l = 0; l + 1 < lv.length; l++) wall(out, [p, q], [p, q], lv[l], lv[l + 1], false, false, cx, cy);
  }
  // hole walls, floors, and flared mouths
  M.rows.forEach(function (r) {
    r.holes.forEach(function (h) {
      if (!M.through) lift(out, earClip(h.ring), M.zF, false);
      if (!M.slots) {
        wall(out, h.ring, h.ring, M.zF, zTopC, true, true, h.x, r.y);
        if (hasC) wall(out, h.ring, h.ring2, M.zC, M.H, true, true, h.x, r.y);
        return;
      }
      wall(out, h.ring, h.ring, M.zF, M.zS, true, true, h.x, r.y);
      [["above", r.b], ["below", r.a]].forEach(function (side) {
        var arc = notch(h.ring, side[1], side[0]), arc2 = notch(h.ring2, side[1], side[0]);
        wall(out, arc, arc, M.zS, zTopC, false, true, h.x, r.y);
        if (hasC) wall(out, arc, arc2, M.zC, M.H, false, true, h.x, r.y);
      });
    });
  });
  // slot floors and the two walls of each slot
  if (M.slots) M.rows.forEach(function (r) {
    var hs = byX(r.holes, false);
    function cuts(ring, Y) { return onLine(ring, Y); }
    function pointy(hole, right) { return hole.ring.reduce(function (m, pt) { return (right ? pt.x > m.x : pt.x < m.x) ? pt : m; }, hole.ring[0]); }
    var Lrun = O.filter(function (pt) { return pt.side === "L" && pt.y >= r.a && pt.y <= r.b; }), Rrun = O.filter(function (pt) { return pt.side === "R" && pt.y >= r.a && pt.y <= r.b; });
    var first = hs[0], last = hs[hs.length - 1];
    lift(out, earClip(Lrun.concat([cuts(first.ring, r.a)[0], pointy(first, false), cuts(first.ring, r.b)[0]])), M.zS, false);
    lift(out, earClip([cuts(last.ring, r.a)[1]].concat(Rrun, [cuts(last.ring, r.b)[1], pointy(last, true)])), M.zS, false);
    for (var j = 1; j < hs.length; j++) {
      var g = hs[j - 1], h = hs[j];
      lift(out, earClip([cuts(g.ring, r.a)[1], cuts(h.ring, r.a)[0], pointy(h, false), cuts(h.ring, r.b)[0], cuts(g.ring, r.b)[1], pointy(g, true)]), M.zS, false);
    }
    [[r.a, [0, 1, 0]], [r.b, [0, -1, 0]]].forEach(function (line) {
      var Y = line[0], xs = [onLine(O, Y)[0]], xs2 = [xs[0]];
      hs.forEach(function (hole) { xs = xs.concat(cuts(hole.ring, Y)); xs2 = xs2.concat(cuts(hole.ring2, Y)); });
      xs.push(onLine(O, Y)[1]); xs2.push(xs[xs.length - 1]);
      for (var m = 0; m + 1 < xs.length; m += 2) { // each straight run of the slot edge between holes, up to the top
        var x0 = xs[m].x, x1 = xs[m + 1].x, x0b = xs2[m].x, x1b = xs2[m + 1].x;
        var pts = [[x0, Y, M.zS], [x1, Y, M.zS]];
        if (hasC) pts.push([x1, Y, M.zC], [x1b, Y, M.H], [x0b, Y, M.H], [x0, Y, M.zC]); else pts.push([x1, Y, M.H], [x0, Y, M.H]);
        planar(out, pts, line[1]);
      }
    });
  });
  // labels
  M.rows.forEach(function (r) { r.holes.forEach(function (h) { if (h.shown) letters(out, h.shown, h.cap, h.x, h.labelY, M.H, M.raise); }); });
  return out;
}

// ---------------------------------------------------------------- checks used by the tests and the UI
export function signedVolume(tris) {
  var v = 0;
  tris.forEach(function (t) { var a = t[0], b = t[1], c = t[2]; v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); });
  return v / 6;
}
export function hexArea(ir) { return 2 * Math.sqrt(3) * ir * ir; }
export { COS30, TAN30 };
