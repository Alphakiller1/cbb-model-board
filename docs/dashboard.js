const feedUrl = "https://raw.githubusercontent.com/Alphakiller1/cbb-model-board/main/board.json";
const eastern = "America/New_York";
const slateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: eastern });
const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", timeZone: eastern, timeZoneName: "short",
});

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

  const link = card.querySelector(".matchup-link");
  const matchupUrl = new URL("https://chase-analytics.com/cbb/matchup.html");
  matchupUrl.searchParams.set("game", game.id);
  link.href = matchupUrl.href;
  link.setAttribute("aria-label", `Explore ${game.away_name} at ${game.home_name}`);
  return card;
}

async function load() {
  const response = await fetch(feedUrl, { cache: "no-cache", credentials: "omit" });
  if (!response.ok) throw new Error(`Score feed returned ${response.status}`);
  const { board } = await response.json();
  if (board?.schema !== "chase-board/1" || board.sport !== "cbb" || !Array.isArray(board.games)) {
    throw new Error("Unexpected score feed format");
  }

  document.getElementById("snapshot-date").textContent = dateFormat.format(new Date(`${board.as_of_date}T12:00:00Z`));
  document.getElementById("training-date").textContent = dateFormat.format(new Date(board.data_through_utc));
  const generated = new Date(board.generated_at_utc);
  document.getElementById("generated-time").textContent = `${dateFormat.format(generated)} · ${timeFormat.format(generated)}`;
  document.getElementById("method-note").textContent = board.method_note;

  const dates = [...new Set([board.as_of_date, ...board.games.map(game => game.slate_date)])].sort();
  dateSelect.replaceChildren(...dates.map(date => new Option(slateLabel(date), date)));
  dateSelect.value = board.as_of_date;

  const byTip = (first, second) => Date.parse(first.kickoff_utc) - Date.parse(second.kickoff_utc);
  const orders = {
    time: byTip,
    margin: (first, second) => Math.abs(second.model_margin) - Math.abs(first.model_margin) || byTip(first, second),
    total: (first, second) => second.projected_total - first.projected_total || byTip(first, second),
  };

  function showSlate() {
    const query = search.value.trim().toLowerCase();
    const selectedGames = board.games.filter(game => game.slate_date === dateSelect.value &&
      [game.away, game.away_name, game.home, game.home_name].some(name => name.toLowerCase().includes(query)));
    selectedGames.sort(orders[sort.value]);
    games.replaceChildren(...selectedGames.map(renderGame));

    if (selectedGames.length) {
      status.textContent = `${selectedGames.length} ${selectedGames.length === 1 ? "matchup" : "matchups"} · All times Eastern`;
    } else {
      status.textContent = query ? "No teams match that search." : "No published projections for this date.";
    }
  }

  showSlate();
  dateSelect.addEventListener("change", showSlate);
  search.addEventListener("input", showSlate);
  sort.addEventListener("change", showSlate);
  filters.disabled = false;
}

load().catch(error => {
  console.error(error);
  status.textContent = "The score feed is unavailable. Reload the page to try again.";
});
