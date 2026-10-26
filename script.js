(function(){
  "use strict";
  var $ = function(s,el){ return (el||document).querySelector(s); };
  var $$ = function(s,el){ return Array.prototype.slice.call((el||document).querySelectorAll(s)); };
  var tip = $('#tooltip');
  function showTip(x,y,html){ tip.innerHTML = html; tip.style.left = x+'px'; tip.style.top = (y-8)+'px'; tip.classList.add('show'); }
  function hideTip(){ tip.classList.remove('show'); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  var DATA = null;
  var state = {
    team: 'ucsd',
    view: 'overview',
    season: '2025-26',
    plView: 'scoring',
    plSort: { key:'ppg', dir:-1 },
    lineupMode: 'browse',
    lc: { A:{ team:'', id:null }, B:{ team:'', id:null } },
    mmA: 'ucsd',
    mmB: 'ucr',
    gameSample: 'season',
    minLineupMinutes: 15,
    selectedPlayer: null,
    lineupSort: { key:'min', dir:-1 },
    metric: 'ppg'
  };

  fetch('data/draft_games.json').then(function(r){ return r.json(); }).catch(function(){ return {}; })
    .then(function(g){ DRAFT_GAMES = g; return fetch('data/dashboard_data.json'); })
    .then(function(r){ return r.json(); })
    .then(function(d){ DATA = d; state.team = DATA.meta.default_team || 'ucsd'; init(); })
    .catch(function(err){
      $('#view-overview').innerHTML = '<div class="card"><b>Could not load dashboard_data.json.</b><br>'+err+'</div>';
    });

  function teamData(key){ return DATA.teams[key]; }
  function teamLabel(key){ var t = teamData(key); return t.name + (t.mascot ? ' ' + t.mascot : ''); }

  function init(){
    populateTeamSelector();
    populateGameSelector();
    renderAll();
    wireNav();
    wireControls();
    wireModal();
  }

  function renderAll(){
    updateBrand();
    renderKpis();
    renderQuarterChart();
    renderPlayers();
    renderLineupTables();
    renderCompareCards();
    renderRoster();
    renderQuality();
    renderRankChart();
    renderConfTable();
    renderFourFactors();
    renderProgression();
    renderMatchup();
    renderLineupCompare();
  }

  var VIEW_TITLES = {
    overview:   ['Team Overview', 'Season averages and scoring by quarter'],
    players:    ['Player Scoring', 'Points per quarter and advanced stats by player'],
    lineups:    ['Lineups', 'Five-player units ranked by minutes played together'],
    matchup:    ['Matchup / Scout', 'Compare two teams on the Four Factors and see what to prepare for'],
    roster:     ['2026–27 Roster', 'Who returns, who is new, and what it means for last season\'s lineups'],
    conference: ['Conference', '2025–26 results for the 12 teams in the 2026–27 Big West']
  };
  function updateBrand(){
    var t = teamData(state.team);
    var tag = t.kind === 'opponent' ? 'Non-conference opponent' : 'Big West 2026–27 member';
    var v = VIEW_TITLES[state.view];
    $('#topTitle').textContent = v[0];
    $('#topbarSub').textContent = v[1] + ' · ' + t.name + ' (' + tag + ')';
    applySeason();
  }
  /* Season is its own setting, independent of the active tab. Tabs that show
     game data have nothing to show for a season with no games yet (2026-27),
     so they get an empty-state card instead of switching the user elsewhere. */
  var SEASON_LABEL = { '2025-26':'2025\u201326', '2026-27':'2026\u201327' };
  var DATA_VIEWS = ['overview','players','lineups','matchup','conference'];
  function seasonHasGames(season){ return season === '2025-26'; }
  function applySeason(){
    var empty = !seasonHasGames(state.season);
    $('#seasonSel').value = state.season;
    DATA_VIEWS.forEach(function(id){
      var sec = $('#view-'+id);
      if (!sec) return;
      var note = $('.season-empty-note', sec);
      if (!note){
        note = document.createElement('div');
        note.className = 'card season-empty-note';
        sec.insertBefore(note, sec.firstChild);
      }
      note.innerHTML = '<b>No ' + SEASON_LABEL[state.season] + ' game stats yet.</b> ' +
        'Games for this season haven\u2019t been played, so there is nothing to show here. ' +
        'Switch the season back to ' + SEASON_LABEL['2025-26'] + ' for last season\u2019s numbers, or open the ' +
        SEASON_LABEL['2026-27'] + ' Roster tab to see who is on the team.';
      sec.classList.toggle('season-empty', empty);
    });
  }
  function setView(v){
    state.view = v;
    document.body.setAttribute('data-view', v);
    $$('.nav-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-view')===v); });
    $$('.view').forEach(function(sec){ sec.classList.toggle('active', sec.id==='view-'+v); });
    updateBrand();
  }

  /* ---------------- Selectors ---------------- */
  function teamGroups(){
    var conf = [], opp = [];
    Object.keys(DATA.teams).forEach(function(k){
      (DATA.teams[k].kind === 'opponent' ? opp : conf).push(k);
    });
    return { conf: conf, opp: opp };
  }
  function populateTeamSelector(){
    var sel = $('#teamSel');
    var g = teamGroups();
    function opt(k){ return '<option value="'+k+'"'+(k===state.team?' selected':'')+'>'+teamLabel(k)+'</option>'; }
    sel.innerHTML =
      '<optgroup label="Big West 2026–27 (12 teams)">'+g.conf.map(opt).join('')+'</optgroup>' +
      (g.opp.length ? '<optgroup label="Non-Conference Opponents (D1)">'+g.opp.map(opt).join('')+'</optgroup>' : '');
  }
  function populateGameSelector(){
    var sel = $('#gameSel');
    var tq = teamData(state.team).team_quarters;
    var keys = Object.keys(tq);
    if (keys.indexOf(state.gameSample)===-1) state.gameSample = 'season';
    sel.innerHTML = keys.map(function(k){
      return '<option value="'+k+'"'+(k===state.gameSample?' selected':'')+'>'+tq[k].label+'</option>';
    }).join('');
  }

  /* ---------------- Overview: KPIs ---------------- */
  function eligibleLineups(teamKey, minMin){
    return teamData(teamKey).lineups.filter(function(l){ return l.min >= minMin; });
  }
  function bestWorstLineups(teamKey){
    var eligible = eligibleLineups(teamKey, 20);
    if (!eligible.length) return { best:null, worst:null };
    var sorted = eligible.slice().sort(function(a,b){ return b.net_per40-a.net_per40; });
    return { best: sorted[0], worst: sorted[sorted.length-1] };
  }

  function renderKpis(){
    var t = teamData(state.team);
    var k = t.kpis;
    var bw = bestWorstLineups(state.team);
    var net = k.ppg-k.oppg;
    var tiles = [
      { lbl:'Record', val:k.record, delta:'2025–26 season', tone:'flat' },
      { lbl:'PPG', val:k.ppg.toFixed(1), delta:(net>=0?'+':'')+net.toFixed(1)+' net', tone:(net>=0?'up':'down'), rank:kRank(state.team,function(x){return x.ppg;},'high') },
      { lbl:'Opp PPG', val:k.oppg.toFixed(1), delta:'season avg allowed', tone:'flat', rank:kRank(state.team,function(x){return x.oppg;},'low') },
      { lbl:'Net Rating', val:(net>=0?'+':'')+net.toFixed(1), delta:'points per game', tone:(net>=0?'up':'down'), rank:kRank(state.team,function(x){return x.ppg-x.oppg;},'high') },
      { lbl:'Best Lineup', val:(bw.best?((bw.best.net_per40>=0?'+':'')+bw.best.net_per40.toFixed(1)):'—'), delta:'net pts / 40 min', tone:'up' },
      { lbl:'Lineups Tracked', val:t.lineups.length, delta:t.lineup_total_minutes_considered.toFixed(0)+' min reconstructed', tone:'flat' }
    ];
    $('#kpiStrip').innerHTML = tiles.map(function(tl){
      var arrow = tl.tone==='up' ? '▲' : (tl.tone==='down' ? '▼' : '·');
      return '<div class="tile"><div class="eyebrow">'+tl.lbl+'</div><div class="val">'+tl.val+'</div>'+
        '<div class="delta '+tl.tone+'">'+arrow+' '+tl.delta+'</div>'+(tl.rank?'<div class="tile-rank">'+rankChip(tl.rank)+' in Big West</div>':'')+'</div>';
    }).join('');
  }

  /* ---------------- Overview: quarter chart ---------------- */
  function renderQuarterChart(){
    var s = teamData(state.team).team_quarters[state.gameSample];
    var labels = ['Q1','Q2','Q3','Q4'];
    var all = s.us.concat(s.opp);
    var max = Math.max.apply(null, all) * 1.25;
    var html = '';
    for (var g=0; g<4; g++){
      var usH = Math.round(s.us[g]/max*170);
      var oppH = Math.round(s.opp[g]/max*170);
      html += '<div class="qgroup">' +
        '<div class="qbars">' +
          '<div class="bar" data-v="'+s.us[g].toFixed(1)+'" data-t="'+teamLabel(state.team)+'" style="height:'+usH+'px;background:var(--series-a)"><span class="barlabel">'+s.us[g].toFixed(1)+'</span></div>' +
          '<div class="bar" data-v="'+s.opp[g].toFixed(1)+'" data-t="Opponent" style="height:'+oppH+'px;background:var(--series-b)"><span class="barlabel">'+s.opp[g].toFixed(1)+'</span></div>' +
        '</div>' +
        '<div class="qlabel">'+labels[g]+'</div>' +
      '</div>';
    }
    $('#qChart').innerHTML = html;
    $('#qLegend').innerHTML =
      '<div class="legend-item"><span class="swatch" style="background:var(--series-a)"></span>'+teamData(state.team).name+'</div>' +
      '<div class="legend-item"><span class="swatch" style="background:var(--series-b)"></span>Opponent</div>';

    $$('.bar', $('#qChart')).forEach(function(b){
      b.addEventListener('mousemove', function(e){
        showTip(e.clientX, e.clientY, '<b>'+b.getAttribute('data-t')+'</b> · '+b.getAttribute('data-v')+' pts');
      });
      b.addEventListener('mouseleave', hideTip);
    });

    var margin = s.us.map(function(v,i){ return v - s.opp[i]; });
    var bestQ = margin.indexOf(Math.max.apply(null,margin));
    var worstQ = margin.indexOf(Math.min.apply(null,margin));
    $('#qInsight').innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<div><b>Read:</b> biggest scoring edge is '+labels[bestQ]+' ('+(margin[bestQ]>=0?'+':'')+margin[bestQ].toFixed(1)+' margin); '+
      labels[worstQ]+' is the softest quarter relative to the opponent ('+(margin[worstQ]>=0?'+':'')+margin[worstQ].toFixed(1)+'). — '+s.label+'</div>';
  }

  /* ---------------- Players ---------------- */
  var ADV_TIPS = {
    bpm: 'Box Plus/Minus — estimated point contribution per 100 possessions vs. an average D1 player',
    ortg: 'Offensive Rating — points produced per 100 individual possessions (adjusted)',
    usg: 'Usage% — share of the team\'s possessions this player uses while on court',
    ts: 'True Shooting% — scoring efficiency accounting for 2s, 3s, and free throws'
  };
  function advChips(adv){
    if (!adv) return '';
    var chips = [];
    if (adv.bpm !== null && adv.bpm !== undefined){
      chips.push({ tip:ADV_TIPS.bpm, label:'BPM', val:(adv.bpm>=0?'+':'')+adv.bpm.toFixed(1), tone: adv.bpm>=2?'good':(adv.bpm<=-2?'bad':'') });
    }
    if (adv.adjoe !== null && adv.adjoe !== undefined){
      chips.push({ tip:ADV_TIPS.ortg, label:'ORtg', val:adv.adjoe.toFixed(0), tone:'' });
    }
    if (adv.usg !== null && adv.usg !== undefined){
      chips.push({ tip:ADV_TIPS.usg, label:'USG%', val:(adv.usg*100).toFixed(1), tone:'' });
    }
    if (adv.ts !== null && adv.ts !== undefined){
      chips.push({ tip:ADV_TIPS.ts, label:'TS%', val:(adv.ts*100).toFixed(1), tone:'' });
    }
    if (!chips.length) return '';
    return '<div class="adv-row">' + chips.map(function(c){
      return '<span class="adv-chip'+(c.tone?' tone-'+c.tone:'')+'" data-tip="'+c.tip+'">'+c.label+' <b>'+c.val+'</b></span>';
    }).join('') + '</div>';
  }

  /* ---------------- Lineups ---------------- */
  function filteredLineups(teamKey){
    var q = $('#lineupSearch').value.trim().toLowerCase();
    return teamData(teamKey).lineups.filter(function(l){
      if (l.min < state.minLineupMinutes) return false;
      if (q && l.players.join(' ').toLowerCase().indexOf(q)===-1) return false;
      return true;
    });
  }
  function sortLineups(rows){
    var sort = state.lineupSort;
    rows.sort(function(a,b){
      var av=a[sort.key]||0, bv=b[sort.key]||0;
      if (sort.key==='players'){ av=a.players.join(' '); bv=b.players.join(' '); return av.localeCompare(bv)*sort.dir; }
      return (av-bv)*sort.dir;
    });
    return rows;
  }

  function retPill(l){
    if (l.returning == null) return '<span class="muted">—</span>';
    var cls = l.returning>=4 ? 'ret-high' : (l.returning>=3 ? 'ret-mid' : 'ret-low');
    return '<span class="pill '+cls+'" title="'+esc(l.returning_names.join(', ') || 'none')+' return">'+l.returning+' of 5</span>';
  }

  function lineupTableHtml(teamKey, idPrefix){
    var rows = sortLineups(filteredLineups(teamKey));
    var allMax = Math.max.apply(null, teamData(teamKey).lineups.map(function(l){ return Math.abs(l.net_per40); })) || 1;
    var body = rows.map(function(l){
      var pct = Math.round(Math.abs(l.net_per40)/allMax*100);
      var pos = l.net_per40>=0;
      return '<tr class="lineup-row" data-team="'+teamKey+'" data-id="'+l.id+'">' +
        '<td><div class="lineup-players">'+esc(l.players.join(' · '))+'</div>'+(l.min<20?'<span class="pill tag small-sample" title="Under 20 minutes together: the net rating can swing a lot on a few possessions">small sample</span>':'')+'</td>' +
        '<td class="num">'+l.min.toFixed(1)+'</td>' +
        '<td class="num">'+l.for_pts+'</td>' +
        '<td class="num">'+l.against_pts+'</td>' +
        '<td class="num" style="color:'+(l.net>=0?'var(--good)':'var(--critical)')+'">'+(l.net>=0?'+':'')+l.net+'</td>' +
        '<td class="num"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">' +
          '<div class="netbar"><i style="'+(pos?'left:50%':'right:50%')+';width:'+(pct/2)+'%;background:'+(pos?'var(--good)':'var(--critical)')+'"></i></div>' +
          '<span class="num" style="color:'+(pos?'var(--good)':'var(--critical)')+'">'+(pos?'+':'')+l.net_per40.toFixed(1)+'</span>' +
        '</div></td>' +
        '<td class="num">'+retPill(l)+'</td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);padding:22px">No lineups match this filter.</td></tr>';

    return '<div class="lineup-table-col">' +
      '<div class="col-head">'+teamLabel(teamKey)+' <span class="pill">'+rows.length+' lineups</span></div>' +
      '<div class="table-wrap"><table id="'+idPrefix+'"><thead><tr>' +
        '<th><button class="th-sort" data-key="players">Lineup</button></th>' +
        '<th class="num"><button class="th-sort" data-key="min">Min</button></th>' +
        '<th class="num"><button class="th-sort" data-key="for_pts">For</button></th>' +
        '<th class="num"><button class="th-sort" data-key="against_pts">Against</button></th>' +
        '<th class="num"><button class="th-sort" data-key="net">Net</button></th>' +
        '<th class="num"><button class="th-sort" data-key="net_per40">Net/40</button></th>' +
        '<th class="num"><button class="th-sort" data-key="returning" title="How many of these five players are on the 2026-27 roster">Back \u201926-27</button></th>' +
      '</tr></thead><tbody>'+body+'</tbody></table></div>' +
    '</div>';
  }

  function renderLineupTables(){
    var container = $('#lineupTables');
    container.className = 'lineup-tables';
    $('#lineupCardTitle').textContent = 'Five-player lineup usage';
    container.innerHTML = lineupTableHtml(state.team, 'lineupTableA');

    $$('.th-sort', container).forEach(function(btn){
      btn.addEventListener('click', function(){
        var key = btn.getAttribute('data-key');
        if (state.lineupSort.key===key){ state.lineupSort.dir *= -1; } else { state.lineupSort = { key:key, dir:-1 }; }
        renderLineupTables();
      });
    });
    $$('.lineup-row', container).forEach(function(row){
      row.addEventListener('click', function(){
        openLineupModal(row.getAttribute('data-team'), row.getAttribute('data-id'));
      });
    });

    var t0 = teamData(state.team), q0 = t0.data_quality;
    $('#lineupNote').textContent = 'Built from ' + q0.games_lineup_used + ' of ' + q0.games_total + ' games (' + t0.lineup_total_minutes_considered.toFixed(0) +
      ' on-court minutes). ' + (q0.games_lineup_used < q0.games_total ? 'Games that could not be verified against the box score are left out. ' : '') +
      '"Back \u201926-27" counts how many of the five are on the 2026\u201327 roster. Click a lineup for its full breakdown.';
  }

  function renderCompareCards(){
    var bw = bestWorstLineups(state.team);
    if (!bw.best){ $('#bestTitle').textContent = 'Not enough data'; $('#worstTitle').textContent=''; return; }
    function fill(prefix, l){
      $('#'+prefix+'Title').textContent = l.players.join(' · ');
      $('#'+prefix+'Sub').textContent = 'Net '+(l.net>=0?'+':'')+l.net+' pts over '+l.min.toFixed(1)+' minutes on court';
      var maxVal = Math.max(l.for_pts/l.min*40, l.against_pts/l.min*40) * 1.15;
      var forPct = Math.round((l.for_pts/l.min*40)/maxVal*100);
      var againstPct = Math.round((l.against_pts/l.min*40)/maxVal*100);
      $('#'+prefix+'Metrics').innerHTML =
        '<div class="barchart-row"><div class="barchart-label">Pts for / 40</div><div class="barchart-track"><div class="barchart-bar" style="width:'+forPct+'%;background:var(--good)"></div></div><div class="barchart-val">'+(l.for_pts/l.min*40).toFixed(1)+'</div></div>' +
        '<div class="barchart-row"><div class="barchart-label">Pts against / 40</div><div class="barchart-track"><div class="barchart-bar" style="width:'+againstPct+'%;background:var(--critical)"></div></div><div class="barchart-val">'+(l.against_pts/l.min*40).toFixed(1)+'</div></div>';
    }
    fill('best', bw.best);
    fill('worst', bw.worst);
  }

  /* ---------------- Lineup detail modal ---------------- */
  function efg(per40, prefix){
    prefix = prefix || '';
    var fga = per40[prefix+'fga'];
    return fga ? (per40[prefix+'fgm'] + 0.5*per40[prefix+'tpm']) / fga * 100 : 0;
  }

  var METRICS = [
    { key:'efg_for',  label:'eFG% (offense)',   higher:true,  pct:true,  get:function(p){ return efg(p); } },
    { key:'efg_ag',   label:'eFG% allowed',     higher:false, pct:true,  get:function(p){ return efg(p,'opp_'); } },
    { key:'ast',      label:'Assists / 40',     higher:true,  pct:false, get:function(p){ return p.ast; } },
    { key:'tov',      label:'Turnovers / 40',   higher:false, pct:false, get:function(p){ return p.tov; } },
    { key:'oreb',     label:'Off. reb / 40',    higher:true,  pct:false, get:function(p){ return p.oreb; } },
    { key:'dreb',     label:'Def. reb / 40',    higher:true,  pct:false, get:function(p){ return p.dreb; } },
    { key:'stl',      label:'Steals / 40',      higher:true,  pct:false, get:function(p){ return p.stl; } },
    { key:'opp_tov',  label:'Opp. TOV forced/40', higher:true, pct:false, get:function(p){ return p.opp_tov; } }
  ];

  function classify(m, lineupVal, teamVal){
    var diff = lineupVal - teamVal;
    var better = m.higher ? diff > 0 : diff < 0;
    var big = m.pct ? Math.abs(diff) >= 2.5 : Math.abs(diff) >= Math.max(0.6, teamVal*0.12);
    if (!big) return 'flat';
    return better ? 'good' : 'bad';
  }

  function outlookHtml(l){
    if (l.returning == null) return '';
    var back = l.returning_names.map(function(n){ return '<span class="pill ret-high">'+esc(n)+'</span>'; }).join('');
    var gone = l.departed_names.map(function(n){ return '<span class="pill gone">'+esc(n)+'</span>'; }).join('');
    return '<div class="modal-section-title">2026–27 outlook — '+l.returning+' of 5 on the current roster</div>' +
      '<div class="outlook">'+back+gone+'</div>';
  }

  function openLineupModal(teamKey, lineupId){
    var team = teamData(teamKey);
    var l = team.lineups.filter(function(x){ return x.id===lineupId; })[0];
    if (!l) return;
    var teamAvg = team.team_avg_per40;

    var metricRows = METRICS.map(function(m){
      var lv = m.get(l.per40), tv = m.get(teamAvg);
      var tag = classify(m, lv, tv);
      var pct = Math.min(100, Math.max(4, (lv/(tv*1.6||1))*100));
      var color = tag==='good' ? 'var(--good)' : (tag==='bad' ? 'var(--critical)' : 'var(--ink-faint)');
      return '<div class="metric-row">' +
        '<div class="mname">'+m.label+'</div>' +
        '<div class="mtrack"><i style="width:'+pct+'%;background:'+color+'"></i></div>' +
        '<div class="mval '+tag+'">'+lv.toFixed(1)+(m.pct?'%':'')+'</div>' +
      '</div>';
    }).join('');

    var vsOppHtml = vsOppListHtml(l);

    $('#modalContent').innerHTML =
      '<div class="modal-head">' +
        '<div class="eyebrow">'+teamLabel(teamKey)+'</div>' +
        '<h3>'+esc(l.players.join(' · '))+'</h3>' +
        '<div class="sub">'+l.min.toFixed(1)+' minutes on court together this season</div>' +
      '</div>' +
      '<div class="modal-kpis">' +
        '<div class="tile"><div class="eyebrow">Minutes</div><div class="val">'+l.min.toFixed(1)+'</div></div>' +
        '<div class="tile"><div class="eyebrow">Pts For</div><div class="val">'+l.for_pts+'</div></div>' +
        '<div class="tile"><div class="eyebrow">Pts Against</div><div class="val">'+l.against_pts+'</div></div>' +
        '<div class="tile"><div class="eyebrow">Net / 40</div><div class="val" style="color:'+(l.net_per40>=0?'var(--good)':'var(--critical)')+'">'+(l.net_per40>=0?'+':'')+l.net_per40.toFixed(1)+'</div></div>' +
      '</div>' +
      outlookHtml(l) +
      '<div class="modal-section-title">Strengths &amp; weaknesses — vs. '+team.name+'\'s overall per-40 rate</div>' +
      '<div class="metric-grid">'+metricRows+'</div>' +
      '<div class="modal-section-title">Performance vs. opponents faced (min. 3 minutes on court)</div>' +
      '<div class="vsopp-list">'+vsOppHtml+'</div>' +
      '<div class="modal-actions"><button class="btn primary" id="lcFromModal">Compare this lineup with another</button></div>';
    $('#lcFromModal').addEventListener('click', function(){
      state.lc.A = { team:teamKey, id:lineupId };
      closeModal(); setLineupMode('compare');
    });

    $('#modalBackdrop').classList.add('open');
  }

  function wireModal(){
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', function(e){ if (e.target===$('#modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', function(e){ if (e.key==='Escape') closeModal(); });
  }
  function closeModal(){ $('#modalBackdrop').classList.remove('open'); }

  /* ---------------- 2026-27 roster ---------------- */
  function renderRoster(){
    var t = teamData(state.team), r = t.roster_2026_27;
    var tiles = $('#rosterTiles');
    if (!r){
      tiles.innerHTML = '';
      $('#rosterBody').innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--ink-faint);padding:22px">No 2026–27 roster loaded for this team.</td></tr>';
      $('#departedBody').innerHTML = ''; $('#returningDist').innerHTML = ''; $('#rosterNote').textContent = '';
      return;
    }
    var sm = r.summary;
    $('#rosterTitle').textContent = teamLabel(state.team) + ' — 2026–27 roster';
    tiles.className = 'tiles five';
    tiles.innerHTML = [
      { lbl:'Roster size', val:sm.roster_size, delta:'players listed', tone:'flat' },
      { lbl:'Returning', val:sm.returning, delta:'also played in 2025–26', tone: sm.returning>=sm.new ? 'up' : 'flat' },
      { lbl:'New', val:sm.new, delta:'freshmen, transfers, newcomers', tone:'flat' },
      { lbl:'Minutes back', val:sm.returning_min_pct.toFixed(0)+'%', delta:'of 2025–26 player minutes', tone: sm.returning_min_pct>=50 ? 'up' : 'down' },
      { lbl:'Points back', val:sm.returning_pts_pct.toFixed(0)+'%', delta:'of 2025–26 points', tone: sm.returning_pts_pct>=50 ? 'up' : 'down' }
    ].map(function(x){
      var arrow = x.tone==='up' ? '▲' : (x.tone==='down' ? '▼' : '·');
      return '<div class="tile"><div class="eyebrow">'+x.lbl+'</div><div class="val">'+x.val+'</div><div class="delta '+x.tone+'">'+arrow+' '+x.delta+'</div></div>';
    }).join('');

    $('#rosterBody').innerHTML = r.players.map(function(p){
      var ret = p.status==='returning';
      return '<tr>' +
        '<td class="num">'+esc(p.jersey)+'</td>' +
        '<td><div class="lineup-players">'+esc(p.name)+'</div></td>' +
        '<td>'+esc(p.pos)+'</td><td>'+esc(p.height)+'</td><td>'+esc(p.cls)+'</td>' +
        '<td>'+esc(p.from)+'</td>' +
        '<td><span class="pill '+(ret?'ret-high':'new')+'">'+(ret?'Returning':'New')+'</span></td>' +
        '<td class="num">'+(ret ? p.prev.mpg.toFixed(1) : '—')+'</td>' +
        '<td class="num">'+(ret ? p.prev.ppg.toFixed(1) : '—')+'</td>' +
      '</tr>';
    }).join('');

    $('#departedBody').innerHTML = r.departed.length ? r.departed.map(function(d){
      return '<tr><td><div class="lineup-players">'+esc(d.name)+'</div></td><td class="num">'+d.gp+'</td><td class="num">'+d.mpg.toFixed(1)+'</td>' +
        '<td class="num">'+d.ppg.toFixed(1)+'</td><td class="num">'+d.min_share_pct.toFixed(1)+'%</td><td class="num">'+d.pts_share_pct.toFixed(1)+'%</td></tr>';
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);padding:18px">Every 2025–26 player is on the current roster.</td></tr>';

    var labels = { '5':'All 5 return', '4':'4 of 5 return', '3':'3 of 5 return', '2':'2 of 5 return', '1':'1 of 5 returns', '0':'None return' };
    $('#returningDist').innerHTML = ['5','4','3','2','1','0'].map(function(n){
      var v = sm.lineup_min_by_returning[n] || 0;
      return '<div class="dist-row"><div class="dlabel">'+labels[n]+'</div><div class="dtrack"><div class="dfill" style="width:'+v+'%"></div></div><div class="dval">'+v.toFixed(1)+'%</div></div>';
    }).join('');

    $('#rosterNote').textContent = 'Source: ' + r.source_url + ' (fetched ' + (DATA.meta.roster_fetched || 'n/a') + '). Rosters can change before the season; verify before relying on them.' +
      (r.match_notes && r.match_notes.length ? ' Matching notes: ' + r.match_notes.join('; ') : '');
  }

  /* ---------------- data quality ---------------- */
  function renderQuality(){
    var t = teamData(state.team), q = t.data_quality;
    var items = [];
    items.push('Lineup stats use <b>'+q.games_lineup_used+' of '+q.games_total+'</b> games.');
    var mc = q.minutes_check;
    items.push('Player minutes rebuilt from substitutions match the box score within <b class="'+(mc.total_abs_diff_pct<=1?'dq-ok':'dq-warn')+'">'+mc.total_abs_diff_pct+'%</b> (checked over '+mc.games_checked+' games).');
    var pc = q.points_check;
    items.push(pc.mismatches===0 ? 'Points credited from play-by-play equal the box score for <b class="dq-ok">all '+pc.players_checked+' players</b>.'
      : '<b class="dq-warn">'+pc.mismatches+' player(s)</b> differ from the box score by a basket: '+pc.examples.map(function(e){ return esc(e.player)+' ('+e.pbp+' vs '+e.box+')'; }).join(', ')+'. The sources disagree on who scored.');
    if (q.orientation_flipped) items.push('<b>'+q.orientation_flipped+'</b> game(s) had home/away scores flipped in the play-by-play; corrected using the final score.');
    if (q.inferred_missing_subs) items.push(q.inferred_missing_subs+' missing substitution(s) inferred from a player recording a play while fewer than five were tracked.');
    if (q.unattributed_pct) items.push(q.unattributed_pct+'% of game time could not be assigned to a five-player lineup and is left out.');
    var html = '<ul><li>'+items.join('</li><li>')+'</li></ul>';
    if (q.excluded.length){
      html += '<b>Left out of lineup stats:</b><ul>' + q.excluded.map(function(e){ return '<li>'+esc(e.game_id)+' — '+esc(e.reason)+(e.scope ? ' (player scoring still counted)' : '')+'</li>'; }).join('') + '</ul>';
    }
    if (q.box_minutes_unreliable_games.length){
      html += '<b>Box score minutes unusable (source error):</b><ul>' + q.box_minutes_unreliable_games.map(function(e){ return '<li>'+esc(e.game_id)+' — box minutes total '+e.box_minutes_total+', expected '+e.expected+'</li>'; }).join('') + '</ul>';
    }
    if (q.advanced_ambiguous && q.advanced_ambiguous.length){
      html += 'Advanced stats withheld where the national file splits one player across rows: ' + q.advanced_ambiguous.map(esc).join(', ') + '.';
    }
    $('#dqBody').innerHTML = html;
  }

  /* ---------------- Conference ---------------- */
  var metricMeta = {
    ppg:{ fmt:function(v){return v.toFixed(1);} },
    oppg:{ fmt:function(v){return v.toFixed(1);} },
    net:{ fmt:function(v){return (v>=0?'+':'')+v.toFixed(1);} },
    pace:{ fmt:function(v){return v.toFixed(1);} }
  };
  function renderRankChart(){
    var m = state.metric;
    var sorted = DATA.conference.slice().sort(function(a,b){ return b[m]-a[m]; });
    var vals = DATA.conference.map(function(t){ return t[m]; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var base = Math.min(0, min);
    $('#rankChart').innerHTML = sorted.map(function(t){
      var isSelf = t.key===state.team;
      var pct = Math.max(4, Math.round((t[m]-base)/(max-base)*100));
      return '<div class="rankbar-row'+(isSelf?' self':'')+'">' +
        '<div class="rname">'+esc(t.name)+'</div>' +
        '<div class="rankbar-track"><div class="rankbar-fill" style="width:'+pct+'%"></div></div>' +
        '<div class="rankbar-val">'+metricMeta[m].fmt(t[m])+'</div>' +
      '</div>';
    }).join('');
  }

  function renderConfTable(){
    var sorted = DATA.conference.slice().sort(function(a,b){ return b.net-a.net; });
    $('#confBody').innerHTML = sorted.map(function(t){
      var isSelf = t.key===state.team;
      return '<tr class="'+(isSelf?'self':'')+'">' +
        '<td>'+esc(t.name)+'</td>' +
        '<td>'+esc(t.record)+'</td>' +
        '<td>'+t.ppg.toFixed(1)+'</td>' +
        '<td>'+t.oppg.toFixed(1)+'</td>' +
        '<td style="color:'+(t.net>=0?'var(--good)':'var(--critical)')+'">'+(t.net>=0?'+':'')+t.net.toFixed(1)+'</td>' +
        '<td>'+t.pace.toFixed(1)+'</td>' +
      '</tr>';
    }).join('');
  }

  /* ================= PLAYER TABLE + DETAIL (lineup-dashboard stats) ================= */
  var _plCache = {};
  function initialsOf(n){ var p = n.split(/\s+/); return ((p[0]||'?')[0] + (p.length>1 ? p[p.length-1][0] : '')).toUpperCase(); }
  function sumArr(a){ return a.reduce(function(x,y){ return x+y; }, 0); }

  /* what this dashboard knows about a player beyond the box score: the five-player units they were part of */
  function lineupStatsFor(teamKey, name){
    var ck = teamKey+'|'+name;
    if (_plCache[ck]) return _plCache[ck];
    var ls = teamData(teamKey).lineups.filter(function(l){ return l.players.indexOf(name) !== -1; });
    var min = 0, net = 0, mates = {};
    ls.forEach(function(l){
      min += l.min; net += l.net;
      l.players.forEach(function(m){
        if (m === name) return;
        var o = mates[m] || (mates[m] = { name:m, min:0, net:0 });
        o.min += l.min; o.net += l.net;
      });
    });
    var best = ls.filter(function(l){ return l.min >= 20; }).sort(function(a,b){ return b.net_per40 - a.net_per40; })[0] || null;
    var res = {
      lineups: ls, count: ls.length, min: min, net40: min ? net/min*40 : null, best: best,
      mates: Object.keys(mates).map(function(k){ var o = mates[k]; o.net40 = o.min ? o.net/o.min*40 : 0; return o; })
        .sort(function(a,b){ return b.min - a.min; })
    };
    return (_plCache[ck] = res);
  }

  function dash(v, f){ return (v === null || v === undefined || isNaN(v)) ? '<span class="muted">—</span>' : f(v); }
  function advGet(k){ return function(p){ return p.adv && p.adv[k] != null ? p.adv[k] : null; }; }
  var PL_VIEWS = {
    scoring: {
      hint: 'Points per game and how they split across the four quarters. Click a player for detail.',
      sort: { key:'ppg', dir:-1 },
      cols: [
        { k:'gp',  l:'GP',  get:function(p){ return p.gp; },   f:function(v){ return v; } },
        { k:'ppg', l:'PPG', get:function(p){ return p.ppg; },  f:function(v){ return '<b>'+v.toFixed(1)+'</b>'; } },
        { k:'q1',  l:'Q1',  get:function(p){ return p.q[0]; }, f:function(v){ return v.toFixed(1); } },
        { k:'q2',  l:'Q2',  get:function(p){ return p.q[1]; }, f:function(v){ return v.toFixed(1); } },
        { k:'q3',  l:'Q3',  get:function(p){ return p.q[2]; }, f:function(v){ return v.toFixed(1); } },
        { k:'q4',  l:'Q4',  get:function(p){ return p.q[3]; }, f:function(v){ return v.toFixed(1); } },
        { k:'bq',  l:'Best qtr', get:function(p){ return p.q.indexOf(Math.max.apply(null,p.q))+1; }, f:function(v){ return 'Q'+v; } }
      ]
    },
    efficiency: {
      hint: 'How efficiently each player scores and how much of the offense they use. Hover a column header for what it means.',
      sort: { key:'bpm', dir:-1 },
      cols: [
        { k:'gp',   l:'GP',   get:function(p){ return p.gp; }, f:function(v){ return v; } },
        { k:'usg',  l:'USG%', tip:ADV_TIPS.usg, get:advGet('usg'),   f:function(v){ return (v*100).toFixed(1); } },
        { k:'ts',   l:'TS%',  tip:ADV_TIPS.ts,  get:advGet('ts'),    f:function(v){ return (v*100).toFixed(1); } },
        { k:'efg',  l:'eFG%', tip:'Effective field goal % — 3-pointers count as 1.5 shots', get:advGet('efg'), f:function(v){ return (v*100).toFixed(1); } },
        { k:'ortg', l:'ORtg', tip:ADV_TIPS.ortg, get:advGet('adjoe'), f:function(v){ return v.toFixed(0); } },
        { k:'drtg', l:'DRtg', tip:'Defensive Rating — points allowed per 100 possessions while the player is on court (lower is better)', get:advGet('drtg'), f:function(v){ return v.toFixed(0); } },
        { k:'bpm',  l:'BPM',  tip:ADV_TIPS.bpm, get:advGet('bpm'),   f:function(v){ return '<b style="color:'+(v>=0?'var(--good)':'var(--critical)')+'">'+(v>=0?'+':'')+v.toFixed(1)+'</b>'; } }
      ]
    },
    lineup: {
      hint: 'How the team performs with this player on the floor, from every five-player unit (6+ minutes) they were part of.',
      sort: { key:'min', dir:-1 },
      cols: [
        { k:'gp',    l:'GP',          get:function(p){ return p.gp; }, f:function(v){ return v; } },
        { k:'count', l:'Lineups',     tip:'Number of different five-player units (6+ minutes) the player appeared in', get:function(p,t){ return lineupStatsFor(t,p.name).count; }, f:function(v){ return v; } },
        { k:'min',   l:'Lineup min',  tip:'Minutes played in those lineups', get:function(p,t){ var s = lineupStatsFor(t,p.name); return s.count ? s.min : null; }, f:function(v){ return v.toFixed(0); } },
        { k:'net40', l:'On-court net / 40', tip:'Points scored minus allowed per 40 minutes across all of the player’s lineups', get:function(p,t){ return lineupStatsFor(t,p.name).net40; }, f:function(v){ return '<b style="color:'+netColor(v)+'">'+netFmt(v)+'</b>'; } },
        { k:'best',  l:'Best lineup net / 40', tip:'Best net rating among their lineups with 20+ minutes', get:function(p,t){ var s = lineupStatsFor(t,p.name); return s.best ? s.best.net_per40 : null; }, f:function(v){ return netFmt(v); } }
      ]
    }
  };

  function renderPlayers(){
    var key = state.team, t = teamData(key), v = PL_VIEWS[state.plView];
    $('#plTitle').textContent = t.name + ' — player stats';
    $('#plHint').textContent = v.hint;
    $$('#plSeg button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-pl') === state.plView); });

    var sc = v.cols.filter(function(c){ return c.k === state.plSort.key; })[0];
    var rows = t.roster_players.map(function(p){ return p; });
    rows.sort(function(a,b){
      if (state.plSort.key === 'name') return a.name.localeCompare(b.name) * state.plSort.dir;
      if (!sc) return 0;
      var av = sc.get(a,key), bv = sc.get(b,key);
      av = av == null ? -Infinity : av; bv = bv == null ? -Infinity : bv;
      return (av - bv) * state.plSort.dir;
    });

    function arrow(k){ return state.plSort.key === k ? (state.plSort.dir < 0 ? ' ↓' : ' ↑') : ''; }
    $('#plHead').innerHTML = '<tr><th><button class="th-sort" data-k="name">Player'+arrow('name')+'</button></th>' +
      v.cols.map(function(c){ return '<th class="num"'+(c.tip?' title="'+esc(c.tip)+'"':'')+'><button class="th-sort" data-k="'+c.k+'">'+c.l+arrow(c.k)+'</button></th>'; }).join('') + '</tr>';
    $('#plBody').innerHTML = rows.map(function(p){
      var a = p.adv || {};
      var sub = [a.cls, a.pos].filter(Boolean).join(' · ');
      return '<tr class="pl-row" tabindex="0" data-name="'+esc(p.name)+'">' +
        '<td><div class="pl-name"><span class="pl-av">'+esc(initialsOf(p.name))+'</span><div><b>'+esc(p.name)+'</b> <span class="jersey">#'+esc(p.jersey)+'</span>' +
        (sub ? '<div class="pl-sub">'+esc(sub)+'</div>' : '') + '</div></div></td>' +
        v.cols.map(function(c){ return '<td class="num">'+dash(c.get(p,key), c.f)+'</td>'; }).join('') + '</tr>';
    }).join('');
    $('#plNote').textContent = t.roster_players.length + ' players · click a row for lineups, teammates and efficiency detail. ' +
      (state.plView === 'lineup' ? 'Lineup numbers only count five-player units with 6+ minutes together.' : '');

    $$('#plHead .th-sort').forEach(function(btn){
      btn.addEventListener('click', function(){
        var k = btn.getAttribute('data-k');
        state.plSort = (state.plSort.key === k) ? { key:k, dir:-state.plSort.dir } : { key:k, dir:(k === 'name' ? 1 : -1) };
        renderPlayers();
      });
    });
    $$('#plBody .pl-row').forEach(function(row){
      function open(){ openPlayerModal(key, row.getAttribute('data-name')); }
      row.addEventListener('click', open);
      row.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
    });
    renderPlayerInsight();
  }

  function renderPlayerInsight(){
    var box = $('#playerInsight');
    var roster = teamData(state.team).roster_players;
    var top = roster.slice().sort(function(a,b){ return b.q[2]-a.q[2]; })[0];
    box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<div><b>Read:</b> '+esc(top.name)+' carries the largest 3rd-quarter scoring load ('+top.q[2].toFixed(2)+' pts/gm). Click any player for how they split points across quarters and which lineups they play best in.</div>';
  }

  function openPlayerModal(teamKey, name){
    var t = teamData(teamKey);
    var p = t.roster_players.filter(function(x){ return x.name === name; })[0];
    if (!p) return;
    var a = p.adv || {}, ls = lineupStatsFor(teamKey, name);
    var teamQ = t.team_quarters.season.us, teamTot = sumArr(teamQ) || 1, pTot = sumArr(p.q) || 1;
    var maxShare = Math.max.apply(null, p.q.map(function(v){ return v/pTot; }).concat(teamQ.map(function(v){ return v/teamTot; }))) || 1;
    var diffs = p.q.map(function(v,i){ return v/pTot - teamQ[i]/teamTot; });
    var hi = diffs.indexOf(Math.max.apply(null, diffs));

    var status = '';
    var r = t.roster_2026_27;
    if (r){
      var cur = r.players.filter(function(x){ return x.name === name; })[0];
      var gone = r.departed.filter(function(x){ return x.name === name; })[0];
      status = cur ? '<span class="pill ret-high">On the 2026–27 roster</span>' : (gone ? '<span class="pill gone">Not on the 2026–27 roster</span>' : '');
    }

    var qRows = p.q.map(function(v,i){
      var ps = v/pTot, ts = teamQ[i]/teamTot;
      return '<div class="pm-qrow"><span class="qn">Q'+(i+1)+'</span>' +
        '<div class="pm-bars"><i class="p" style="width:'+(ps/maxShare*100).toFixed(1)+'%"></i><i class="t" style="width:'+(ts/maxShare*100).toFixed(1)+'%"></i></div>' +
        '<span class="num pm-ppg">'+v.toFixed(1)+' <small>pts/gm</small></span>' +
        '<span class="pm-share"><b>'+Math.round(ps*100)+'%</b> of their points · team '+Math.round(ts*100)+'%</span></div>';
    }).join('');

    var lineupHtml;
    if (!ls.count){
      lineupHtml = '<div class="muted">Not part of any five-player unit with 6+ minutes together.</div>';
    } else {
      var topL = ls.lineups.slice().sort(function(x,y){ return y.min - x.min; }).slice(0,5);
      lineupHtml = '<div class="modal-kpis three">' +
        '<div class="tile"><div class="eyebrow">Lineups</div><div class="val">'+ls.count+'</div></div>' +
        '<div class="tile"><div class="eyebrow">Minutes in them</div><div class="val">'+ls.min.toFixed(0)+'</div></div>' +
        '<div class="tile"><div class="eyebrow">On-court net / 40</div><div class="val" style="color:'+netColor(ls.net40)+'">'+netFmt(ls.net40)+'</div></div></div>' +
        '<div class="modal-section-title">Most-used lineups with '+esc(name.split(' ')[0])+'</div>' +
        '<table class="pm-table"><thead><tr><th>Lineup</th><th class="num">Min</th><th class="num">Net / 40</th></tr></thead><tbody>' +
        topL.map(function(l){
          return '<tr><td>'+l.players.map(function(n){ return n===name ? '<b>'+esc(n)+'</b>' : esc(n); }).join(' · ')+'</td>' +
            '<td class="num">'+l.min.toFixed(0)+'</td><td class="num" style="color:'+netColor(l.net_per40)+'">'+netFmt(l.net_per40)+'</td></tr>';
        }).join('') + '</tbody></table>' +
        '<div class="modal-section-title">Plays most with</div>' +
        '<table class="pm-table"><thead><tr><th>Teammate</th><th class="num">Min together</th><th class="num">Net / 40</th></tr></thead><tbody>' +
        ls.mates.slice(0,5).map(function(m){
          return '<tr><td>'+esc(m.name)+'</td><td class="num">'+m.min.toFixed(0)+'</td><td class="num" style="color:'+netColor(m.net40)+'">'+netFmt(m.net40)+'</td></tr>';
        }).join('') + '</tbody></table>';
    }

    function tile(label, val){ return '<div class="tile"><div class="eyebrow">'+label+'</div><div class="val">'+val+'</div></div>'; }
    $('#modalContent').innerHTML =
      '<div class="modal-head"><div class="pm-head"><span class="pm-avatar">'+esc(initialsOf(name))+'</span><div>' +
        '<div class="eyebrow">'+esc(teamLabel(teamKey))+'</div><h3>'+esc(name)+' <span class="muted">#'+esc(p.jersey)+'</span></h3>' +
        '<div class="sub">'+esc([a.cls, a.pos].filter(Boolean).join(' · '))+(a.cls||a.pos?' · ':'')+p.gp+' games '+status+'</div></div></div></div>' +
      '<div class="modal-kpis">' +
        tile('PPG', p.ppg.toFixed(1)) + tile('USG%', a.usg!=null ? (a.usg*100).toFixed(1) : '—') +
        tile('TS%', a.ts!=null ? (a.ts*100).toFixed(1) : '—') +
        tile('BPM', a.bpm!=null ? '<span style="color:'+netColor(a.bpm)+'">'+netFmt(a.bpm)+'</span>' : '—') + '</div>' +
      advChips(p.adv) +
      '<div class="modal-section-title">Points by quarter — their shape vs. the team’s</div>' +
      '<div class="legend pm-legend"><div class="legend-item"><span class="swatch" style="background:var(--series-a)"></span>Share of the player’s points</div>' +
        '<div class="legend-item"><span class="swatch" style="background:var(--series-b)"></span>Share of team points</div></div>' +
      qRows +
      '<div class="insight" style="margin-top:10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
        '<div><b>Read:</b> '+(diffs[hi] > 0.02 ? 'scores a bigger share of their points in Q'+(hi+1)+' than the team does — worth featuring them early in that stretch.' : 'scores in about the same pattern as the team across the four quarters.')+'</div></div>' +
      '<div class="modal-section-title">Lineup impact</div>' + lineupHtml +
      '<div class="source-note" style="margin-top:12px">Per-game shot charts and game logs are on the Player Overview dashboard. This view focuses on quarters and lineups.</div>';
    $$('.adv-chip', $('#modalContent')).forEach(function(c){
      c.addEventListener('mousemove', function(e){ showTip(e.clientX, e.clientY, c.getAttribute('data-tip')); });
      c.addEventListener('mouseleave', hideTip);
    });
    $('#modalBackdrop').classList.add('open');
  }

  /* ================= COMPARE TWO LINEUPS ================= */
  function lineupAbbrev(l){
    return l.players.map(function(n){ var p = n.split(/\s+/); return p[0][0] + '. ' + p.slice(1).join(' '); }).join(' · ');
  }
  function topLineupId(teamKey){
    var ls = teamData(teamKey).lineups.slice().sort(function(a,b){ return b.min - a.min; });
    return ls[0] ? ls[0].id : null;
  }
  function lcEnsure(){
    var lc = state.lc;
    if (!lc.A.team || !DATA.teams[lc.A.team]) lc.A = { team:state.team, id:null };
    if (!lc.A.id || !teamData(lc.A.team).lineups.some(function(l){ return l.id === lc.A.id; })) lc.A.id = topLineupId(lc.A.team);
    if (!lc.B.team || !DATA.teams[lc.B.team]){
      var pick = confKeys().filter(function(k){ return k !== lc.A.team; });
      lc.B = { team:(pick.indexOf('ucr') !== -1 ? 'ucr' : pick[0]), id:null };
    }
    if (!lc.B.id || !teamData(lc.B.team).lineups.some(function(l){ return l.id === lc.B.id; })) lc.B.id = topLineupId(lc.B.team);
  }
  function lcPicker(side){
    var s = state.lc[side];
    var lineups = teamData(s.team).lineups.slice().sort(function(a,b){ return b.min - a.min; });
    return '<div class="lc-side lc-'+side.toLowerCase()+'"><div class="lc-sidehead"><span class="lc-dot"></span>Lineup '+side+'</div>' +
      '<select class="lc-team" data-side="'+side+'" aria-label="Team for lineup '+side+'">'+teamOptions(s.team)+'</select>' +
      '<select class="lc-lineup" data-side="'+side+'" aria-label="Lineup '+side+'">' +
      lineups.map(function(l){ return '<option value="'+l.id+'"'+(l.id===s.id?' selected':'')+'>'+esc(lineupAbbrev(l))+' ('+l.min.toFixed(0)+' min)</option>'; }).join('') +
      '</select></div>';
  }
  function vsOppListHtml(l){
    var vsOpp = l.vs_opponents || [];
    var maxAbs = Math.max.apply(null, vsOpp.map(function(v){ return Math.abs(v.net_per40); }).concat([1]));
    return vsOpp.length ? vsOpp.map(function(v){
      var pos = v.net_per40 >= 0, pct = Math.round(Math.abs(v.net_per40)/maxAbs*100);
      return '<div class="vsopp-row">' +
        '<div class="oname" title="'+esc(v.opponent)+'">'+esc(v.opponent)+'</div>' +
        '<div class="otrack"><div class="ofill" style="'+(pos?'left:50%':'right:50%')+';width:'+(pct/2)+'%;background:'+(pos?'var(--good)':'var(--critical)')+'"></div></div>' +
        '<div class="oval" style="color:'+(pos?'var(--good)':'var(--critical)')+'">'+(pos?'+':'')+v.net_per40.toFixed(1)+'</div>' +
        '<div class="omin">'+v.min.toFixed(1)+' min</div></div>';
    }).join('') : '<div style="font-size:12px;color:var(--ink-faint)">No opponent faced this lineup for at least 3 minutes.</div>';
  }
  function lcRow(label, av, bv, o){
    o = o || {};
    var max = Math.max(Math.abs(av), Math.abs(bv)) * 1.15 || 1;
    var win = null;
    if (!o.neutral && Math.abs(av - bv) > 0.05) win = (o.higher ? av > bv : av < bv) ? 'a' : 'b';
    function val(v){
      var txt = o.signed ? netFmt(v) : (o.fmt ? o.fmt(v) : v.toFixed(1));
      return o.signed ? '<span style="color:'+netColor(v)+'">'+txt+'</span>' : txt;
    }
    return { win:win, html:'<div class="lc-row'+(win ? ' win-'+win : '')+'">' +
      '<div class="lc-val a">'+val(av)+'</div><div class="lc-track a"><i style="width:'+(Math.abs(av)/max*100).toFixed(1)+'%"></i></div>' +
      '<div class="lc-label">'+label+'</div>' +
      '<div class="lc-track b"><i style="width:'+(Math.abs(bv)/max*100).toFixed(1)+'%"></i></div><div class="lc-val b">'+val(bv)+'</div></div>' };
  }
  function lcHead(side, team, l){
    return '<div class="card lc-headcard lc-'+side.toLowerCase()+'"><div class="eyebrow"><span class="lc-dot"></span>Lineup '+side+' · '+esc(teamLabel(team))+'</div>' +
      '<div class="lc-players">'+l.players.map(function(n){ return '<span class="lc-chip">'+esc(n)+'</span>'; }).join('')+'</div>' +
      '<div class="muted">'+l.min.toFixed(1)+' minutes together'+(l.min<20?' <span class="pill tag small-sample">small sample</span>':'')+'</div>' +
      outlookHtml(l) + '</div>';
  }
  function setLineupMode(mode){
    state.lineupMode = mode;
    $('#view-lineups').classList.toggle('mode-compare', mode === 'compare');
    $$('#lcModeSeg button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
    if (mode === 'compare') renderLineupCompare();
  }
  function renderLineupCompare(){
    lcEnsure();
    var A = state.lc.A, B = state.lc.B;
    var la = teamData(A.team).lineups.filter(function(l){ return l.id === A.id; })[0];
    var lb = teamData(B.team).lineups.filter(function(l){ return l.id === B.id; })[0];
    if (!la || !lb){ $('#lcPanel').innerHTML = '<div class="card">Pick a lineup on each side to compare.</div>'; return; }

    var rows = [], wins = { a:0, b:0, even:0 };
    function add(r){ rows.push(r.html); if (r.win) wins[r.win]++; else if (!/neutral/.test(r.html)) wins.even++; }
    var headline = [
      lcRow('Minutes together', la.min, lb.min, { neutral:true, fmt:function(v){ return v.toFixed(1); } }),
      lcRow('Points for / 40', la.for_pts/la.min*40, lb.for_pts/lb.min*40, { higher:true }),
      lcRow('Points against / 40', la.against_pts/la.min*40, lb.against_pts/lb.min*40, { higher:false }),
      lcRow('Net / 40', la.net_per40, lb.net_per40, { higher:true, signed:true })
    ];
    headline.forEach(function(r){ rows.push(r.html); if (r.win) wins[r.win]++; });
    var strength = METRICS.map(function(m){
      return lcRow(m.label, m.get(la.per40), m.get(lb.per40), { higher:m.higher, fmt:function(v){ return v.toFixed(1)+(m.pct?'%':''); } });
    });
    strength.forEach(function(r){ if (r.win) wins[r.win]++; });
    var total = headline.length - 1 + strength.length;
    var evenN = total - wins.a - wins.b;

    var nameA = esc(teamData(A.team).name), nameB = esc(teamData(B.team).name);
    var sameTeam = A.team === B.team;
    var tagA = sameTeam ? 'Lineup A' : nameA, tagB = sameTeam ? 'Lineup B' : nameB;

    $('#lcPanel').innerHTML =
      '<div class="card lc-pick">' + lcPicker('A') + '<div class="lc-mid"><span class="lc-vs">vs</span><button class="btn" id="lcSwap" title="Swap A and B">⇆ Swap</button></div>' + lcPicker('B') + '</div>' +
      '<div class="lc-heads">' + lcHead('A', A.team, la) + lcHead('B', B.team, lb) + '</div>' +
      '<div class="card"><div class="card-title"><div class="card-title-copy"><h3>Head to head</h3>' +
        '<div class="hint">Bars are scaled within each row. The better side of each stat is highlighted. Everything is per 40 minutes so lineups with different minutes compare fairly.</div></div>' +
        '<div class="lc-score"><span class="a">'+tagA+' <b>'+wins.a+'</b></span><span class="e">even <b>'+evenN+'</b></span><span class="b">'+tagB+' <b>'+wins.b+'</b></span></div></div>' +
        ((la.min<20 || lb.min<20) ? '<div class="insight warn" style="margin-bottom:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><div><b>Small sample:</b> a lineup with under 20 minutes together can swing a lot on a few possessions. Treat the gaps below as a hint, not a verdict.</div></div>' : '') +
        '<div class="lc-grid">' + headline.map(function(r){ return r.html; }).join('') +
        '<div class="modal-section-title lc-sec">Strengths &amp; weaknesses (per 40 minutes)</div>' + strength.map(function(r){ return r.html; }).join('') + '</div></div>' +
      '<div class="grid-2">' +
        '<div class="card"><div class="card-title"><div class="card-title-copy"><h3>Lineup A vs. opponents faced</h3><div class="hint">Net points per 40 against each opponent (3+ minutes on court).</div></div></div><div class="vsopp-list">'+vsOppListHtml(la)+'</div></div>' +
        '<div class="card"><div class="card-title"><div class="card-title-copy"><h3>Lineup B vs. opponents faced</h3><div class="hint">Net points per 40 against each opponent (3+ minutes on court).</div></div></div><div class="vsopp-list">'+vsOppListHtml(lb)+'</div></div>' +
      '</div>';

    $$('#lcPanel .lc-team').forEach(function(sel){
      sel.addEventListener('change', function(){
        var side = sel.getAttribute('data-side');
        state.lc[side] = { team:sel.value, id:topLineupId(sel.value) };
        renderLineupCompare();
      });
    });
    $$('#lcPanel .lc-lineup').forEach(function(sel){
      sel.addEventListener('change', function(){ state.lc[sel.getAttribute('data-side')].id = sel.value; renderLineupCompare(); });
    });
    $('#lcSwap').addEventListener('click', function(){ var t = state.lc.A; state.lc.A = state.lc.B; state.lc.B = t; renderLineupCompare(); });
  }

  /* ================= DRAFT ADDITIONS ================= */
  var DRAFT_GAMES = {};
  var _fCache = {};
  function confKeys(){ return DATA.meta.conference_members.filter(function(k){ return DATA.teams[k]; }); }
  function isConf(k){ return confKeys().indexOf(k) !== -1; }
  function factors(key){
    if (_fCache[key]) return _fCache[key];
    var p = teamData(key).team_avg_per40;
    return (_fCache[key] = {
      off_efg:(p.fgm+0.5*p.tpm)/p.fga,           def_efg:(p.opp_fgm+0.5*p.opp_tpm)/p.opp_fga,
      off_tov:p.tov/(p.fga+0.44*p.fta+p.tov),    def_tov:p.opp_tov/(p.opp_fga+0.44*p.opp_fta+p.opp_tov),
      off_orb:p.oreb/(p.oreb+p.opp_dreb),        def_orb:p.opp_oreb/(p.opp_oreb+p.dreb),
      off_ftr:p.fta/p.fga,                       def_ftr:p.opp_fta/p.opp_fga,
      tpa_rate:p.tpa/p.fga, opp_tpa_rate:p.opp_tpa/p.opp_fga, ast_rate:p.ast/p.fgm,
      stl:p.stl, blk:p.blk, forced_tov:p.opp_tov, own_tov:p.tov
    });
  }
  var FF = [
    { id:'efg', name:'Shooting (eFG%)',        help:'Field goal % with 3s counted extra',   off:'off_efg', def:'def_efg', offGood:'high', defGood:'low'  },
    { id:'tov', name:'Turnovers (TOV%)',       help:'Share of possessions ending in a turnover', off:'off_tov', def:'def_tov', offGood:'low',  defGood:'high' },
    { id:'orb', name:'Offensive rebounding',   help:'Share of available offensive boards',  off:'off_orb', def:'def_orb', offGood:'high', defGood:'low'  },
    { id:'ftr', name:'Free-throw rate',        help:'Free throw attempts per shot attempt', off:'off_ftr', def:'def_ftr', offGood:'high', defGood:'low'  }
  ];
  function pct1(v){ return (v*100).toFixed(1)+'%'; }
  function ord(n){ var s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
  function rankOf(key, value, getter, good){
    var better = 0, n = 0;
    confKeys().forEach(function(k){
      if (k === key) return;
      n++;
      var o = getter(k);
      if (good === 'high' ? o > value : o < value) better++;
    });
    return { rank: better+1, n: n + (isConf(key) ? 1 : 0) };
  }
  function fRank(key, field, good){ return rankOf(key, factors(key)[field], function(k){ return factors(k)[field]; }, good); }
  function kRank(key, fn, good){ return rankOf(key, fn(teamData(key).kpis), function(k){ return fn(teamData(k).kpis); }, good); }
  function rankChip(r){
    var third = Math.ceil(r.n/3);
    var cls = r.rank <= third ? 'rk-good' : (r.rank > r.n-third ? 'rk-bad' : 'rk-mid');
    return '<span class="rk '+cls+'" title="Rank among the '+r.n+' Big West teams (1st is best)">'+ord(r.rank)+' of '+r.n+'</span>';
  }
  function styleChip(key, field){
    var r = rankOf(key, factors(key)[field], function(k){ return factors(k)[field]; }, 'high');
    return '<span class="rk rk-neutral" title="Rank among the Big West teams (1st = highest)">'+ord(r.rank)+' highest</span>';
  }
  function netFmt(v){ return (v>=0?'+':'')+v.toFixed(1); }
  function netColor(v){ return v>=0 ? 'var(--good)' : 'var(--critical)'; }

  /* ---- Four Factors (Overview) ---- */
  function renderFourFactors(){
    var key = state.team, f = factors(key);
    $('#ffBody').innerHTML = FF.map(function(x){
      return '<tr><td><b>'+x.name+'</b><div class="sub-help">'+x.help+'</div></td>' +
        '<td class="num">'+pct1(f[x.off])+'</td><td>'+rankChip(fRank(key,x.off,x.offGood))+'</td>' +
        '<td class="num">'+pct1(f[x.def])+'</td><td>'+rankChip(fRank(key,x.def,x.defGood))+'</td></tr>';
    }).join('');
  }

  /* ---- Progression + splits (Overview) ---- */
  function recordTotal(rec){ var m = /(\d+)-(\d+)/.exec(rec||''); return m ? (+m[1])+(+m[2]) : 0; }
  function splitRow(label, gs){
    if (!gs.length) return '<tr><td>'+label+'</td><td class="num muted" colspan="4">none</td></tr>';
    var w=0, pf=0, pa=0;
    gs.forEach(function(g){ if (g.pf>g.pa) w++; pf+=g.pf; pa+=g.pa; });
    var n = gs.length, net = (pf-pa)/n;
    return '<tr><td>'+label+' <span class="muted">('+n+')</span></td><td class="num">'+w+'-'+(n-w)+'</td><td class="num">'+(pf/n).toFixed(1)+'</td>' +
      '<td class="num">'+(pa/n).toFixed(1)+'</td><td class="num" style="color:'+netColor(net)+'">'+netFmt(net)+'</td></tr>';
  }
  function renderProgression(){
    var key = state.team, gs = DRAFT_GAMES[key] || [];
    var total = recordTotal(teamData(key).kpis.record);
    if (!gs.length){
      $('#progChart').innerHTML = '<div class="muted" style="padding:30px 0;text-align:center">No game list is available for this team yet.</div>';
      $('#progInsight').style.display = 'none'; $('#splitsBody').innerHTML = ''; $('#progNote').textContent = '';
      return;
    }
    $('#progInsight').style.display = '';
    var m = gs.map(function(g){ return g.pf-g.pa; });
    var roll = m.map(function(_,i){ var s = m.slice(Math.max(0,i-4), i+1); return s.reduce(function(a,b){ return a+b; },0)/s.length; });
    var W=720, H=250, pl=34, pr=8, pt=12, pb=24;
    var maxAbs = Math.ceil((Math.max.apply(null, m.map(Math.abs).concat(roll.map(Math.abs))) + 1) / 10) * 10;
    var n = gs.length, bw = (W-pl-pr)/n, y0 = pt + (H-pt-pb)/2, scale = (H-pt-pb)/2/maxAbs;
    var bars = gs.map(function(g,i){
      var v = m[i], h = Math.abs(v)*scale, x = pl + i*bw + bw*0.18;
      var y = v>=0 ? y0-h : y0;
      return '<rect class="gbar" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw*0.64).toFixed(1)+'" height="'+Math.max(h,1).toFixed(1)+'" rx="2" '+
        'fill="'+(v>=0?'var(--good)':'var(--critical)')+'" opacity=".78" data-i="'+i+'"></rect>';
    }).join('');
    var line = roll.map(function(v,i){ return (i?'L':'M')+(pl+i*bw+bw/2).toFixed(1)+','+(y0-v*scale).toFixed(1); }).join(' ');
    var grid = [-1,-0.5,0,0.5,1].map(function(t){
      var y = y0 - t*maxAbs*scale;
      return '<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="var(--chart-grid)" '+(t===0?'stroke-width="1.5"':'stroke-dasharray="2 4"')+'/>' +
             '<text x="'+(pl-6)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" font-size="9.5" fill="var(--chart-axis)" font-family="var(--font-mono)">'+Math.round(t*maxAbs)+'</text>';
    }).join('');
    var ticks = '';
    gs.forEach(function(g,i){
      var mo = g.date.slice(5,7), prev = i? gs[i-1].date.slice(5,7) : '';
      if (mo !== prev) ticks += '<text x="'+(pl+i*bw).toFixed(1)+'" y="'+(H-6)+'" font-size="9.5" fill="var(--chart-axis)">'+['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+mo]+'</text>';
    });
    $('#progChart').innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" class="progsvg" role="img" aria-label="Game-by-game margin">'+grid+bars+
      '<path d="'+line+'" fill="none" stroke="var(--series-a)" stroke-width="2.2" stroke-linejoin="round"/>'+
      '<circle cx="'+(pl+(n-1)*bw+bw/2).toFixed(1)+'" cy="'+(y0-roll[n-1]*scale).toFixed(1)+'" r="4" fill="var(--series-a)" stroke="white" stroke-width="2"/>'+ticks+'</svg>';
    $$('.gbar', $('#progChart')).forEach(function(b){
      b.addEventListener('mousemove', function(e){
        var g = gs[+b.getAttribute('data-i')];
        showTip(e.clientX, e.clientY, '<b>'+(g.pf>g.pa?'W':'L')+' '+g.pf+'–'+g.pa+'</b> '+(g.loc==='H'?'vs':g.loc==='A'?'at':'vs (neutral)')+' '+esc(g.opp)+' · '+g.date);
      });
      b.addEventListener('mouseleave', hideTip);
    });

    var seasonAvg = m.reduce(function(a,b){ return a+b; },0)/n;
    var last5 = m.slice(-5), l5 = last5.reduce(function(a,b){ return a+b; },0)/last5.length;
    var diff = l5-seasonAvg;
    $('#progInsight').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<div><b>Read:</b> last 5 games average a '+netFmt(l5)+' margin versus '+netFmt(seasonAvg)+' for the season, so the team is '+
      (Math.abs(diff)<1.5?'holding steady':(diff>0?'trending up':'trending down'))+' ('+netFmt(diff)+' vs. season).</div>';

    var pick = function(fn){ return gs.filter(fn); };
    $('#splitsBody').innerHTML =
      splitRow('Overall', gs) + splitRow('Home', pick(function(g){ return g.loc==='H'; })) +
      splitRow('Away', pick(function(g){ return g.loc==='A'; })) + splitRow('Neutral', pick(function(g){ return g.loc==='N'; })) +
      splitRow('Conference', pick(function(g){ return g.conf; })) + splitRow('Non-conference', pick(function(g){ return !g.conf; })) +
      splitRow('Last 5', gs.slice(-5)) + splitRow('Last 10', gs.slice(-10)) +
      splitRow('Decided by 5 or less', pick(function(g){ return Math.abs(g.pf-g.pa)<=5; }));
    $('#progNote').textContent = gs.length < total
      ? 'This team’s schedule is only partly in the scraped data ('+gs.length+' of '+total+' games), so these numbers cover those games only.' : '';
  }

  /* ---- Matchup / scouting view ---- */
  function teamOptions(selected){
    var g = teamGroups();
    function opt(k){ return '<option value="'+k+'"'+(k===selected?' selected':'')+'>'+teamLabel(k)+'</option>'; }
    return '<optgroup label="Big West 2026–27">'+g.conf.map(opt).join('')+'</optgroup>' +
      (g.opp.length ? '<optgroup label="Non-conference opponents">'+g.opp.map(opt).join('')+'</optgroup>' : '');
  }
  function headBlock(key, cls){
    var t = teamData(key), k = t.kpis, net = k.ppg-k.oppg;
    return '<div class="mm-team '+cls+'"><div class="mm-name">'+esc(teamLabel(key))+'</div>' +
      '<div class="mm-rec num">'+esc(k.record)+'</div>' +
      '<div class="mm-stats">' +
        '<div><span class="eyebrow">PPG</span><b class="num">'+k.ppg.toFixed(1)+'</b>'+rankChip(kRank(key,function(x){return x.ppg;},'high'))+'</div>' +
        '<div><span class="eyebrow">Opp PPG</span><b class="num">'+k.oppg.toFixed(1)+'</b>'+rankChip(kRank(key,function(x){return x.oppg;},'low'))+'</div>' +
        '<div><span class="eyebrow">Net</span><b class="num" style="color:'+netColor(net)+'">'+netFmt(net)+'</b>'+rankChip(kRank(key,function(x){return x.ppg-x.oppg;},'high'))+'</div>' +
      '</div></div>';
  }
  function renderMatchup(){
    var A = state.mmA, B = state.mmB;
    $('#mmA').innerHTML = teamOptions(A); $('#mmB').innerHTML = teamOptions(B);
    $('#mmA').value = A; $('#mmB').value = B;
    $('#mmHead').innerHTML = headBlock(A,'us') + '<div class="mm-vs">vs</div>' + headBlock(B,'them');
    var nameA = teamData(A).name, nameB = teamData(B).name;

    var rows = [], edges = [];
    function addRow(att, def, x){
      var ra = fRank(att, x.off, x.offGood), rd = fRank(def, x.def, x.defGood);
      var gap = rd.rank - ra.rank;             // positive: attack beats defense
      var edge = gap > 0 ? att : (gap < 0 ? def : null);
      var rec = { att:att, def:def, x:x, ra:ra, rd:rd, gap:Math.abs(gap), edge:edge };
      rows.push(rec); if (edge) edges.push(rec);
    }
    FF.forEach(function(x){ addRow(A,B,x); });
    FF.forEach(function(x){ addRow(B,A,x); });
    $('#mmEdges').innerHTML = rows.map(function(r){
      var ea = r.edge===A, eb = r.edge===B;
      var pill = r.edge ? '<span class="edge-pill '+(ea?'edge-us':'edge-them')+'">'+esc(teamData(r.edge).name)+' <b>+'+r.gap+'</b></span>' : '<span class="edge-pill">Even</span>';
      return '<tr><td><b>'+esc(teamData(r.att).name)+' offense</b> vs '+esc(teamData(r.def).name)+' defense<div class="sub-help">'+r.x.name+'</div></td>' +
        '<td class="num">'+pct1(factors(r.att)[r.x.off])+'</td><td>'+rankChip(r.ra)+'</td>' +
        '<td class="num">'+pct1(factors(r.def)[r.x.def])+'</td><td>'+rankChip(r.rd)+'</td><td>'+pill+'</td></tr>';
    }).join('');
    function best(side){
      var c = edges.filter(function(e){ return e.edge===side; }).sort(function(a,b){ return b.gap-a.gap; })[0];
      if (!c) return 'none';
      var what = c.att===side ? (teamData(side).name+' offense ('+ord(c.ra.rank)+') vs. '+teamData(c.def).name+' defense ('+ord(c.rd.rank)+')')
                              : (teamData(side).name+' defense ('+ord(c.rd.rank)+') vs. '+teamData(c.att).name+' offense ('+ord(c.ra.rank)+')');
      return '<b>'+c.x.name+'</b> — '+what;
    }
    $('#mmSummary').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<div><b>'+esc(nameA)+'’s biggest edge:</b> '+best(A)+'.<br><b>'+esc(nameB)+'’s biggest edge:</b> '+best(B)+'.</div>';

    /* who they run through */
    var tB = teamData(B);
    var ps = tB.roster_players.slice().sort(function(a,b){
      var ua = a.adv && a.adv.usg!=null ? a.adv.usg : -1, ub = b.adv && b.adv.usg!=null ? b.adv.usg : -1;
      return (ub-ua) || (b.ppg-a.ppg);
    }).slice(0,4);
    $('#mmKeyTitle').textContent = 'Who ' + tB.name + ' runs through';
    $('#mmKeyBody').innerHTML = ps.map(function(p){
      var a = p.adv || {};
      return '<tr><td><b>'+esc(p.name)+'</b> <span class="muted">#'+esc(p.jersey)+(a.pos?' · '+esc(a.pos):'')+'</span></td>' +
        '<td class="num">'+p.ppg.toFixed(1)+'</td><td class="num">'+(a.usg!=null?(a.usg*100).toFixed(1):'—')+'</td>' +
        '<td class="num">'+(a.ts!=null?(a.ts*100).toFixed(1):'—')+'</td>' +
        '<td class="num">'+(a.bpm!=null?(a.bpm>=0?'+':'')+a.bpm.toFixed(1):'—')+'</td></tr>';
    }).join('');
    var top2 = ps.slice().sort(function(a,b){ return b.ppg-a.ppg; }).slice(0,2).reduce(function(s,p){ return s+p.ppg; },0);
    $('#mmKeyNote').textContent = 'Their top two scorers account for ' + Math.round(top2/tB.kpis.ppg*100) + '% of the team’s points per game.';

    /* best / worst lineups */
    var bw = bestWorstLineups(B);
    function lu(l, tone, title){
      if (!l) return '<div class="muted">Not enough lineup minutes.</div>';
      return '<div class="lu-callout '+tone+'"><div class="eyebrow">'+title+'</div><div class="lu-players">'+esc(l.players.join(' · '))+'</div>' +
        '<div class="num lu-net" style="color:'+netColor(l.net_per40)+'">'+netFmt(l.net_per40)+' <small>net / 40 min</small></div>' +
        '<div class="muted">'+l.min.toFixed(0)+' minutes together</div></div>';
    }
    $('#mmLineups').innerHTML = lu(bw.best,'good','Best unit') + lu(bw.worst,'bad','Weakest unit');

    /* style */
    var STYLE = [
      { n:'3-point attempt rate', f:'tpa_rate', fmt:pct1, h:'Share of shots that are threes' },
      { n:'Free-throw rate', f:'off_ftr', fmt:pct1, h:'Gets to the line' },
      { n:'Assists per made shot', f:'ast_rate', fmt:pct1, h:'Ball movement' },
      { n:'Turnovers forced / 40', f:'forced_tov', fmt:function(v){ return v.toFixed(1); }, h:'Pressure defense' },
      { n:'Steals / 40', f:'stl', fmt:function(v){ return v.toFixed(1); }, h:'' },
      { n:'Blocks / 40', f:'blk', fmt:function(v){ return v.toFixed(1); }, h:'' }
    ];
    var fb = factors(B);
    $('#mmStyle').innerHTML = '<table class="style"><tbody>' + STYLE.map(function(s){
      return '<tr><td>'+s.n+(s.h?'<div class="sub-help">'+s.h+'</div>':'')+'</td><td class="num"><b>'+s.fmt(fb[s.f])+'</b></td><td>'+styleChip(B,s.f)+'</td></tr>';
    }).join('') + '</tbody></table>';

    /* quarters */
    var q = tB.team_quarters.season, mg = q.us.map(function(v,i){ return v-q.opp[i]; });
    var mx = Math.max.apply(null, mg.map(Math.abs)) || 1;
    var bestQ = mg.indexOf(Math.max.apply(null,mg)), worstQ = mg.indexOf(Math.min.apply(null,mg));
    $('#mmQuarters').innerHTML = mg.map(function(v,i){
      var w = Math.round(Math.abs(v)/mx*50);
      return '<div class="qrow"><span class="qn">Q'+(i+1)+'</span><div class="qtrack"><i style="'+(v>=0?'left:50%':'right:50%')+';width:'+w+'%;background:'+(v>=0?'var(--good)':'var(--critical)')+'"></i></div>' +
        '<span class="num" style="color:'+netColor(v)+'">'+netFmt(v)+'</span></div>';
    }).join('') + '<div class="insight" style="margin-top:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><div><b>Read:</b> '+
      esc(tB.name)+' is strongest in Q'+(bestQ+1)+' ('+netFmt(mg[bestQ])+') and weakest in Q'+(worstQ+1)+' ('+netFmt(mg[worstQ])+').</div></div>';
  }

  /* ---------------- Wiring ---------------- */
  function wireNav(){
    $$('.nav-btn').forEach(function(btn){
      btn.addEventListener('click', function(){ setView(btn.getAttribute('data-view')); });
    });
    var app = $('.app'), tog = $('#sidebar-toggle');
    tog.addEventListener('click', function(){
      var c = app.classList.toggle('collapsed');
      var label = c ? 'Expand sidebar' : 'Collapse sidebar';
      tog.setAttribute('title', label); tog.setAttribute('aria-label', label);
    });
  }

  function wireControls(){
    $('#seasonSel').addEventListener('change', function(){
      state.season = this.value;
      applySeason();
    });
    $$('#plSeg button').forEach(function(btn){
      btn.addEventListener('click', function(){
        state.plView = btn.getAttribute('data-pl');
        state.plSort = { key:PL_VIEWS[state.plView].sort.key, dir:PL_VIEWS[state.plView].sort.dir };
        renderPlayers();
      });
    });
    $$('#lcModeSeg button').forEach(function(btn){
      btn.addEventListener('click', function(){ setLineupMode(btn.getAttribute('data-mode')); });
    });
    $('#mmA').addEventListener('change', function(){ state.mmA = this.value; renderMatchup(); });
    $('#mmB').addEventListener('change', function(){ state.mmB = this.value; renderMatchup(); });
    $('#mmSwap').addEventListener('click', function(){ var t = state.mmA; state.mmA = state.mmB; state.mmB = t; renderMatchup(); });
    $('#mmPrint').addEventListener('click', function(){ window.print(); });
    $('#teamSel').addEventListener('change', function(){
      state.team = this.value;
      state.lc.A = { team:state.team, id:null };
      state.gameSample = 'season';
      populateGameSelector();
      renderAll();
    });
    $('#gameSel').addEventListener('change', function(){ state.gameSample = this.value; renderQuarterChart(); });
    $('#minSel').addEventListener('change', function(){ state.minLineupMinutes = +this.value; renderLineupTables(); });
    $('#lineupSearch').addEventListener('input', renderLineupTables);

    $$('#metricSeg button').forEach(function(btn){
      btn.addEventListener('click', function(){
        $$('#metricSeg button').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        state.metric = btn.getAttribute('data-metric');
        renderRankChart();
      });
    });
  }
})();
