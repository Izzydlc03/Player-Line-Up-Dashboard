"""Draft helper: per-team 2025-26 game lists (for trend + splits) from the scraped csv1 game index."""
import csv, json, sys
SRC = sys.argv[1] if len(sys.argv) > 1 else '/Users/isabeladelacruz/Desktop/UCSD_WBB/files/csv1_game_index.csv'
KEYS = {'UC San Diego':'ucsd','California Baptist':'calbaptist','Long Beach St.':'csulb','CSUN':'csun',
        'UC Irvine':'ucirvine','Utah Valley':'utahvalley','UC Riverside':'ucr','UC Santa Barbara':'ucsb',
        'Cal Poly':'calpoly','Sacramento St.':'sacstate','Cal St. Fullerton':'csuf','CSU Bakersfield':'csub',
        'Portland St.':'portlandst','San Diego':'usd','Northern Ariz.':'nau','LMU':'lmu','Washington':'washington','San Francisco':'usf'}
games = {}
for r in csv.DictReader(open(SRC, encoding='utf-8')):
    if r['season'] != '2025-26' or 'exhibition' in r['source_url']:
        continue
    h, a = r['home_team'], r['away_team']
    hs, as_ = int(r['home_score']), int(r['away_score'])
    for team, opp, pf, pa, side in ((h, a, hs, as_, 'H'), (a, h, as_, hs, 'A')):
        k = KEYS.get(team)
        if not k: continue
        loc = 'N' if r['home_away_neutral'] == 'neutral' else side
        games.setdefault(k, []).append({'date': r['date'], 'opp': opp, 'loc': loc, 'pf': pf, 'pa': pa,
                                        'conf': r['is_conference_game'] == 'True'})
for k in games: games[k].sort(key=lambda g: g['date'])
json.dump(games, open('data/draft_games.json', 'w'), separators=(',', ':'))
print({k: len(v) for k, v in games.items()})
