/** Embedded single-page dashboard — no build step, no dependencies. */
export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Footprint Dashboard</title>
  <style>
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
      --green: #3fb950; --yellow: #d29922; --red: #f85149;
      --radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }

    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; }
    header h1 { font-size: 1.5rem; font-weight: 600; }
    header h1 span { color: var(--accent); }
    .btn { background: var(--accent); color: #000; border: none; padding: 0.5rem 1.2rem; border-radius: var(--radius); cursor: pointer; font-weight: 600; font-size: 0.85rem; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem; }
    .stat-card .label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-card .value { font-size: 1.8rem; font-weight: 700; margin-top: 0.3rem; }
    .stat-card .value.green { color: var(--green); }
    .stat-card .value.yellow { color: var(--yellow); }
    .stat-card .value.red { color: var(--red); }
    .stat-card .value.accent { color: var(--accent); }

    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 2rem; overflow: hidden; }
    .panel-header { padding: 1rem 1.2rem; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 0.9rem; display: flex; justify-content: space-between; align-items: center; }
    .panel-body { padding: 1.2rem; }

    .chart-container { height: 220px; position: relative; }
    .chart-container canvas { width: 100% !important; height: 100% !important; }
    .chart-bar-group { display: flex; align-items: flex-end; gap: 2px; height: 180px; padding: 0 4px; }
    .chart-bar { flex: 1; min-width: 8px; max-width: 40px; border-radius: 3px 3px 0 0; position: relative; transition: height 0.3s ease; cursor: pointer; }
    .chart-bar:hover { opacity: 0.8; }
    .chart-bar .tooltip { display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #000; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; white-space: nowrap; z-index: 10; }
    .chart-bar:hover .tooltip { display: block; }
    .chart-labels { display: flex; gap: 2px; padding: 0.3rem 4px 0; }
    .chart-labels span { flex: 1; min-width: 8px; max-width: 40px; text-align: center; font-size: 0.55rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }

    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); font-size: 0.82rem; }
    th { color: var(--muted); font-weight: 500; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; }
    .badge { display: inline-block; padding: 0.15em 0.5em; border-radius: 99px; font-size: 0.7rem; font-weight: 600; }
    .badge.high { background: rgba(248,81,73,0.15); color: var(--red); }
    .badge.medium { background: rgba(210,153,34,0.15); color: var(--yellow); }
    .badge.low { background: rgba(63,185,80,0.15); color: var(--green); }
    .badge.exact { background: rgba(248,81,73,0.15); color: var(--red); }
    .badge.fuzzy { background: rgba(88,166,255,0.15); color: var(--accent); }
    .badge.pattern { background: rgba(210,153,34,0.15); color: var(--yellow); }

    .empty { color: var(--muted); font-style: italic; padding: 2rem; text-align: center; }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--muted); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; margin-right: 0.4rem; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .repo-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; }
    .repo-card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; }
    .repo-card h3 { font-size: 0.9rem; margin-bottom: 0.5rem; }
    .repo-card .meta { font-size: 0.75rem; color: var(--muted); }

    footer { text-align: center; color: var(--muted); font-size: 0.75rem; padding: 2rem 0 1rem; }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>🤖 <span>AI Footprint</span> Dashboard</h1>
    <div>
      <button class="btn" id="scanBtn" onclick="triggerScan()">Run Scan</button>
    </div>
  </header>

  <div class="stats" id="stats">
    <div class="stat-card"><div class="label">Files Analyzed</div><div class="value accent" id="statFiles">—</div></div>
    <div class="stat-card"><div class="label">AI-Attributed</div><div class="value yellow" id="statAttributed">—</div></div>
    <div class="stat-card"><div class="label">Unattributed</div><div class="value red" id="statSuspicious">—</div></div>
    <div class="stat-card"><div class="label">Top Model</div><div class="value green" id="statModel">—</div></div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span>AI Code Share Over Time</span>
      <span style="font-size:0.75rem;color:var(--muted)" id="chartInfo"></span>
    </div>
    <div class="panel-body">
      <div class="chart-container">
        <div class="chart-bar-group" id="chartBars"></div>
        <div class="chart-labels" id="chartLabels"></div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span>Repositories</span>
      <span style="font-size:0.75rem;color:var(--muted)" id="repoCount"></span>
    </div>
    <div class="panel-body">
      <div class="repo-cards" id="repoCards"><div class="empty">No scan history yet. Run a scan to get started.</div></div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span>Latest Matches</span>
      <span style="font-size:0.75rem;color:var(--muted)" id="matchCount"></span>
    </div>
    <div class="panel-body" style="padding:0;">
      <table>
        <thead><tr><th>File</th><th>Line</th><th>Type</th><th>Confidence</th><th>Source</th><th>Similarity</th></tr></thead>
        <tbody id="matchTable"><tr><td colspan="6" class="empty">No matches yet.</td></tr></tbody>
      </table>
    </div>
  </div>

  <footer>AI Footprint v0.1 — Git-native provenance tracking</footer>
</div>

<script>
async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

async function loadDashboard() {
  const [repos, history] = await Promise.all([api('/api/repos'), api('/api/history')]);

  // Stats from latest entry
  const entries = history.entries || [];
  if (entries.length > 0) {
    const last = entries[entries.length - 1];
    document.getElementById('statFiles').textContent = last.report.filesAnalyzed;
    document.getElementById('statAttributed').textContent = last.report.aiAttributedFiles;
    document.getElementById('statSuspicious').textContent = last.report.unattributedSuspicious;
    document.getElementById('statModel').textContent = last.report.topModel || 'none';

    // Match table
    const matches = last.report.matches || [];
    document.getElementById('matchCount').textContent = matches.length + ' match(es)';
    if (matches.length > 0) {
      document.getElementById('matchTable').innerHTML = matches.slice(0, 100).map(m =>
        '<tr>' +
        '<td>' + esc(m.file) + '</td>' +
        '<td>' + m.line + '</td>' +
        '<td><span class="badge ' + (m.matchType || 'pattern') + '">' + (m.matchType || 'pattern') + '</span></td>' +
        '<td><span class="badge ' + m.confidence + '">' + m.confidence + '</span></td>' +
        '<td>' + (m.snippet ? esc(m.snippet.model || m.snippet.source) : esc(m.pattern || '')) + '</td>' +
        '<td>' + (m.similarity != null ? Math.round(m.similarity * 100) + '%' : '—') + '</td>' +
        '</tr>'
      ).join('');
    }
  }

  // Trend chart
  if (entries.length > 1) {
    const last30 = entries.slice(-30);
    const maxFiles = Math.max(...last30.map(e => e.report.filesAnalyzed), 1);
    document.getElementById('chartInfo').textContent = last30.length + ' scans';
    document.getElementById('chartBars').innerHTML = last30.map(e => {
      const aiPct = e.report.filesAnalyzed > 0 ? (e.report.aiAttributedFiles / e.report.filesAnalyzed * 100) : 0;
      const h = Math.max(4, (e.report.aiAttributedFiles / maxFiles) * 160);
      return '<div class="chart-bar" style="height:' + h + 'px;background:var(--accent);"><div class="tooltip">' +
        esc(e.timestamp.slice(0,10)) + ' — ' + e.report.aiAttributedFiles + ' AI files (' + aiPct.toFixed(1) + '%)</div></div>';
    }).join('');
    document.getElementById('chartLabels').innerHTML = last30.map(e =>
      '<span>' + e.timestamp.slice(5,10) + '</span>'
    ).join('');
  }

  // Repo cards
  if (repos.length > 0) {
    document.getElementById('repoCount').textContent = repos.length + ' repo(s)';
    document.getElementById('repoCards').innerHTML = repos.map(r => {
      const latest = r.latest;
      const pct = latest && latest.report.filesAnalyzed > 0
        ? (latest.report.aiAttributedFiles / latest.report.filesAnalyzed * 100).toFixed(1)
        : '0.0';
      return '<div class="repo-card">' +
        '<h3>' + esc(r.repo) + '</h3>' +
        '<div class="meta">' + r.entries + ' scan(s) · Latest: ' + (latest ? esc(latest.timestamp.slice(0,10)) : '—') + '</div>' +
        '<div style="margin-top:0.5rem;">' +
          '<span class="badge medium">' + pct + '% AI code</span> ' +
          '<span class="badge high">' + (latest?.report.aiAttributedFiles ?? 0) + ' AI files</span> ' +
          '<span class="badge low">' + (latest?.report.filesAnalyzed ?? 0) + ' total</span>' +
        '</div>' +
        (r.trend.length > 1 ? '<div style="margin-top:0.5rem;display:flex;align-items:flex-end;gap:1px;height:40px;">' +
          r.trend.slice(-20).map(t => {
            const maxAi = Math.max(...r.trend.map(x => x.aiFiles), 1);
            const h = Math.max(2, (t.aiFiles / maxAi) * 36);
            return '<div style="flex:1;height:' + h + 'px;background:var(--accent);border-radius:2px 2px 0 0;min-width:3px;" title="' + esc(t.date) + ': ' + t.aiFiles + ' AI files"></div>';
          }).join('') +
        '</div>' : '') +
      '</div>';
    }).join('');
  }
}

async function triggerScan() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Scanning…';
  try {
    await api('/api/scan', { method: 'POST' });
    await loadDashboard();
  } catch (e) {
    alert('Scan failed: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Run Scan';
}

loadDashboard();
</script>
</body>
</html>`;
}
