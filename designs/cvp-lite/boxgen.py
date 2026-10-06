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
  * with --former: a phase-2 forming-station recipe (axis set-points, glue
    timing on the infeed belt, folding sequence) as G-code for a second
    FluidNC board, see phase2/README.md
  * with --line: phase-3 cutter moves on top of that: the scrap pieces are
    swept off the bed into side chutes and the felt conveyor bed carries the
    blank out onto the line, and the box is oriented so the item travels long
    side first,
    see phase3/README.md

Coordinates on the blank: x = feed direction (along the fanfold),
y = across the fanfold, y = 0 is the reference edge of the board.

Usage:
  python3 boxgen.py 300 200 120                # item L W H in mm
  python3 boxgen.py 300 200 120 --board C --out out/order123
  python3 boxgen.py 300 200 120 --former --fast   # phase 2 line
  python3 boxgen.py 300 200 120 --line             # phase 3 line (implies --former --fast)
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
TOOL_OUT = {"KX": 0, "KY": 1, "CX": 2, "CY": 3, "CLAMP": 4,   # FluidNC M62/M63 P numbers
            "SWEEP": 5}                                       # phase 3 only
TOOL_OFFSET = {                         # tool tip offset from head reference, mm (measure yours)
    "KX": (0.0, 0.0), "KY": (60.0, 0.0), "CX": (0.0, 60.0), "CY": (60.0, 60.0),
    "SWEEP": (120.0, 0.0),
}
CHUTE_CLEAR = 40                        # mm past each bed edge the sweeper pushes scrap
BED_BELT_FEED = 60000                   # mm/min, phase-3 felt conveyor bed (B axis) that ejects
BED_EJECT = BED_MAX_X + 100             # mm of bed-belt travel to hand a blank to the line
FEED_CUT = 18000                        # mm/min (300 mm/s)
FEED_CREASE = 18000
RAPID = 36000                           # mm/min used only for the time estimate
TOOL_DWELL = 0.15                       # s, cylinder settle time after down/up
ROLLER_FEED = 30000                     # mm/min on the A (feed roller) axis
FAST = dict(FEED_CUT=36000, FEED_CREASE=36000, RAPID=60000, TOOL_DWELL=0.10)  # phase-2 cutter upgrade

# ---------------------------------------------------------------- phase-2 former config
# Former coordinates: origin = centre of the box base, +X = belt direction. The blank leaves
# the cutter front wall first (the tuck end is the last cut, next to the fanfold), so the
# front wall sits on +X and the back wall / lid on -X.
FORMER_LIMITS = dict(x=(130, 520), y=(120, 520), h=(40, 300))  # base along X / across Y incl. t, wall h
EAR_CLEAR = 45          # ears stop this far from the side paddle centre strip (|x| < 35)
SENSOR_X = -900         # blank leading edge trips the infeed sensor here (belt A = 0)
GUN_X = -860            # glue guns sit here; side guns ride the side beams, tuck gun is fixed
GUN_SIDE_OFS = 15       # side guns fire this far outside the side crease
TUCK_GUN_Y = 40         # tuck gun offset from the centre belt
BELT_FEED = 30000       # mm/min
HEAD_FEED = 48000       # mm/min, press head X (C axis)
Z_FEED = 18000          # mm/min, press head Z
EXIT_TRAVEL = 1000      # belt travel that carries the finished box onto the outfeed
WIPER_OFS = 160         # tuck wiper sits this far ahead (+X) of the press head centre
PLOW_FRAC = 0.7         # plow edge meets the standing lid at 70 % of its length
FORMER_OUT = {"SIDE_PADDLES": 0, "FRONT_PADDLES": 1, "BACK_PADDLES": 2, "EAR_FRONT": 3,
              "EAR_BACK": 4, "TUCK_WIPER": 5, "GLUE_L": 6, "GLUE_R": 7, "GLUE_TUCK": 8}

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


def plan_blank(L, W, H, board="C", clearance=5.0, widths=None, bed_max_x=BED_MAX_X, former=False,
               fixed_orientation=False):
    """Pick fanfold width + orientation and lay out the blank. Raises ValueError if it won't fit.
    former=True also requires the box to fit the phase-2 forming station and shortens the ears;
    a box below the station's minimum is grown up to it (a little more board, no hand-packing).
    fixed_orientation=True keeps L along the belt (X), for a line where the item cannot be turned."""
    t = BOARD_T[board]
    widths = sorted(widths or FANFOLD_WIDTHS)
    iL, iW, iH = L + 2 * clearance, W + 2 * clearance, H + clearance   # inner box size
    lim = FORMER_LIMITS
    best = None
    for across, along in (((iW, iL),) if fixed_orientation else ((iL, iW), (iW, iL))):
        h = iH
        if former:
            along = max(along, lim["x"][0] - t)
            across = max(across, lim["y"][0] - t)
            h = max(h, lim["h"][0])
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
        if former and not fits_former(along + t, across + t, h):
            continue
        for F in widths:
            if y_tot <= F:
                area = x_tot * F
                if best is None or area < best["area"]:
                    inner = (across, along, h) if across == max(across, along) else (along, across, h)
                    best = dict(area=area, F=F, across=across, along=along, main=main, h=h,
                                side=side, y_tot=y_tot, x=x, x_tot=x_tot, tuck=tuck, inner=inner)
                break
    if best is None and former:
        lx, ly, lh = lim["x"], lim["y"], lim["h"]
        raise ValueError(
            f"item {L}x{W}x{H} is outside the forming station range (base up to {lx[1]} x "
            f"{ly[1]} mm, wall up to {lh[1]} mm) or the cutter bed; pack this one by hand")
    if best is None:
        raise ValueError(
            f"item {L}x{W}x{H} needs a blank wider than {widths[-1]} mm or longer than "
            f"{bed_max_x} mm; split the order or use a bigger machine")
    if not former:
        best["inner"] = (iL, iW, iH)
    best.update(t=t, board=board, former=former)
    best["ops"] = layout_ops(best)
    return best


def fits_former(bx, by, h):
    lim = FORMER_LIMITS
    return (lim["x"][0] <= bx <= lim["x"][1] and lim["y"][0] <= by <= lim["y"][1]
            and lim["h"][0] <= h <= lim["h"][1])


def layout_ops(p):
    t, F, h = p["t"], p["F"], p["h"]
    x0, x1, x2, x3, x4, x5 = p["x"]
    yA, yB, yT = p["side"], p["side"] + p["main"], p["y_tot"]
    # glue ear width: front and back ears must not collide; on the former they must also
    # stay clear of the side paddle in the middle of each side wall
    ear = min(h, (p["along"] + t) / 2 - (EAR_CLEAR if p["former"] else 2))
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


def gcode(p, ops, line=False):
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
    if line:
        lines += line_gcode(p)
    lines += [f"M63 P{TOOL_OUT['CLAMP']}", "G0 X0 Y0", "M2"]
    return "\n".join(lines) + "\n"


def waste_pieces(p):
    """Scrap rectangles left on the bed after the cuts: (x0, x1, y0, y1, side), side = the bed
    edge they get swept to. The trim strip goes first so nothing is pushed into it; the rest
    run along one side and back along the other to keep the head travel short."""
    t, h, x = p["t"], p["h"], p["x"]
    yA, yB, yT, F, e = p["side"], p["side"] + p["main"], p["y_tot"], p["F"], p["ear"]
    pieces = []
    if F - yT > 1:
        pieces.append((x[0], x[5], yT, F, "high"))                  # trim strip
    if e < h - 0.5:
        for x0, x1 in ((x[0], x[1]), (x[2], x[3])):                 # outside the glue ears
            pieces.append((x0, x1, yB + e, yT, "high"))
            pieces.append((x0, x1, 0.0, yA - e, "low"))
    pieces.append((x[3], x[5], yB, yT, "high"))                     # beside lid and tuck
    pieces.append((x[3], x[5], 0.0, yA, "low"))
    trim = [q for q in pieces if q[2] == yT and q[3] == F]
    high = sorted((q for q in pieces if q[4] == "high" and q not in trim), key=lambda q: -q[0])
    low = sorted((q for q in pieces if q[4] == "low"), key=lambda q: q[0])
    return trim + high + low


def line_moves(p):
    """Phase-3 moves after the separation cut: sweep each scrap piece into its side chute.
    Returns (tool, start, end) in blank coordinates. The blank itself leaves on the bed belt."""
    moves = []
    for x0, x1, y0, y1, side in waste_pieces(p):
        xm, w = (x0 + x1) / 2, y1 - y0
        if side == "high":
            moves.append(("SWEEP", (xm, y0 + min(10, w / 2)), (xm, p["F"] + CHUTE_CLEAR)))
        else:
            moves.append(("SWEEP", (xm, y1 - min(10, w / 2)), (xm, -CHUTE_CLEAR)))
    return moves


def line_gcode(p):
    lines = ["; phase 3: clear scrap into the side chutes, then the bed belt carries the blank out"]
    for tool, (sx, sy), (ex, ey) in line_moves(p):
        bx0, by0 = to_bed(p, sx, sy, tool)
        bx1, by1 = to_bed(p, ex, ey, tool)
        lines += [f"G0 X{bx0:.2f} Y{by0:.2f}", f"M62 P{TOOL_OUT[tool]}", f"G4 P{TOOL_DWELL}",
                  f"G1 X{bx1:.2f} Y{by1:.2f} F{RAPID}", f"M63 P{TOOL_OUT[tool]}", f"G4 P{TOOL_DWELL}"]
    lines += ["G0 X0 Y0", f"G91 G1 B{BED_EJECT} F{BED_BELT_FEED}", "G90"]
    return lines


def line_seconds(p, start=(0.0, 0.0)):
    t, pos = 0.0, start
    for _tool, s0, s1 in line_moves(p):
        t += math.dist(pos, s0) / (RAPID / 60) * 1.3 + math.dist(s0, s1) / (RAPID / 60) * 1.2
        t += 2 * TOOL_DWELL
        pos = s1
    return t + BED_EJECT / (BED_BELT_FEED / 60) * 1.2


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


def former_setpoints(p):
    """Axis set-points for the forming station, in former coordinates (mm)."""
    t, h, x = p["t"], p["h"], p["x"]
    bx, by = p["along"] + t, p["main"]              # base size along X / across Y
    xc = (x[1] + x[2]) / 2                           # base centre on the blank
    lid = x[4] - x[3]
    front, back = -bx / 2, bx / 2
    return {
        "X_end_paddles": round(bx / 2, 1),           # front/back paddle hinges at +X / -X
        "Y_side_beams": round(by / 2, 1),            # side paddle hinges, ear plates, side guns at +-Y
        "A_stop": round(xc - SENSOR_X, 1),           # belt travel after the sensor trips
        "B_fence": round(-(p["side"] + by / 2), 1),  # blank reference edge (y = 0)
        # press head: parks behind the standing lid (-X), plows it over towards +X,
        # then presses it and wipes the tuck down onto the front wall
        "C_head_park": round(-(back + h + lid + p["tuck"] + 60), 1),
        "Z_plow": round(h + PLOW_FRAC * lid, 1),
        "C_head_press": round(-front + t + 6 - WIPER_OFS, 1),
        "Z_press_hold": round(h + 2 * t, 1),
        "Z_clear": round(h + 40, 1),
        "ear_mm": round(p["ear"], 1),
    }


def glue_events(p):
    """Belt positions (A) where each gun switches on/off. Guns are fixed in X, the blank moves."""
    x, k = p["x"], p["tuck"]
    def a_of(xb):
        return GUN_X - SENSOR_X + xb
    beads = [  # (outputs, x_lo, x_hi) on the blank; the front wall end (x = 0) leads
        (("GLUE_L", "GLUE_R"), 0.25 * x[1], 0.75 * x[1]),                                # front ears
        (("GLUE_L", "GLUE_R"), x[2] + 0.25 * (x[3] - x[2]), x[2] + 0.75 * (x[3] - x[2])),  # back ears
        (("GLUE_TUCK",), x[4] + 0.3 * k, x[4] + 0.7 * k),
    ]
    return [(outs, a_of(lo), a_of(hi)) for outs, lo, hi in beads]


def former_gcode(p):
    s = former_setpoints(p)
    o = FORMER_OUT
    on = lambda *n: [f"M64 P{o[k]}" for k in n]
    off = lambda *n: [f"M65 P{o[k]}" for k in n]
    L = [
        f"; CVP-Lite former recipe  base {p['along'] + p['t']:.0f} x {p['main']:.0f}  wall {p['h']:.0f} mm",
        "; axes: X end-paddle screw, Y side-beam screws, Z press head, A belt, B fence, C press head X",
        "G21 G90 G94",
        f"G0 Z{s['Z_plow']}",
        f"G0 X{s['X_end_paddles']} Y{s['Y_side_beams']} B{s['B_fence']} C{s['C_head_park']}",
        "; host waits for the infeed sensor, then zeroes the belt",
        "G92 A0",
    ]
    for outs, a_on, a_off in glue_events(p):
        L.append(f"G1 A{a_on:.1f} F{BELT_FEED}")
        L += [f"M62 P{o[n]}" for n in outs]
        L.append(f"G1 A{a_off:.1f} F{BELT_FEED}")
        L += [f"M63 P{o[n]}" for n in outs]
    L += [
        f"G1 A{s['A_stop']} F{BELT_FEED}",
        "; operator places the item on the base, light curtain clears, cycle start",
        "M0",
        "; 1 walls up: sides first so the ears stand clear of them",
        *on("SIDE_PADDLES"), "G4 P0.5",
        *on("FRONT_PADDLES", "BACK_PADDLES"), "G4 P0.5",
        "; 2 ear plates sweep in from both ends and stay as clamps",
        *on("EAR_FRONT", "EAR_BACK"), "G4 P0.9",
        "; 3 drop side and front paddles; back paddle keeps the lid standing",
        *off("SIDE_PADDLES", "FRONT_PADDLES"), "G4 P0.3",
        "; 4 plow the lid over towards +X with the head's leading edge",
        f"G1 C{s['C_head_press']} F{HEAD_FEED}",
        *off("BACK_PADDLES"), "G4 P0.3",
        "; 5 press the lid flat, wipe the tuck down onto the front wall, hold for the glue",
        f"G1 Z{s['Z_press_hold']} F{Z_FEED}",
        *on("TUCK_WIPER"), "G4 P1.5", *off("TUCK_WIPER"), "G4 P0.3",
        "; 6 release and send the box out under the raised head",
        f"G0 Z{s['Z_clear']}",
        *off("EAR_FRONT", "EAR_BACK"), "G4 P0.8",
        f"G91 G1 A{EXIT_TRAVEL} F{BELT_FEED}", "G90",
        f"G0 Z{s['Z_plow']}", f"G0 C{s['C_head_park']}",
        "M2",
    ]
    return "\n".join(L) + "\n"


def former_seconds(p, place=3.0):
    """Item-to-item time at the former. The head's return overlaps the next infeed.
    place = seconds to get the item onto the base (3.0 operator, ~1.5 side pusher)."""
    s = former_setpoints(p)
    belt = (s["A_stop"] + EXIT_TRAVEL) / (BELT_FEED / 60) * 1.2
    dwell = 0.5 + 0.5 + 0.9 + 0.3 + 0.3 + 1.5 + 0.3 + 0.8
    head = abs(s["C_head_park"] - s["C_head_press"]) / (HEAD_FEED / 60) * 1.3
    z = (s["Z_plow"] - s["Z_press_hold"] + s["Z_clear"] - s["Z_press_hold"]) / (Z_FEED / 60) * 1.3
    return belt + place + dwell + head + z


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("L", type=float), ap.add_argument("W", type=float), ap.add_argument("H", type=float)
    ap.add_argument("--board", choices=BOARD_T, default="C")
    ap.add_argument("--clearance", type=float, default=5.0)
    ap.add_argument("--widths", type=int, nargs="*", default=FANFOLD_WIDTHS)
    ap.add_argument("--out", default="out/blank")
    ap.add_argument("--former", action="store_true", help="phase 2: plan for the forming station")
    ap.add_argument("--fast", action="store_true", help="phase 2 cutter speeds (600 mm/s cut)")
    ap.add_argument("--line", action="store_true",
                    help="phase 3: scrap sweep + blank eject, L kept along the belt (implies --former --fast)")
    a = ap.parse_args()
    if a.line:
        a.former = a.fast = True
    if a.fast:
        globals().update(FAST)

    p = plan_blank(a.L, a.W, a.H, a.board, a.clearance, a.widths, former=a.former,
                   fixed_orientation=a.line)
    ops = order_ops(p["ops"])
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".gcode").write_text(gcode(p, ops, line=a.line))
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
        "est_cycle_s": round(estimate_seconds(p, ops) + (line_seconds(p, ops[-1].endpoints()[1])
                                                          if a.line else 0), 1),
        "files": [str(out.with_suffix(".gcode")), str(out.with_suffix(".svg"))],
    }
    if a.former:
        out.with_suffix(".former.gcode").write_text(former_gcode(p))
        cut_s, form_s = summary["est_cycle_s"], former_seconds(p, place=1.5 if a.line else 3.0)
        summary["former"] = former_setpoints(p)
        summary["former"]["est_cycle_s"] = round(form_s, 1)
        summary["line_boxes_per_hour"] = round(3600 / max(cut_s, form_s))
        summary["files"].append(str(out.with_suffix(".former.gcode")))
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
