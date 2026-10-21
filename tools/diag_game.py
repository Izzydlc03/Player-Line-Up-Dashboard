"""Inspect one game's periods/clock coverage and player minutes.

Usage: POD_DIR=../pod python3 tools/diag_game.py <team_key> <game_id>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_lineup_data as B  # noqa: E402


def main(key, gid):
    cfg = B.TEAMS[key]
    folder = {"pod": B.POD_SHARED, "new": B.NEW_SHARED}.get(cfg["src"], f"{B.POD_DIR}/opponents/{cfg['src']}/{B.SEASON}")
    ds = B.Dataset(folder)
    info = ds.prepare(gid)
    print("status:", info["status"], info["reason"], "| orientation:", info["orientation"], "| out_of_order clock rows:", info.get("out_of_order"))
    per = {}
    for period, secs, team, pid, play, a, h in info["rows"]:
        d = per.setdefault(period, {"n": 0, "first": None, "last": None, "min": None})
        d["n"] += 1
        if secs is not None:
            d["first"] = secs if d["first"] is None else d["first"]
            d["last"] = secs
            d["min"] = secs if d["min"] is None else min(d["min"], secs)
    for p, d in per.items():
        print(f"  period {p!r}: rows={d['n']} first_clock={d['first']} last_clock={d['last']} min_clock={d['min']}")
    box = ds.box_by_game[gid]
    bt = box[(box.team == cfg["csv_name"]) & (box.player != "TEAM")]
    print("  box minutes (team total):", bt["min"].sum(), " -> expected game length x5 =", bt["min"].sum() / 5 * 1.0, "min per player-slot")
    print(bt[["player", "min", "started"]].sort_values("min", ascending=False).head(8).to_string(index=False))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
