import { selectedDate, startFeedRefresh } from "./feed-refresh.js";

const feedUrl = new URL("./board.json", import.meta.url);
const eastern = "America/New_York";
const slateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: eastern });
const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", timeZone: eastern, timeZoneName: "short",
});
const tierRank = { max: 3, strong: 2, lean: 1 };

const filters = document.getElementById("filters");
const dateSelect = document.getElementById("slate-date");
const search = document.getElementById("team-search");
const sort = document.getElementById("sort-order");
const status = document.getElementById("board-status");
const games = document.getElementById("games");
const template = document.getElementById("game-card");

function slateLabel(date) {
  return slateFormat.format(new Date(`${date}T12:00:00Z`));
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const signed = (n, digits = 1) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(digits);
const spreadText = (team, line) => `${team} ${line === 0 ? "PK" : signed(line)}`;
const pct = (p) => `${(p * 100).toFixed(1)}%`;

function cell(row, text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  row.append(td);
  return td;
}

function pill(text, kind) {
  const span = document.createElement("span");
  span.className = `pill pill-${kind}`;
  span.textContent = text;
  return span;
}

// Spread edge values are the home team's spread (negative = home favored).
function edgeBet(game, kind, edge) {
  if (kind === "total") return `${edge.side === "over" ? "Over" : "Under"} ${edge.opener.toFixed(1)}`;
  return edge.side === "home" ? spreadText(game.home, edge.opener) : spreadText(game.away, -edge.opener);
}

function edgeLine(game, kind, value) {
  return kind === "total" ? value.toFixed(1) : spreadText(game.home, value);
}

function bestEdge(game) {
  return Object.values(game.edges || {}).reduce((best, edge) => Math.max(best, edge.tier ? edge.probability : 0), 0);
}

function renderTeam(card, game, side) {
  const row = card.querySelector(`[data-side="${side}"]`);
  const name = game[`${side}_name`];
  const record = game[`${side}_record`];
  const logo = row.querySelector("img");
  logo.addEventListener("error", () => { logo.hidden = true; }, { once: true });
  logo.src = game[`${side}_logo`];
  row.querySelector(".team-name").textContent = name;
  row.querySelector(".team-record").textContent = `${side === "away" ? "Away" : "Home"} · ${record}`;
  const score = game[`projected_${side}`].toFixed(1);
  row.querySelector(".score").textContent = score;
  row.querySelector(".score").setAttribute("aria-label", `Projected score ${score}`);
}

function renderLines(card, game) {
  const lines = card.querySelector(".lines");
  const market = game.market || {};
  const modelSpread = -game.model_margin;
  if (!finite(market.home_spread) && !finite(market.total)) return;
  lines.hidden = false;
  card.querySelector(".line-market").textContent = finite(market.home_spread) ? `DK ${spreadText(game.home, market.home_spread)}` : "DK —";
  card.querySelector(".line-model").textContent = `Model ${spreadText(game.home, Math.round(modelSpread * 2) / 2)}`;
  card.querySelector(".total-market").textContent = finite(market.total) ? `DK ${market.total.toFixed(1)}` : "DK —";
  card.querySelector(".total-model").textContent = `Model ${game.projected_total.toFixed(1)}`;

  const flags = card.querySelector(".edge-flags");
  for (const kind of ["spread", "total"]) {
    const edge = (game.edges || {})[kind];
    if (!edge) continue;
    if (edge.tier) {
      const flag = document.createElement("span");
      flag.className = "edge-flag";
      flag.append(pill(edge.tier, edge.tier), ` ${edgeBet(game, kind, edge)} · ${pct(edge.probability)}`);
      flags.append(flag);
    } else if (edge.line_moved && finite(edge.current)) {
      const moved = document.createElement("span");
      moved.className = `edge-move ${edge.move_toward_model ? "toward" : "away"}`;
      moved.textContent = `${kind === "spread" ? "Spread" : "Total"} moved ${edgeLine(game, kind, edge.opener)} → ${edgeLine(game, kind, edge.current)}, ${edge.move_toward_model ? "toward" : "away from"} the model`;
      flags.append(moved);
    }
  }
}

function renderGame(game) {
  const card = template.content.cloneNode(true);
  const tip = card.querySelector("time");
  tip.dateTime = game.kickoff_utc;
  tip.textContent = timeFormat.format(new Date(game.kickoff_utc));
  card.querySelector("h3").textContent = `${game.away_name} at ${game.home_name}`;
  renderTeam(card, game, "away");
  renderTeam(card, game, "home");

  card.querySelector(".total").textContent = game.projected_total.toFixed(1);
  const margin = Math.abs(game.model_margin).toFixed(1);
  const leader = game.model_margin > 0 ? game.home : game.away;
  card.querySelector(".margin").textContent = margin === "0.0" ? "Even" : `${leader} by ${margin}`;
  renderLines(card, game);

  const link = card.querySelector(".matchup-link");
  const matchupUrl = new URL("https://chase-analytics.com/cbb/matchup.html");
  matchupUrl.searchParams.set("game", game.id);
  link.href = matchupUrl.href;
  link.setAttribute("aria-label", `Explore ${game.away_name} at ${game.home_name}`);
  return card;
}

function renderWeakLines(slateGames) {
  const section = document.getElementById("weak-lines");
  const body = document.getElementById("weak-rows");
  const empty = document.getElementById("weak-empty");
  const flagged = [];
  for (const game of slateGames) {
    for (const [kind, edge] of Object.entries(game.edges || {})) {
      if (edge.tier) flagged.push({ game, kind, edge });
    }
  }
  flagged.sort((a, b) => b.edge.probability - a.edge.probability);
  body.replaceChildren(...flagged.map(({ game, kind, edge }) => {
    const row = document.createElement("tr");
    cell(row, timeFormat.format(new Date(game.kickoff_utc)), "nowrap col-tip");
    cell(row, `${game.away} at ${game.home}`, "game-cell");
    cell(row, edgeBet(game, kind, edge), "strong nowrap");
    cell(row, edgeLine(game, kind, edge.opener), "nowrap");
    cell(row, edgeLine(game, kind, kind === "spread" ? Math.round(edge.model * 2) / 2 : edge.model), "nowrap");
    cell(row, pct(edge.probability), "num good");
    cell(row, "").append(pill(edge.tier, edge.tier));
    return row;
  }));
  empty.hidden = flagged.length > 0;
  section.querySelector(".table-wrap").hidden = flagged.length === 0;
}

function renderRisk(analysis) {
  const rows = (analysis && Array.isArray(analysis.team_risk)) ? analysis.team_risk : [];
  document.getElementById("risk").hidden = !rows.length;
  if (!rows.length) return;
  for (const [tone, id, order] of [["regression risk", "regression-rows", 1], ["progression", "progression-rows", -1]]) {
    const picked = rows.filter((r) => r.tone === tone).sort((a, b) => order * (b.luck_z - a.luck_z)).slice(0, 15);
    document.getElementById(id).replaceChildren(...picked.map((r) => {
      const row = document.createElement("tr");
      cell(row, r.team, "strong");
      cell(row, String(r.games), "num");
      cell(row, signed(r.results_net), "num");
      cell(row, signed(r.sustainable_net), "num");
      cell(row, signed(r.luck_z, 2), `num ${r.luck_z > 0 ? "bad" : "good"}`);
      const mv = r.market_vs_model;
      const agrees = finite(mv) && ((tone === "regression risk" && mv > 0) || (tone === "progression" && mv < 0));
      cell(row, finite(mv) ? signed(mv) : "", `num ${agrees ? (tone === "progression" ? "good" : "bad") : "muted"}`);
      return row;
    }));
  }
}

function renderRecord(analysis) {
  const rows = (analysis && Array.isArray(analysis.edge_record)) ? analysis.edge_record : [];
  document.getElementById("record").hidden = !rows.length;
  if (!rows.length) return;
  const grouped = new Map();
  for (const r of rows) {
    const key = `${r.market}|${r.tier}`;
    if (!grouped.has(key)) grouped.set(key, { market: r.market, tier: r.tier, seasons: {} });
    grouped.get(key).seasons[r.season] = r;
  }
  document.getElementById("record-rows").replaceChildren(...[...grouped.values()].map((g) => {
    const row = document.createElement("tr");
    cell(row, g.market);
    cell(row, "").append(pill(g.tier, g.tier));
    for (const season of [2024, 2025, 2026]) {
      const r = g.seasons[season];
      cell(row, r ? `${pct(r.win_pct)} (${r.bets.toLocaleString("en-US")})` : "", r ? `num ${r.win_pct >= 0.524 ? "good" : "bad"}` : "num");
    }
    return row;
  }));
}

async function fetchBoard() {
  const url = new URL(feedUrl);
  // Check the feed deployed with this page, including after a manual reload.
  url.searchParams.set("refresh", String(Date.now()));
  const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Score feed returned ${response.status}`);
  const { board } = await response.json();
  if (board?.schema !== "chase-board/1" || board.sport !== "cbb" || !Array.isArray(board.games)) {
    throw new Error("Unexpected score feed format");
  }
  return board;
}

let showSlate = () => {};
function renderBoard(board, previous) {
  document.getElementById("snapshot-date").textContent = dateFormat.format(new Date(`${board.as_of_date}T12:00:00Z`));
  document.getElementById("training-date").textContent = dateFormat.format(new Date(board.data_through_utc));
  const generated = new Date(board.generated_at_utc);
  document.getElementById("generated-time").textContent = `${dateFormat.format(generated)} · ${timeFormat.format(generated)}`;
  document.getElementById("model-name").textContent = board.method;
  document.getElementById("method-note").textContent = board.method_note;
  document.getElementById("edge-policy").textContent = board.analysis?.edge_policy || "";

  const dates = [...new Set([board.as_of_date, ...board.games.map(game => game.slate_date)])].sort();
  const nextDate = selectedDate(dateSelect.value, previous?.as_of_date, board.as_of_date, dates);
  dateSelect.replaceChildren(...dates.map(date => new Option(slateLabel(date), date)));
  dateSelect.value = nextDate;

  const byTip = (first, second) => Date.parse(first.kickoff_utc) - Date.parse(second.kickoff_utc);
  const orders = {
    time: byTip,
    margin: (first, second) => Math.abs(second.model_margin) - Math.abs(first.model_margin) || byTip(first, second),
    total: (first, second) => second.projected_total - first.projected_total || byTip(first, second),
    edge: (first, second) => bestEdge(second) - bestEdge(first) || byTip(first, second),
  };
  const hasEdges = board.games.some((game) => game.edges);
  document.getElementById("weak-lines").hidden = !hasEdges;

  showSlate = () => {
    const query = search.value.trim().toLowerCase();
    const slateGames = board.games.filter(game => game.slate_date === dateSelect.value);
    const selectedGames = slateGames.filter(game =>
      [game.away, game.away_name, game.home, game.home_name].some(name => name.toLowerCase().includes(query)));
    selectedGames.sort(orders[sort.value]);
    games.replaceChildren(...selectedGames.map(renderGame));
    if (hasEdges) renderWeakLines(selectedGames);

    if (selectedGames.length) {
      status.textContent = `${selectedGames.length} ${selectedGames.length === 1 ? "matchup" : "matchups"} · All times Eastern`;
    } else {
      status.textContent = query ? "No teams match that search." : "No published projections for this date.";
    }
  };

  renderRisk(board.analysis);
  renderRecord(board.analysis);
  showSlate();
  filters.disabled = false;
}

dateSelect.addEventListener("change", () => showSlate());
search.addEventListener("input", () => showSlate());
sort.addEventListener("change", () => showSlate());

const refreshStatus = document.getElementById("refresh-status");
const refresher = startFeedRefresh({
  fetchBoard, render: renderBoard,
  report({ board, checkedAt, error, stale }) {
    refreshStatus.classList.toggle("bad", Boolean(error) || stale);
    if (error) {
      refreshStatus.textContent = board
        ? "Refresh failed. Showing the last loaded forecasts; retrying automatically every 5 minutes."
        : "The score feed is unavailable. Retrying automatically every 5 minutes.";
      if (!board) status.textContent = "Waiting for the published score feed…";
    } else if (stale) {
      refreshStatus.textContent = "Forecasts are behind the current refresh cycle. Showing the last published board; checking again every 5 minutes.";
    } else {
      refreshStatus.textContent = `Auto-refresh on · Checked ${timeFormat.format(checkedAt)} · Next check within 5 minutes`;
    }
  },
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresher.refresh();
});
window.addEventListener("focus", () => { void refresher.refresh(); });
