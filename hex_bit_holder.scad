// Hex Bit Holder, OpenSCAD version of the web app. Paste the "Copy OpenSCAD settings" block over the settings below.
// Rows run front to back; holes in a row run left to right. All dimensions in mm.

/* [Rows] */
// [bit size across the flats, holes] per row, front row first
rows = [[6.35, 8], [6.35, 8]];
// one text per hole, front row first, left to right ("" for none)
labels = [[], []];

/* [Holder] */
height = 15;
// holes go all the way through
through = false;
// floor under each hole when not through
floor_t = 1.2;
// flared mouth on each hole, so bits find their way in
chamfer = 0.5;
// cut a slot along each row so the holes can flex
slots = false;
// slot depth as a share of the height
slot_pct = 75;
slot_w = 1.6;
corner_r = 2;

/* [Fit and print] */
// added to each side of every hole
clearance = 0.15;
// web between holes
wall = 2.4;
// from the outer holes to the edge
edge = 3;
label_cap = 3;
label_raise = 0.5;

/* [Hidden] */
$fn = 24;
n_rows = len(rows);
flare = max(0, min(chamfer, 0.4 * wall, edge - 0.5));
function ir(k) = (rows[k][0] + 2 * clearance) / 2;           // inradius of the holes in row k
function R(k) = ir(k) / cos(30);                               // circumradius
function pitch(k) = 2 * R(k) + wall;
function span(k) = (rows[k][1] - 1) * pitch(k) + 2 * R(k);
function has_labels(k) = k < len(labels) && len([for (t = labels[k]) if (t != "") t]) > 0;
function band(k) = has_labels(k) ? label_cap + 1.2 + flare : 0;
function row_y(k) = k == 0 ? edge + band(0) + ir(0) : row_y(k - 1) + ir(k - 1) + wall + band(k) + ir(k);
W = max([for (k = [0 : n_rows - 1]) span(k)]) + 2 * edge;
D = row_y(n_rows - 1) + ir(n_rows - 1) + edge;
z_floor = through ? 0 : floor_t;
slot_depth = max(flare + 0.3, min(height * slot_pct / 100, height - z_floor - 0.5));

module hex(r, h) { cylinder(r = r, h = h, $fn = 6); } // points along x, flats along y
module body() {
  linear_extrude(height) offset(r = corner_r) offset(delta = -corner_r) square([W, D]);
}
module holes() {
  for (k = [0 : n_rows - 1]) {
    x0 = (W - span(k)) / 2 + R(k);
    for (j = [0 : rows[k][1] - 1]) translate([x0 + j * pitch(k), row_y(k), 0]) {
      translate([0, 0, z_floor]) hex(R(k), height);
      if (flare > 0) translate([0, 0, height - flare]) cylinder(r1 = R(k), r2 = (ir(k) + flare) / cos(30), h = flare + 0.01, $fn = 6);
    }
    if (slots) translate([-1, row_y(k) - slot_w / 2, height - slot_depth]) cube([W + 2, slot_w, slot_depth + 1]);
  }
}
module letters() {
  for (k = [0 : n_rows - 1]) if (has_labels(k)) {
    x0 = (W - span(k)) / 2 + R(k);
    for (j = [0 : rows[k][1] - 1]) if (j < len(labels[k]) && labels[k][j] != "")
      translate([x0 + j * pitch(k), row_y(k) - ir(k) - flare - 0.6 - label_cap / 2, height - 0.3])
        linear_extrude(label_raise + 0.3) resize([min(pitch(k) - 1, 0.8 * label_cap * len(labels[k][j])), 0], auto = true)
          text(labels[k][j], size = label_cap, halign = "center", valign = "center", font = "Liberation Sans:style=Bold");
  }
}

difference() { body(); holes(); }
letters();
