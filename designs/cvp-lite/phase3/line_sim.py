#!/usr/bin/env python3
"""CVP-Lite phase-3 line simulator.

Feeds a random order mix through the automated line and reports boxes per hour,
which station is the bottleneck, how busy each one is, and how much board the
mix uses. Station times come from boxgen.py in --line mode (cutter at --fast
speeds plus scrap sweeping and bed-belt eject, item kept long side along the
belt, former with the side pusher instead of an operator), so the numbers move
when the machine settings there move.

Model: orders are processed first-in first-out with unlimited buffers between
stations (the line has accumulation conveyors). Each blank goes to the cutter
that finishes it first among those whose fanfold is wide enough, preferring
the narrowest; each box goes to the first free former lane.

Usage:
  python3 line_sim.py                          # all built-in configurations
  python3 line_sim.py --orders 2000 --seed 7 --json out.json
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import boxgen  # noqa: E402

boxgen.__dict__.update(boxgen.FAST)  # phase-3 cutters run the phase-2 fast profile

INDUCT_GAP = 4.0     # s between items through the in-motion scan tunnel (~900/h)
PLAN_S = 1.0         # s to measure, plan and send the G-code
TRANSFER_S = 4.0     # s blank travel cutter -> former lane
PUSH_S = 1.5         # s for the side pusher to put the item on the base
LABEL_S = 5.0        # s per box at checkweigher + print-and-apply
LABEL_TRANSFER_S = 3.0

# order mix: (share, L range, W range, H range) in mm, item size
MIX = [
    (0.45, (120, 250), (90, 180), (30, 100)),     # small
    (0.40, (250, 400), (180, 300), (80, 200)),    # medium
    (0.15, (380, 480), (280, 380), (150, 260)),   # large
]

CONFIGS = {
    "A  1 cutter + 1 former": dict(cutters=[1000], formers=1),
    "B  2 cutters + 1 former": dict(cutters=[800, 1000], formers=1),
    "C  3 cutters + 2 formers": dict(cutters=[600, 800, 1000], formers=2),
    "D  4 cutters + 2 formers": dict(cutters=[600, 600, 800, 1000], formers=2),     # baseline
    "D' 4 cutters, all 1000 mm": dict(cutters=[1000, 1000, 1000, 1000], formers=2),
    "E  5 cutters + 2 formers": dict(cutters=[600, 600, 800, 1000, 1000], formers=2),
}


def make_orders(n, seed):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        r, acc = rnd.random(), 0.0
        for share, lr, wr, hr in MIX:
            acc += share
            if r <= acc:
                break
        L, W = rnd.uniform(*lr), rnd.uniform(*wr)
        out.append((round(max(L, W)), round(min(L, W)), round(rnd.uniform(*hr))))
    return out


def plan_order(item, widths):
    p = boxgen.plan_blank(*item, board="C", widths=widths, former=True, fixed_orientation=True)
    ops = boxgen.order_ops(p["ops"])
    cut_s = boxgen.estimate_seconds(p, ops) + boxgen.line_seconds(p, ops[-1].endpoints()[1])
    form_s = boxgen.former_seconds(p, place=PUSH_S)
    return p, cut_s, form_s


def simulate(orders, cutters, formers):
    widths = sorted(set(cutters))
    cut_free = [0.0] * len(cutters)
    form_free = [0.0] * formers
    label_free = 0.0
    busy = {"induct": 0.0, "cutters": [0.0] * len(cutters), "formers": [0.0] * formers, "label": 0.0}
    done, manual, used_m2, blank_m2 = [], 0, 0.0, 0.0
    t_induct = 0.0
    for item in orders:
        try:
            p, cut_s, form_s = plan_order(item, widths)
        except ValueError:
            manual += 1                       # outside the line's range: hand-pack lane
            continue
        t_induct += INDUCT_GAP
        busy["induct"] += INDUCT_GAP
        ready = t_induct + PLAN_S
        # cutter that finishes first among wide-enough ones, narrowest on a tie
        cands = [(max(cut_free[i], ready) + cut_s, cutters[i], i) for i in range(len(cutters))
                 if cutters[i] >= p["F"]]
        end, width, ci = min(cands)
        cut_free[ci] = end
        busy["cutters"][ci] += cut_s
        used_m2 += p["x_tot"] * width / 1e6
        blank_m2 += p["x_tot"] * p["y_tot"] / 1e6
        # first free former lane
        fi = min(range(formers), key=lambda i: form_free[i])
        f_start = max(form_free[fi], end + TRANSFER_S)
        form_free[fi] = f_start + form_s
        busy["formers"][fi] += form_s
        l_start = max(label_free, form_free[fi] + LABEL_TRANSFER_S)
        label_free = l_start + LABEL_S
        busy["label"] += LABEL_S
        done.append(label_free)
    done.sort()
    n = len(done)
    half = n // 2
    steady = (n - half) / (done[-1] - done[half]) * 3600 if n > 4 else 0.0
    span = done[-1]
    util = {
        "induct": busy["induct"] / span,
        "cutters": [b / span for b in busy["cutters"]],
        "formers": [b / span for b in busy["formers"]],
        "label": busy["label"] / span,
    }
    stations = {"scan tunnel": util["induct"], "cutters": max(util["cutters"]),
                "formers": max(util["formers"]), "label": util["label"]}
    return {
        "boxes_per_hour": round(steady),
        "bottleneck": max(stations, key=stations.get),
        "utilisation": {"induct": round(util["induct"], 2),
                        "cutters": [round(u, 2) for u in util["cutters"]],
                        "formers": [round(u, 2) for u in util["formers"]],
                        "label": round(util["label"], 2)},
        "automated": n, "manual_lane": manual,
        "board_yield_pct": round(100 * blank_m2 / used_m2, 1),
        "board_m2_per_box": round(used_m2 / n, 3),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--orders", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--json", help="also write the results to this file")
    a = ap.parse_args()
    orders = make_orders(a.orders, a.seed)
    results = {name: simulate(orders, **cfg) for name, cfg in CONFIGS.items()}
    print(f"{'configuration':34} {'box/h':>6}  {'bottleneck':12} {'cutters':>18} {'formers':>11} "
          f"{'label':>5} {'yield':>6} {'manual':>6}")
    for name, r in results.items():
        u = r["utilisation"]
        print(f"{name:34} {r['boxes_per_hour']:>6}  {r['bottleneck']:12} "
              f"{' '.join(f'{x:.2f}' for x in u['cutters']):>18} "
              f"{' '.join(f'{x:.2f}' for x in u['formers']):>11} {u['label']:>5.2f} "
              f"{r['board_yield_pct']:>5}% {r['manual_lane']:>6}")
    if a.json:
        Path(a.json).write_text(json.dumps({"orders": a.orders, "seed": a.seed, "results": results},
                                           indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
