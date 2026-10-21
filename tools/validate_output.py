"""Cross-check a scraped season folder (csv1-4) against itself.

Usage: python3 validate_output.py <dir> [team name ...]

For every game and both teams it checks that:
  - the sum of player points in csv2 equals the csv1 final score
  - the quarter shooting splits in csv4 reproduce the csv1 final score
  - the last score shown in the csv3 play-by-play equals the csv1 final score
"""
import sys
import pandas as pd


def made(s):
    return 0 if pd.isna(s) else int(str(s).split("-")[0])


def first_int(v):
    return int(float(str(v).split()[0]))


def main(folder, teams):
    idx = pd.read_csv(f"{folder}/csv1_game_index.csv")
    box = pd.read_csv(f"{folder}/csv2_boxscore_players.csv")
    pbp = pd.read_csv(f"{folder}/csv3_playbyplay.csv")
    q = pd.read_csv(f"{folder}/csv4_play_analysis.csv")

    bad_box = bad_q = bad_pbp = checked = ot_explained = 0
    for _, g in idx.iterrows():
        gq = q[q.game_id == g.game_id]
        reg = {}
        for _, r in gq.iterrows():
            reg[r.team] = 2 * (made(r.total_fg) - made(r.total_3p)) + 3 * made(r.total_3p) + made(r.total_ft)
        periods = {str(p) for p in pbp[pbp.game_id == g.game_id].period.dropna().unique()}
        has_ot = bool(periods - {"1", "2", "3", "4"})
        tied_in_reg = len(reg) == 2 and len(set(reg.values())) == 1
        for team, score in ((g.home_team, g.home_score), (g.away_team, g.away_score)):
            b = box[(box.game_id == g.game_id) & (box.team == team) & (box.player != "TEAM")]
            if b.pts.sum() != score:
                bad_box += 1
                print("BOX MISMATCH", g.game_id, team, b.pts.sum(), "vs", score)
            r = q[(q.game_id == g.game_id) & (q.team == team)]
            if len(r) != 1:
                bad_q += 1
                print("NO CSV4 ROW", g.game_id, team)
                continue
            r = r.iloc[0]
            fgm, tpm, ftm = made(r.total_fg), made(r.total_3p), made(r.total_ft)
            if 2 * (fgm - tpm) + 3 * tpm + ftm != score:
                # Only acceptable when csv4 holds regulation only: the game was
                # tied after 4 quarters and play-by-play shows an extra period.
                if has_ot and tied_in_reg and 2 * (fgm - tpm) + 3 * tpm + ftm < score:
                    ot_explained += 1
                else:
                    bad_q += 1
                    print("CSV4 MISMATCH", g.game_id, team)
            checked += 1
        p = pbp[pbp.game_id == g.game_id].dropna(subset=["away_score", "home_score"])
        if p.empty:
            bad_pbp += 1
            print("NO PBP SCORES", g.game_id)
            continue
        last = p.iloc[-1]
        if (first_int(last.away_score), first_int(last.home_score)) != (g.away_score, g.home_score):
            bad_pbp += 1
            print("PBP FINAL MISMATCH", g.game_id, last.away_score, last.home_score, "vs", g.away_score, g.home_score)

    print(f"games={len(idx)} team-games checked={checked} box_bad={bad_box} csv4_bad={bad_q} (ot_explained={ot_explained}) pbp_bad={bad_pbp}")
    for tn in teams:
        gm = idx[(idx.home_team == tn) | (idx.away_team == tn)]
        w = int((gm.winner == tn).sum())
        print(f"{tn}: {len(gm)} games, record {w}-{len(gm) - w}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
