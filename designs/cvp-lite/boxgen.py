#!/usr/bin/env python3
"""CVP-Lite box blank generator.

Turns an item's measured size (L x W x H, mm) into a one-piece wrap-around
mailer blank (FEFCO 0427-style: base, front/back walls, side walls with glue
ears, lid and tuck), then writes:

  * a JSON summary (blank size, fanfold choice, board use, cycle estimate)
  * a 1:1 SVG dieline (red = cut, blue dashed = crease) you can print and
    hand-cut from, with no machine at all
  * G-code for a FluidNC/grblHAL flatbed cutter whose head carries four
    pneumatic tools: KX/KY = cutting wheels for lines along X/Y,
    CX/CY = creasing wheels for lines along X/Y

Coordinates on the blank: x = feed direction (along the fanfold),
y = across the fanfold, y = 0 is the reference edge of the board.

Usage:
  python3 boxgen.py 300 200 120                # item L W H in mm
  python3 boxgen.py 300 200 120 --board C --out out/order123
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------- machine config
FANFOLD_WIDTHS = [600, 800, 1000]       # mm; 23.6" / 31.5" / 39.4" like the original
BED_MAX_X = 1500                        # mm usable cutting length on the bed
BOARD_T = {"B": 3.0, "C": 4.0, "BC": 7.0}   # board thickness per flute, mm
X_SEP = 30                              # bed X of the separation cut (next to feed rollers)
TOOL_OUT = {"KX": 0, "KY": 1, "CX": 2, "CY": 3, "CLAMP": 4}  # FluidNC M62/M63 P numbers
TOOL_OFFSET = {                         # tool tip offset from head reference, mm (measure yours)
    "KX": (0.0, 0.0), "KY": (60.0, 0.0), "CX": (0.0, 60.0), "CY": (60.0, 60.0),
}
FEED_CUT = 18000                        # mm/min (300 mm/s)
FEED_CREASE = 18000
RAPID = 36000                           # mm/min used only for the time estimate
TOOL_DWELL = 0.15                       # s, cylinder settle time after down/up
ROLLER_FEED = 30000                     # mm/min on the A (feed roller) axis


@dataclass
class Op:
    kind: str      # "cut" | "crease"
    axis: str      # "x" = line runs along x (constant y), "y" = line runs along y (constant x)
    at: float      # the constant coordinate
    a: float       # start of the line on the running axis
    b: float       # end of the line on the running axis

    @property
    def tool(self) -> str:
        return ("K" if self.kind == "cut" else "C") + self.axis.upper()

    @property
    def length(self) -> float:
        return abs(self.b - self.a)

    def endpoints(self):
        if self.axis == "x":
            return (self.a, self.at), (self.b, self.at)
        return (self.at, self.a), (self.at, self.b)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def plan_blank(L, W, H, board="C", clearance=5.0, widths=None, bed_max_x=BED_MAX_X):
    """Pick fanfold width + orientation and lay out the blank. Raises ValueError if it won't fit."""
    t = BOARD_T[board]
    widths = sorted(widths or FANFOLD_WIDTHS)
    iL, iW, iH = L + 2 * clearance, W + 2 * clearance, H + clearance   # inner box size
    h = iH
    best = None
    for across, along in ((iL, iW), (iW, iL)):
        main = across + t
        side = h
        y_tot = main + 2 * side
        tuck = clamp(0.6 * h, 20, 60)
        tuck = min(tuck, max(h - 5, 10))
        x = [0.0]
        for panel in (h, along + t, h + t, along + 2 * t, tuck):   # front, base, back, lid, tuck
            x.append(x[-1] + panel)
        x_tot = x[-1]
        if x_tot > bed_max_x:
            continue
        for F in widths:
            if y_tot <= F:
                area = x_tot * F
                if best is None or area < best["area"]:
                    best = dict(area=area, F=F, across=across, along=along, main=main,
                                side=side, y_tot=y_tot, x=x, x_tot=x_tot, tuck=tuck)
                break
    if best is None:
        raise ValueError(
            f"item {L}x{W}x{H} needs a blank wider than {widths[-1]} mm or longer than "
            f"{bed_max_x} mm; split the order or use a bigger machine")
    best.update(t=t, inner=(iL, iW, iH), board=board, h=h)
    best["ops"] = layout_ops(best)
    return best


def layout_ops(p):
    t, F, h = p["t"], p["F"], p["h"]
    x0, x1, x2, x3, x4, x5 = p["x"]
    yA, yB, yT = p["side"], p["side"] + p["main"], p["y_tot"]
    ear = min(h, (p["along"] + t) / 2 - 2)        # glue ear width; two ears must not collide
    tt = 2 * t                                     # tuck inset so it slides into the front wall
    ops = [
        # creases running across the board (constant x)
        Op("crease", "y", x1, yA, yB),             # front wall | base
        Op("crease", "y", x2, yA, yB),             # base | back wall
        Op("crease", "y", x3, yA, yB),             # back wall | lid
        Op("crease", "y", x4, yA + tt, yB - tt),   # lid | tuck
        # creases running along the board (constant y): ear / side-wall hinges
        Op("crease", "x", yA, x0, x3),
        Op("crease", "x", yB, x0, x3),
    ]
    for (lo, hi) in ((0, yA), (yB, yT)):
        ops += [Op("cut", "y", x1, lo, hi),        # front ear | side wall slit
                Op("cut", "y", x2, lo, hi),        # side wall | back ear slit
                Op("cut", "y", x3, lo, hi)]        # back ear end
    if ear < h - 0.5:                              # trim ear waste
        for y in (yA - ear, yB + ear):
            ops += [Op("cut", "x", y, x0, x1), Op("cut", "x", y, x2, x3)]
    ops += [
        Op("cut", "x", yA, x3, x4), Op("cut", "x", yB, x3, x4),               # lid sides
        Op("cut", "y", x4, yA, yA + tt), Op("cut", "y", x4, yB - tt, yB),     # tuck notches
        Op("cut", "x", yA + tt, x4, x5), Op("cut", "x", yB - tt, x4, x5),     # tuck sides
    ]
    if F - yT > 1:
        ops.append(Op("cut", "x", yT, x0, x5))     # trim strip on the far edge
    ops.append(Op("cut", "y", x5, 0, F))           # separation cut, always last
    p["ear"] = ear
    return ops


def order_ops(ops):
    """Creases first (board still stiff), then cuts; nearest-neighbour inside each group;
    the full-width separation cut stays last."""
    sep = ops[-1]
    groups = [[o for o in ops[:-1] if o.kind == "crease"], [o for o in ops[:-1] if o.kind == "cut"]]
    out, pos = [], (0.0, 0.0)
    for g in groups:
        g = list(g)
        while g:
            best, flip, dist = None, False, math.inf
            for o in g:
                s, e = o.endpoints()
                for f, pt in ((False, s), (True, e)):
                    d = math.dist(pos, pt)
                    if d < dist:
                        best, flip, dist = o, f, d
            g.remove(best)
            if flip:
                best = Op(best.kind, best.axis, best.at, best.b, best.a)
            out.append(best)
            pos = best.endpoints()[1]
    out.append(sep)
    return out


def to_bed(p, x, y, tool):
    """Blank coords -> machine coords for the head reference point."""
    dx, dy = TOOL_OFFSET[tool]
    return X_SEP + (p["x_tot"] - x) - dx, y - dy


def gcode(p, ops):
    lines = [
        f"; CVP-Lite blank  box inner {p['inner'][0]:.0f}x{p['inner'][1]:.0f}x{p['inner'][2]:.0f} mm",
        f"; fanfold {p['F']} mm  board {p['board']}  blank {p['x_tot']:.0f} x {p['y_tot']:.0f} mm",
        "G21 G90 G94",
        f"M63 P{TOOL_OUT['CLAMP']}", "G4 P0.2",
        "; feed board onto the bed",
        f"G91 G1 A{p['x_tot']:.1f} F{ROLLER_FEED}", "G90",
        f"M62 P{TOOL_OUT['CLAMP']}", "G4 P0.3",
    ]
    for o in ops:
        (sx, sy), (ex, ey) = o.endpoints()
        bx0, by0 = to_bed(p, sx, sy, o.tool)
        bx1, by1 = to_bed(p, ex, ey, o.tool)
        f = FEED_CUT if o.kind == "cut" else FEED_CREASE
        lines += [
            f"; {o.kind} {o.tool} {'y' if o.axis == 'x' else 'x'}={o.at:.1f}",
            f"G0 X{bx0:.2f} Y{by0:.2f}",
            f"M62 P{TOOL_OUT[o.tool]}", f"G4 P{TOOL_DWELL}",
            f"G1 X{bx1:.2f} Y{by1:.2f} F{f}",
            f"M63 P{TOOL_OUT[o.tool]}", f"G4 P{TOOL_DWELL}",
        ]
    lines += [f"M63 P{TOOL_OUT['CLAMP']}", "G0 X0 Y0", "M2"]
    return "\n".join(lines) + "\n"


def estimate_seconds(p, ops):
    t = p["x_tot"] / (ROLLER_FEED / 60) + 0.5
    pos = (0.0, 0.0)
    for o in ops:
        s, e = o.endpoints()
        t += math.dist(pos, s) / (RAPID / 60) * 1.3          # 1.3 = accel penalty
        t += o.length / ((FEED_CUT if o.kind == "cut" else FEED_CREASE) / 60) * 1.2
        t += 2 * TOOL_DWELL
        pos = e
    return t


def svg(p, ops):
    W, Hh = p["F"], p["x_tot"]
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{Hh}mm" '
         f'viewBox="-5 -5 {W + 10} {Hh + 10}">',
         f'<rect x="0" y="0" width="{W}" height="{Hh}" fill="#f3e3c3" stroke="#bbb" stroke-width="0.5"/>']
    for o in ops:
        (sx, sy), (ex, ey) = o.endpoints()
        style = ('stroke="#d22" stroke-width="1"' if o.kind == "cut"
                 else 'stroke="#14c" stroke-width="1" stroke-dasharray="6 4"')
        s.append(f'<line x1="{sy:.1f}" y1="{sx:.1f}" x2="{ey:.1f}" y2="{ex:.1f}" {style}/>')
    x, yA, yB = p["x"], p["side"], p["side"] + p["main"]
    labels = [("FRONT", (x[0] + x[1]) / 2), ("BASE", (x[1] + x[2]) / 2), ("BACK", (x[2] + x[3]) / 2),
              ("LID", (x[3] + x[4]) / 2), ("TUCK", (x[4] + x[5]) / 2)]
    for name, xm in labels:
        s.append(f'<text x="{(yA + yB) / 2:.1f}" y="{xm:.1f}" font-size="14" text-anchor="middle" '
                 f'font-family="sans-serif" fill="#333">{name}</text>')
    xm = (x[1] + x[2]) / 2
    for ym in (yA / 2, yB + yA / 2):
        s.append(f'<text x="{ym:.1f}" y="{xm:.1f}" font-size="12" text-anchor="middle" '
                 f'font-family="sans-serif" fill="#333">SIDE</text>')
    s.append("</svg>")
    return "\n".join(s) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("L", type=float), ap.add_argument("W", type=float), ap.add_argument("H", type=float)
    ap.add_argument("--board", choices=BOARD_T, default="C")
    ap.add_argument("--clearance", type=float, default=5.0)
    ap.add_argument("--widths", type=int, nargs="*", default=FANFOLD_WIDTHS)
    ap.add_argument("--out", default="out/blank")
    a = ap.parse_args()

    p = plan_blank(a.L, a.W, a.H, a.board, a.clearance, a.widths)
    ops = order_ops(p["ops"])
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".gcode").write_text(gcode(p, ops))
    out.with_suffix(".svg").write_text(svg(p, ops))
    blank_area = p["x_tot"] * p["y_tot"] / 1e6
    summary = {
        "item_mm": [a.L, a.W, a.H],
        "box_inner_mm": [round(v, 1) for v in p["inner"]],
        "board": a.board, "fanfold_width_mm": p["F"],
        "blank_mm": [round(p["x_tot"], 1), round(p["y_tot"], 1)],
        "board_used_m2": round(p["x_tot"] * p["F"] / 1e6, 3),
        "blank_m2": round(blank_area, 3),
        "yield_pct": round(100 * blank_area / (p["x_tot"] * p["F"] / 1e6), 1),
        "ops": {"cuts": sum(o.kind == "cut" for o in ops), "creases": sum(o.kind == "crease" for o in ops)},
        "cut_length_m": round(sum(o.length for o in ops if o.kind == "cut") / 1000, 2),
        "crease_length_m": round(sum(o.length for o in ops if o.kind == "crease") / 1000, 2),
        "est_cycle_s": round(estimate_seconds(p, ops), 1),
        "files": [str(out.with_suffix(".gcode")), str(out.with_suffix(".svg"))],
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
