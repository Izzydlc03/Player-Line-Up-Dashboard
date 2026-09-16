(function(){
  "use strict";
  var $ = function(s,el){ return (el||document).querySelector(s); };
  var $$ = function(s,el){ return Array.prototype.slice.call((el||document).querySelectorAll(s)); };
  var tip = $('#tooltip');
  function showTip(x,y,html){ tip.innerHTML = html; tip.style.left = x+'px'; tip.style.top = (y-8)+'px'; tip.classList.add('show'); }
  function hideTip(){ tip.classList.remove('show'); }
  function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  var DATA = null;
  var teamQKey = 'season';
  var selectedPlayer = null;
  var lineupSort = { key:'net_per40', dir:-1 };
  var currentMetric = 'ppg';

  fetch('data/dashboard_data.json')
    .then(function(r){ return r.json(); })
    .then(function(d){ DATA = d; init(); })
    .catch(function(err){
      $('#view-overview').innerHTML = '<div class="card"><b>Could not load dashboard_data.json.</b><br>'+err+'</div>';
    });

  function init(){
    renderKpis();
    populateGameSelector();
    renderQuarterChart(teamQKey);
    renderPlayers();
    renderLineupTable();
    renderCompare();
    renderRankChart();
    renderConfTable();
    wireNav();
    wireControls();
  }

  /* ---------------- Overview: KPIs ---------------- */
  function renderKpis(){
    var k = DATA.kpis;
    var best = bestWorstLineups().best;
    var tracked = DATA.lineup_total_minutes_considered;
    var tiles = [
      { lbl:'Record', val:k.record, delta:'2025–26 season', tone:'flat' },
      { lbl:'PPG', val:k.ppg.toFixed(1), delta:(k.ppg-k.oppg>=0?'+':'')+(k.ppg-k.oppg).toFixed(1)+' net', tone:(k.ppg-k.oppg>=0?'up':'down') },
      { lbl:'Opp PPG', val:k.oppg.toFixed(1), delta:'season avg allowed', tone:'flat' },
      { lbl:'Net Rating', val:(k.ppg-k.oppg>=0?'+':'')+(k.ppg-k.oppg).toFixed(1), delta:'points per game', tone:(k.ppg-k.oppg>=0?'up':'down') },
      { lbl:'Best Lineup', val:(best?( (best.net_per40>=0?'+':'')+best.net_per40.toFixed(1) ):'—'), delta:'net pts / 40 min', tone:'up' },
      { lbl:'Lineup Min. Tracked', val:tracked.toFixed(0), delta:'reconstructed from subs', tone:'flat' }
    ];
    $('#kpiStrip').innerHTML = tiles.map(function(t){
      var arrow = t.tone==='up' ? '▲' : (t.tone==='down' ? '▼' : '·');
      return '<div class="tile"><div class="eyebrow">'+t.lbl+'</div><div class="val">'+t.val+'</div>'+
        '<div class="delta '+t.tone+'">'+arrow+' '+t.delta+'</div></div>';
    }).join('');
  }

  /* ---------------- Overview: quarter chart ---------------- */
  function populateGameSelector(){
    var sel = $('#gameSel');
    var keys = Object.keys(DATA.team_quarters);
    sel.innerHTML = keys.map(function(k){
      return '<option value="'+k+'">'+DATA.team_quarters[k].label+'</option>';
    }).join('');
  }

  function renderQuarterChart(key){
    var s = DATA.team_quarters[key];
    var labels = ['Q1','Q2','Q3','Q4'];
    var all = s.us.concat(s.opp);
    var max = Math.max.apply(null, all) * 1.25;
    var html = '';
    for (var g=0; g<4; g++){
      var usH = Math.round(s.us[g]/max*140);
      var oppH = Math.round(s.opp[g]/max*140);
      html += '<div class="qgroup">' +
        '<div class="qbars">' +
          '<div class="bar" data-v="'+s.us[g].toFixed(1)+'" data-t="UCSD" style="height:'+usH+'px;background:var(--series-a)"><span class="barlabel">'+s.us[g].toFixed(1)+'</span></div>' +
          '<div class="bar" data-v="'+s.opp[g].toFixed(1)+'" data-t="Opponent" style="height:'+oppH+'px;background:var(--series-b)"><span class="barlabel">'+s.opp[g].toFixed(1)+'</span></div>' +
        '</div>' +
        '<div class="qlabel">'+labels[g]+'</div>' +
      '</div>';
    }
    $('#qChart').innerHTML = html;
    $('#qLegend').innerHTML =
      '<div class="legend-item"><span class="swatch" style="background:var(--series-a)"></span>UCSD</div>' +
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
      labels[worstQ]+' is the softest quarter relative to the opponent ('+(margin[worstQ]>=0?'+':'')+margin[worstQ].toFixed(1)+'). Worth a rotation look at who\'s on the floor in that stretch. — '+s.label+'</div>';
  }

  /* ---------------- Players ---------------- */
  function renderPlayers(){
    var roster = DATA.roster_players;
    var maxQ = Math.max.apply(null, roster.reduce(function(a,p){ return a.concat(p.q); },[]));
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
        selectedPlayer = (selectedPlayer===idx) ? null : idx;
        $$('.pcard').forEach(function(c,i){ c.classList.toggle('selected', i===selectedPlayer); });
        renderPlayerInsight();
      });
    });
    renderPlayerInsight();
  }

  function renderPlayerInsight(){
    var box = $('#playerInsight');
    var roster = DATA.roster_players;
    var teamQ = DATA.team_quarters.season.us;
    var teamTotal = teamQ.reduce(function(a,b){return a+b;},0);
    if (selectedPlayer===null){
      var top = roster.slice().sort(function(a,b){ return b.q[2]-a.q[2]; })[0];
      box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
        '<div><b>Read:</b> '+top.name+' carries the largest 3rd-quarter scoring share ('+top.q[2].toFixed(2)+' pts/gm). Click a player card to compare their shape to the team\'s quarter-by-quarter profile.</div>';
      return;
    }
    var p = roster[selectedPlayer];
    var pTotal = p.q.reduce(function(a,b){return a+b;},0) || 1;
    var diffs = p.q.map(function(v,i){ return (v/pTotal) - (teamQ[i]/teamTotal); });
    var maxI = diffs.indexOf(Math.max.apply(null,diffs));
    var labels=['1st','2nd','3rd','4th'];
    box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      '<div><b>Read:</b> '+p.name+' scores a disproportionate share of their points in the '+labels[maxI]+' quarter relative to the team\'s overall shape — a candidate to feature early in that stretch of the game plan.</div>';
  }

  /* ---------------- Lineups ---------------- */
  function currentLineups(){
    var minFilter = +$('#minSel').value;
    var q = $('#lineupSearch').value.trim().toLowerCase();
    return DATA.lineups.filter(function(l){
      if (l.min < minFilter) return false;
      if (q && l.players.join(' ').toLowerCase().indexOf(q)===-1) return false;
      return true;
    });
  }

  function renderLineupTable(){
    var rows = currentLineups();
    rows.sort(function(a,b){
      var av = a[lineupSort.key], bv = b[lineupSort.key];
      if (lineupSort.key==='players'){ av = a.players.join(' '); bv = b.players.join(' '); return av.localeCompare(bv)*lineupSort.dir; }
      return (av-bv)*lineupSort.dir;
    });
    var maxAbsNet = Math.max.apply(null, DATA.lineups.map(function(l){ return Math.abs(l.net_per40); })) || 1;

    $('#lineupBody').innerHTML = rows.map(function(l){
      var pct = Math.round(Math.abs(l.net_per40)/maxAbsNet*100);
      var pos = l.net_per40>=0;
      return '<tr>' +
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

    $('#lineupNote').textContent = rows.length + ' lineups shown, reconstructed from ' + DATA.lineup_total_minutes_considered.toFixed(0) + ' total on-court minutes across the season.';
  }

  function bestWorstLineups(){
    var eligible = DATA.lineups.filter(function(l){ return l.min>=20; });
    if (!eligible.length) return { best:null, worst:null };
    var sorted = eligible.slice().sort(function(a,b){ return b.net_per40-a.net_per40; });
    return { best: sorted[0], worst: sorted[sorted.length-1] };
  }

  function renderCompare(){
    var bw = bestWorstLineups();
    if (!bw.best){ return; }
    function fill(prefix, l, color){
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

  /* ---------------- Conference ---------------- */
  var metricMeta = {
    ppg:{ fmt:function(v){return v.toFixed(1);} },
    oppg:{ fmt:function(v){return v.toFixed(1);} },
    net:{ fmt:function(v){return (v>=0?'+':'')+v.toFixed(1);} },
    pace:{ fmt:function(v){return v.toFixed(1);} }
  };
  function renderRankChart(){
    var m = currentMetric;
    var sorted = DATA.conference.slice().sort(function(a,b){ return b[m]-a[m]; });
    var vals = DATA.conference.map(function(t){ return t[m]; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var base = Math.min(0, min);
    $('#rankChart').innerHTML = sorted.map(function(t){
      var pct = Math.max(4, Math.round((t[m]-base)/(max-base)*100));
      return '<div class="rankbar-row'+(t.self?' self':'')+'">' +
        '<div class="rname">'+t.name+'</div>' +
        '<div class="rankbar-track"><div class="rankbar-fill" style="width:'+pct+'%"></div></div>' +
        '<div class="rankbar-val">'+metricMeta[m].fmt(t[m])+'</div>' +
      '</div>';
    }).join('');
  }

  function renderConfTable(){
    var sorted = DATA.conference.slice().sort(function(a,b){ return b.net-a.net; });
    $('#confBody').innerHTML = sorted.map(function(t){
      return '<tr class="'+(t.self?'self':'')+'">' +
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
    $('#gameSel').addEventListener('change', function(){ renderQuarterChart(this.value); });
    $('#minSel').addEventListener('change', renderLineupTable);
    $('#lineupSearch').addEventListener('input', renderLineupTable);

    $$('#lineupTable thead th .th-sort').forEach(function(btn){
      btn.addEventListener('click', function(){
        var key = btn.getAttribute('data-key');
        if (lineupSort.key===key){ lineupSort.dir *= -1; } else { lineupSort.key=key; lineupSort.dir=-1; }
        renderLineupTable();
      });
    });

    $$('#metricSeg button').forEach(function(btn){
      btn.addEventListener('click', function(){
        $$('#metricSeg button').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        currentMetric = btn.getAttribute('data-metric');
        renderRankChart();
      });
    });
  }
})();
