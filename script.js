(function(){
  "use strict";
  var $ = function(s,el){ return (el||document).querySelector(s); };
  var $$ = function(s,el){ return Array.prototype.slice.call((el||document).querySelectorAll(s)); };
  var tip = $('#tooltip');
  function showTip(x,y,html){ tip.innerHTML = html; tip.style.left = x+'px'; tip.style.top = (y-8)+'px'; tip.classList.add('show'); }
  function hideTip(){ tip.classList.remove('show'); }

  var DATA = null;
  var state = {
    team: 'ucsd',
    compareTeam: '',
    gameSample: 'season',
    minLineupMinutes: 15,
    selectedPlayer: null,
    lineupSort: { key:'min', dir:-1 },
    metric: 'ppg'
  };

  fetch('data/dashboard_data.json')
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
    populateCompareSelector();
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
    renderRankChart();
    renderConfTable();
  }

  function updateBrand(){
    var t = teamData(state.team);
    $('#brandMark').textContent = (t.name||'T').charAt(0);
    $('#topbarSub').textContent = teamLabel(state.team) + ' · Big West Conference · Women\'s Basketball';
  }

  /* ---------------- Selectors ---------------- */
  function populateTeamSelector(){
    var sel = $('#teamSel');
    sel.innerHTML = Object.keys(DATA.teams).map(function(k){
      return '<option value="'+k+'"'+(k===state.team?' selected':'')+'>'+teamLabel(k)+'</option>';
    }).join('');
  }
  function populateCompareSelector(){
    var sel = $('#compareSel');
    var opts = ['<option value="">Compare vs…</option>'];
    Object.keys(DATA.teams).forEach(function(k){
      if (k===state.team) return;
      opts.push('<option value="'+k+'"'+(k===state.compareTeam?' selected':'')+'>'+teamLabel(k)+'</option>');
    });
    sel.innerHTML = opts.join('');
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
      { lbl:'PPG', val:k.ppg.toFixed(1), delta:(net>=0?'+':'')+net.toFixed(1)+' net', tone:(net>=0?'up':'down') },
      { lbl:'Opp PPG', val:k.oppg.toFixed(1), delta:'season avg allowed', tone:'flat' },
      { lbl:'Net Rating', val:(net>=0?'+':'')+net.toFixed(1), delta:'points per game', tone:(net>=0?'up':'down') },
      { lbl:'Best Lineup', val:(bw.best?((bw.best.net_per40>=0?'+':'')+bw.best.net_per40.toFixed(1)):'—'), delta:'net pts / 40 min', tone:'up' },
      { lbl:'Lineups Tracked', val:t.lineups.length, delta:t.lineup_total_minutes_considered.toFixed(0)+' min reconstructed', tone:'flat' }
    ];
    $('#kpiStrip').innerHTML = tiles.map(function(tl){
      var arrow = tl.tone==='up' ? '▲' : (tl.tone==='down' ? '▼' : '·');
      return '<div class="tile"><div class="eyebrow">'+tl.lbl+'</div><div class="val">'+tl.val+'</div>'+
        '<div class="delta '+tl.tone+'">'+arrow+' '+tl.delta+'</div></div>';
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
      var usH = Math.round(s.us[g]/max*140);
      var oppH = Math.round(s.opp[g]/max*140);
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
      '<div class="legend-item"><span class="swatch" style="background:var(--series-b)"></span>Opponent</div>' +
      '<div class="legend-item" style="color:var(--ink-faint);font-weight:500">'+s.label+'</div>';

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
  function renderPlayers(){
    var roster = teamData(state.team).roster_players;
    state.selectedPlayer = null;
    var maxQ = Math.max.apply(null, roster.reduce(function(a,p){ return a.concat(p.q); },[1]));
    $('#playersGrid').innerHTML = roster.map(function(p,i){
      var bars = p.q.map(function(v,qi){
        var h = Math.round(v/maxQ*56);
        var lbl = ['Q1','Q2','Q3','Q4'][qi];
        return '<div class="mbar" style="height:'+Math.max(h,2)+'px" data-v="'+v.toFixed(2)+'" data-q="'+lbl+'" data-p="'+p.name+'"></div>';
      }).join('');
      return '<button class="pcard" data-idx="'+i+'">' +
        '<div class="pcard-head"><span class="pname">'+p.name+'</span><span class="jersey">#'+p.jersey+'</span></div>' +
        '<div class="pmini">'+bars+'</div>' +
        '<div class="pfoot"><span>Season PPG</span><b>'+p.ppg.toFixed(1)+'</b></div>' +
      '</button>';
    }).join('');

    $$('.mbar').forEach(function(b){
      b.addEventListener('mousemove', function(e){
        showTip(e.clientX, e.clientY, '<b>'+b.getAttribute('data-p')+'</b> · '+b.getAttribute('data-q')+': '+b.getAttribute('data-v')+' pts/gm');
      });
      b.addEventListener('mouseleave', hideTip);
    });

    $$('.pcard').forEach(function(card){
      card.addEventListener('click', function(){
        var idx = +card.getAttribute('data-idx');
        state.selectedPlayer = (state.selectedPlayer===idx) ? null : idx;
        $$('.pcard').forEach(function(c,i){ c.classList.toggle('selected', i===state.selectedPlayer); });
        renderPlayerInsight();
      });
    });
    renderPlayerInsight();
  }

  function renderPlayerInsight(){
    var box = $('#playerInsight');
    var roster = teamData(state.team).roster_players;
    var teamQ = teamData(state.team).team_quarters.season.us;
    var teamTotal = teamQ.reduce(function(a,b){return a+b;},0);
    if (state.selectedPlayer===null){
      var top = roster.slice().sort(function(a,b){ return b.q[2]-a.q[2]; })[0];
      box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
        '<div><b>Read:</b> '+top.name+' carries the largest 3rd-quarter scoring share ('+top.q[2].toFixed(2)+' pts/gm). Click a player card to compare their shape to the team\'s quarter-by-quarter profile.</div>';
      return;
    }
    var p = roster[state.selectedPlayer];
    var pTotal = p.q.reduce(function(a,b){return a+b;},0) || 1;
    var diffs = p.q.map(function(v,i){ return (v/pTotal) - (teamQ[i]/teamTotal); });
    var maxI = diffs.indexOf(Math.max.apply(null,diffs));
    var labels=['1st','2nd','3rd','4th'];
    box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<div><b>Read:</b> '+p.name+' scores a disproportionate share of their points in the '+labels[maxI]+' quarter relative to the team\'s overall shape — a candidate to feature early in that stretch of the game plan.</div>';
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
      var av=a[sort.key], bv=b[sort.key];
      if (sort.key==='players'){ av=a.players.join(' '); bv=b.players.join(' '); return av.localeCompare(bv)*sort.dir; }
      return (av-bv)*sort.dir;
    });
    return rows;
  }

  function lineupTableHtml(teamKey, idPrefix){
    var rows = sortLineups(filteredLineups(teamKey));
    var allMax = Math.max.apply(null, teamData(teamKey).lineups.map(function(l){ return Math.abs(l.net_per40); })) || 1;
    var body = rows.map(function(l){
      var pct = Math.round(Math.abs(l.net_per40)/allMax*100);
      var pos = l.net_per40>=0;
      return '<tr class="lineup-row" data-team="'+teamKey+'" data-id="'+l.id+'">' +
        '<td><div class="lineup-players">'+l.players.join(' · ')+'</div></td>' +
        '<td class="num">'+l.min.toFixed(1)+'</td>' +
        '<td class="num">'+l.for_pts+'</td>' +
        '<td class="num">'+l.against_pts+'</td>' +
        '<td class="num" style="color:'+(l.net>=0?'var(--good)':'var(--critical)')+'">'+(l.net>=0?'+':'')+l.net+'</td>' +
        '<td class="num"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">' +
          '<div class="netbar"><i style="'+(pos?'left:50%':'right:50%')+';width:'+(pct/2)+'%;background:'+(pos?'var(--good)':'var(--critical)')+'"></i></div>' +
          '<span class="num" style="color:'+(pos?'var(--good)':'var(--critical)')+'">'+(pos?'+':'')+l.net_per40.toFixed(1)+'</span>' +
        '</div></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);padding:22px">No lineups match this filter.</td></tr>';

    return '<div class="lineup-table-col">' +
      '<div class="col-head">'+teamLabel(teamKey)+' <span class="pill">'+rows.length+' lineups</span></div>' +
      '<div class="table-wrap"><table id="'+idPrefix+'"><thead><tr>' +
        '<th><button class="th-sort" data-key="players">Lineup</button></th>' +
        '<th class="num"><button class="th-sort" data-key="min">Min</button></th>' +
        '<th class="num"><button class="th-sort" data-key="for_pts">For</button></th>' +
        '<th class="num"><button class="th-sort" data-key="against_pts">Against</button></th>' +
        '<th class="num"><button class="th-sort" data-key="net">Net</button></th>' +
        '<th class="num"><button class="th-sort" data-key="net_per40">Net/40</button></th>' +
      '</tr></thead><tbody>'+body+'</tbody></table></div>' +
    '</div>';
  }

  function renderLineupTables(){
    var container = $('#lineupTables');
    var compare = !!state.compareTeam;
    container.className = 'lineup-tables' + (compare ? ' compare' : '');
    $('#lineupCardTitle').textContent = compare
      ? 'Lineup usage — ' + teamLabel(state.team) + ' vs ' + teamLabel(state.compareTeam)
      : 'Five-player lineup usage';

    var html = lineupTableHtml(state.team, 'lineupTableA');
    if (compare) html += lineupTableHtml(state.compareTeam, 'lineupTableB');
    container.innerHTML = html;

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

    var totalMin = teamData(state.team).lineup_total_minutes_considered;
    $('#lineupNote').textContent = 'Reconstructed from ' + totalMin.toFixed(0) + ' total on-court minutes across the season' + (compare ? ' per team' : '') + '. Click a lineup for its full breakdown.';
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

    var vsOpp = l.vs_opponents || [];
    var maxAbs = Math.max.apply(null, vsOpp.map(function(v){ return Math.abs(v.net_per40); }).concat([1]));
    var vsOppHtml = vsOpp.length ? vsOpp.map(function(v){
      var pos = v.net_per40>=0;
      var pct = Math.round(Math.abs(v.net_per40)/maxAbs*100);
      return '<div class="vsopp-row">' +
        '<div class="oname" title="'+v.opponent+'">'+v.opponent+'</div>' +
        '<div class="otrack"><div class="ofill" style="'+(pos?'left:50%':'right:50%')+';width:'+(pct/2)+'%;background:'+(pos?'var(--good)':'var(--critical)')+'"></div></div>' +
        '<div class="oval" style="color:'+(pos?'var(--good)':'var(--critical)')+'">'+(pos?'+':'')+v.net_per40.toFixed(1)+'</div>' +
        '<div class="omin">'+v.min.toFixed(1)+' min</div>' +
      '</div>';
    }).join('') : '<div style="font-size:12px;color:var(--ink-faint)">No opponent faced this lineup for at least 3 minutes.</div>';

    $('#modalContent').innerHTML =
      '<div class="modal-head">' +
        '<div class="eyebrow">'+teamLabel(teamKey)+'</div>' +
        '<h3>'+l.players.join(' · ')+'</h3>' +
        '<div class="sub">'+l.min.toFixed(1)+' minutes on court together this season</div>' +
      '</div>' +
      '<div class="modal-kpis">' +
        '<div class="tile"><div class="eyebrow">Minutes</div><div class="val">'+l.min.toFixed(1)+'</div></div>' +
        '<div class="tile"><div class="eyebrow">Pts For</div><div class="val">'+l.for_pts+'</div></div>' +
        '<div class="tile"><div class="eyebrow">Pts Against</div><div class="val">'+l.against_pts+'</div></div>' +
        '<div class="tile"><div class="eyebrow">Net / 40</div><div class="val" style="color:'+(l.net_per40>=0?'var(--good)':'var(--critical)')+'">'+(l.net_per40>=0?'+':'')+l.net_per40.toFixed(1)+'</div></div>' +
      '</div>' +
      '<div class="modal-section-title">Strengths &amp; weaknesses — vs. '+team.name+'\'s overall per-40 rate</div>' +
      '<div class="metric-grid">'+metricRows+'</div>' +
      '<div class="modal-section-title">Performance vs. opponents faced (min. 3 minutes on court)</div>' +
      '<div class="vsopp-list">'+vsOppHtml+'</div>';

    $('#modalBackdrop').classList.add('open');
  }

  function wireModal(){
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', function(e){ if (e.target===$('#modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', function(e){ if (e.key==='Escape') closeModal(); });
  }
  function closeModal(){ $('#modalBackdrop').classList.remove('open'); }

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
        '<div class="rname">'+t.name+'</div>' +
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
        '<td>'+t.name+'</td>' +
        '<td>'+t.ppg.toFixed(1)+'</td>' +
        '<td>'+t.oppg.toFixed(1)+'</td>' +
        '<td style="color:'+(t.net>=0?'var(--good)':'var(--critical)')+'">'+(t.net>=0?'+':'')+t.net.toFixed(1)+'</td>' +
        '<td>'+t.pace.toFixed(1)+'</td>' +
      '</tr>';
    }).join('');
  }

  /* ---------------- Wiring ---------------- */
  function wireNav(){
    $$('.nav-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        $$('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        var v = btn.getAttribute('data-view');
        $$('.view').forEach(function(sec){ sec.classList.toggle('active', sec.id==='view-'+v); });
      });
    });
  }

  function wireControls(){
    $('#teamSel').addEventListener('change', function(){
      state.team = this.value;
      if (state.compareTeam===state.team) state.compareTeam = '';
      state.gameSample = 'season';
      populateGameSelector();
      populateCompareSelector();
      renderAll();
    });
    $('#compareSel').addEventListener('change', function(){
      state.compareTeam = this.value;
      renderLineupTables();
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
