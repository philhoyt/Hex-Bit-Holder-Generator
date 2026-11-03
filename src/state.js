// Defaults, limits, bit sizes, and the checked restore of saved state. Anything from storage is verified before use.
import { cleanLabel } from "./font.js";

// Common hex shank sizes, across the flats. The key is what the UI and saved state use.
export const SIZES = [
  { key: "1/4", mm: 6.35, name: "1/4 in", tag: "1-4in" },
  { key: "5/16", mm: 7.9375, name: "5/16 in", tag: "5-16in" },
  { key: "4mm", mm: 4, name: "4 mm", tag: "4mm" },
  { key: "5mm", mm: 5, name: "5 mm", tag: "5mm" },
  { key: "6mm", mm: 6, name: "6 mm", tag: "6mm" },
  { key: "custom", mm: 0, name: "Custom", tag: "" }
];
export const SIZE_KEYS = SIZES.map(function (s) { return s.key; });

// Holder-wide settings, mm unless noted. Measured defaults that print well on a 0.4 mm nozzle.
export const DEFAULTS = {
  height: 15, through: false, floorT: 1.2, chamfer: 0.5, slots: false, slotPct: 75, slotW: 1.6, cornerR: 2,
  clearance: 0.15, wall: 2.4, edge: 3, labelCap: 3, labelRaise: 0.5
};
export const LIMITS = {
  height: [6, 60], floorT: [0.6, 5], chamfer: [0, 2], slotPct: [25, 90], slotW: [0.8, 4], cornerR: [0, 12],
  clearance: [0, 1], wall: [1, 12], edge: [1, 20], labelCap: [2, 6], labelRaise: [0.2, 1.5]
};
export const FIT_KEYS = ["clearance", "wall", "edge", "floorT", "slotW", "labelCap", "labelRaise"]; // the Fit and print inputs
export const ROW = { size: "1/4", custom: 6.35, count: 8, labels: [] };
export const ROW_LIMITS = { count: [1, 30], custom: [2, 25], maxRows: 12 };

function isNum(v) { return typeof v === "number" && isFinite(v); }
function isInt(v, lo, hi) { return isNum(v) && v === Math.floor(v) && v >= lo && v <= hi; }
export function clampTo(k, v) { return Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v)); }
export function sizeOf(row) { // across the flats, mm, of the bits a row holds
  if (row.size === "custom") return Math.min(ROW_LIMITS.custom[1], Math.max(ROW_LIMITS.custom[0], row.custom));
  var s = SIZES.find(function (q) { return q.key === row.size; });
  return s ? s.mm : 6.35;
}
export function sizeName(row) { return row.size === "custom" ? sizeOf(row) + " mm" : SIZES.find(function (q) { return q.key === row.size; }).name; }

export function makeRow(id, opts) { return Object.assign({ id: id }, ROW, { labels: [] }, opts || {}); }
export function createState() { return Object.assign({ rows: [], selId: null }, DEFAULTS); }

function cleanRow(raw) { // a saved row with every field checked, or null if it can't be trusted
  if (!raw || typeof raw !== "object") return null;
  var r = Object.assign({}, ROW, raw);
  if (!isInt(r.id, 1, 1e9)) return null;
  if (SIZE_KEYS.indexOf(r.size) < 0) r.size = ROW.size;
  if (!isNum(r.custom)) r.custom = ROW.custom;
  r.custom = Math.min(ROW_LIMITS.custom[1], Math.max(ROW_LIMITS.custom[0], r.custom));
  r.count = isNum(r.count) ? Math.min(ROW_LIMITS.count[1], Math.max(ROW_LIMITS.count[0], Math.round(r.count))) : ROW.count;
  var labels = Array.isArray(raw.labels) ? raw.labels : [];
  r.labels = [];
  for (var i = 0; i < r.count; i++) r.labels.push(typeof labels[i] === "string" ? cleanLabel(labels[i]) : "");
  while (r.labels.length && !r.labels[r.labels.length - 1]) r.labels.pop();
  return { id: r.id, size: r.size, custom: r.custom, count: r.count, labels: r.labels };
}
// Fills S from whatever was saved. A bad row or a wrong type is dropped rather than breaking startup. Returns the next free row id.
export function restoreState(S, saved) {
  var nextId = 1;
  if (!saved || typeof saved !== "object") return nextId;
  Object.keys(DEFAULTS).forEach(function (k) {
    if (typeof DEFAULTS[k] === "boolean") { if (typeof saved[k] === "boolean") S[k] = saved[k]; }
    else if (isNum(saved[k])) S[k] = clampTo(k, saved[k]);
  });
  if (Array.isArray(saved.rows)) {
    saved.rows.slice(0, ROW_LIMITS.maxRows).forEach(function (raw) {
      var r = cleanRow(raw);
      if (r && !S.rows.some(function (o) { return o.id === r.id; })) { S.rows.push(r); nextId = Math.max(nextId, r.id + 1); }
    });
  }
  S.selId = S.rows.some(function (r) { return r.id === saved.selId; }) ? saved.selId : (S.rows.length ? S.rows[0].id : null);
  return nextId;
}
