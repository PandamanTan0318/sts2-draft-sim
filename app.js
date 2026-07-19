// ---------------------------------------------------------------------------
// Slay the Spire 2 Draft Simulator
//
// Rarity odds, the pity ("rarity offset") mechanic, and the act-based upgrade
// chance are taken from https://slay-the-spire.fandom.com/wiki/Card_Rewards
// (Slay the Spire 1 data, applied here as a stand-in since STS2 has no public
// datamined equivalent yet). The "Elite RNG" per-choice randomization (20-33%)
// is a custom rule for this tool, not from that source.
// ---------------------------------------------------------------------------

const CLASSES = ["Ironclad", "Silent", "Regent", "Necrobinder", "Defect"];
const DRAFTABLE_RARITIES = ["Common", "Uncommon", "Rare"];

const RARITY_TABLES = {
  normal: { rare: 3, uncommon: 37, common: 60 },
  elite: { rare: 10, uncommon: 40, common: 50 },
};

// Index 0 = Act 1, 1 = Act 2, 2 = Act 3. Only Common/Uncommon can roll upgraded.
const UPGRADE_CHANCE_BY_ACT = [0, 25, 50];

const PITY_MIN = -5;
const PITY_MAX = 40;

const cardsBySlug = new Map(CARD_DATA.map((c) => [c.slug, c]));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  className: null,
  includeColorless: false,
  picksTotal: 10,
  copies: 1,
  pityOffset: PITY_MIN,
  pickIndex: 0,
  currentChoices: [],
  deck: [], // { slug, isUpgraded }
  poolByRarity: null,
  deckView: "list",
};

// ---------------------------------------------------------------------------
// Draft math
// ---------------------------------------------------------------------------

function computeAdjustedOdds(base, offset) {
  if (offset >= 0) {
    const rare = base.rare + offset;
    const common = Math.max(0, base.common - offset);
    const uncommon = 100 - rare - common;
    return { rare, uncommon, common };
  }
  const deficit = -offset;
  const rare = Math.max(0, base.rare - deficit);
  const usedFromRare = base.rare - rare;
  const remainingDeficit = deficit - usedFromRare;
  const uncommon = Math.max(0, base.uncommon - remainingDeficit);
  const common = 100 - rare - uncommon;
  return { rare, uncommon, common };
}

function rollRarity(odds) {
  const r = Math.random() * 100;
  if (r < odds.rare) return "Rare";
  if (r < odds.rare + odds.uncommon) return "Uncommon";
  return "Common";
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function currentAct() {
  const frac = state.pickIndex / state.picksTotal;
  if (frac < 1 / 3) return 1;
  if (frac < 2 / 3) return 2;
  return 3;
}

function buildPool() {
  const pool = CARD_DATA.filter((c) => {
    if (!DRAFTABLE_RARITIES.includes(c.rarity)) return false;
    if (c.class === state.className) return true;
    if (state.includeColorless && c.class === "Colorless") return true;
    return false;
  });
  const byRarity = { Common: [], Uncommon: [], Rare: [] };
  for (const c of pool) byRarity[c.rarity].push(c);
  state.poolByRarity = byRarity;
  state.pool = pool;
}

function rollNextPick() {
  const act = currentAct();
  const choices = [];
  const usedNames = new Set();

  for (let i = 0; i < 3; i++) {
    const eliteChance = randRange(20, 33);
    const isElite = Math.random() * 100 < eliteChance;
    const base = isElite ? RARITY_TABLES.elite : RARITY_TABLES.normal;
    const odds = computeAdjustedOdds(base, state.pityOffset);
    const rarity = rollRarity(odds);

    if (rarity === "Rare") state.pityOffset = PITY_MIN;
    else if (rarity === "Common")
      state.pityOffset = Math.min(PITY_MAX, state.pityOffset + 1);

    let candidates = state.poolByRarity[rarity].filter(
      (c) => !usedNames.has(c.name)
    );
    if (candidates.length === 0) {
      candidates = state.pool.filter((c) => !usedNames.has(c.name));
    }
    const card = candidates[Math.floor(Math.random() * candidates.length)];
    usedNames.add(card.name);

    const upgradeChance =
      rarity === "Rare" ? 0 : UPGRADE_CHANCE_BY_ACT[act - 1];
    const isUpgraded = Math.random() * 100 < upgradeChance;

    choices.push({ card, rarity, isElite, isUpgraded });
  }

  state.currentChoices = choices;
}

function pickChoice(index) {
  const chosen = state.currentChoices[index];
  for (let i = 0; i < state.copies; i++) {
    state.deck.push({ slug: chosen.card.slug, isUpgraded: chosen.isUpgraded });
  }
  state.pickIndex++;

  if (state.pickIndex >= state.picksTotal) {
    showScreen("final");
    renderFinalDeck();
  } else {
    rollNextPick();
    renderDraftScreen();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function showScreen(name) {
  for (const s of ["setup", "draft", "final"]) {
    document
      .getElementById(`screen-${s}`)
      .classList.toggle("hidden", s !== name);
  }
}

function renderClassGrid() {
  const grid = document.getElementById("class-select");
  grid.innerHTML = "";
  for (const cls of CLASSES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "class-btn";
    btn.textContent = cls;
    btn.dataset.class = cls;
    btn.addEventListener("click", () => {
      state.className = cls;
      document
        .querySelectorAll(".class-btn")
        .forEach((b) => b.classList.toggle("selected", b === btn));
      updateStartButton();
    });
    grid.appendChild(btn);
  }
}

function updateDeckSizeHint() {
  const picks = state.picksTotal;
  const copies = state.copies;
  document.getElementById(
    "deck-size-hint"
  ).textContent = `Final deck size: ${picks * copies} cards (${picks} picks x ${copies} cop${
    copies === 1 ? "y" : "ies"
  })`;
}

function updateStartButton() {
  document.getElementById("start-draft-btn").disabled = !state.className;
}

function cardArt(card, isUpgraded) {
  return isUpgraded && card.artUpgraded ? card.artUpgraded : card.artBase;
}

function renderCardTile(choice, onClick) {
  const { card, rarity, isUpgraded } = choice;
  const tile = document.createElement("div");
  tile.className = "card-tile";
  tile.addEventListener("click", onClick);

  const artWrap = document.createElement("div");
  artWrap.className = "card-art-wrap";
  const art = cardArt(card, isUpgraded);
  if (art) {
    const img = document.createElement("img");
    img.src = art;
    img.alt = card.name;
    img.onerror = () => {
      artWrap.innerHTML = `<div class="card-art-fallback">${card.name}</div>`;
    };
    artWrap.appendChild(img);
  } else {
    artWrap.innerHTML = `<div class="card-art-fallback">${card.name}</div>`;
  }
  tile.appendChild(artWrap);

  const nameRow = document.createElement("div");
  nameRow.className = "card-name-row";
  nameRow.innerHTML = `<span class="card-name">${card.name}${
    isUpgraded ? "+" : ""
  }</span><span class="card-cost">${card.cost ?? "-"}</span>`;
  tile.appendChild(nameRow);

  const badgeRow = document.createElement("div");
  badgeRow.className = "badge-row";
  badgeRow.innerHTML = `
    <span class="badge rarity-${rarity.toLowerCase()}">${rarity}</span>
    <span class="badge type">${card.type}</span>
    ${isUpgraded ? '<span class="badge upgraded">Upgraded</span>' : ""}
  `;
  tile.appendChild(badgeRow);

  const text = document.createElement("div");
  text.className = "card-text";
  text.textContent = isUpgraded && card.upgradedText ? card.upgradedText : card.baseText;
  tile.appendChild(text);

  return tile;
}

function renderDraftScreen() {
  document.getElementById(
    "pick-progress-label"
  ).textContent = `Pick ${state.pickIndex + 1} of ${state.picksTotal}`;

  const grid = document.getElementById("choice-grid");
  grid.innerHTML = "";
  state.currentChoices.forEach((choice, i) => {
    grid.appendChild(renderCardTile(choice, () => pickChoice(i)));
  });
}

function buildFinalDeckRows() {
  const counts = new Map(); // key: slug|upgraded -> count
  for (const entry of state.deck) {
    const key = `${entry.slug}|${entry.isUpgraded}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const rows = [];
  for (const [key, count] of counts) {
    const [slug, upgraded] = key.split("|");
    const card = cardsBySlug.get(slug);
    rows.push({ card, isUpgraded: upgraded === "true", count, starting: false });
  }

  const includeStarting = document.getElementById(
    "include-starting-toggle"
  ).checked;
  if (includeStarting) {
    const roster = STARTING_DECKS[state.className] || [];
    for (const entry of roster) {
      const card = cardsBySlug.get(entry.slug);
      if (!card) continue;
      rows.push({ card, isUpgraded: false, count: entry.count, starting: true });
    }
  }

  rows.sort((a, b) => {
    if (a.starting !== b.starting) return a.starting ? 1 : -1;
    return a.card.name.localeCompare(b.card.name);
  });

  return rows;
}

function displayName(row) {
  return row.card.name + (row.isUpgraded ? "+" : "");
}

function renderDeckListView(rows) {
  const list = document.getElementById("final-deck-list");
  list.innerHTML = "";

  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "deck-row" + (row.starting ? " starting" : "");
    div.innerHTML = `<span class="name">${displayName(row)}</span><span class="count">x${row.count}</span>`;
    list.appendChild(div);
  }

  if (rows.length === 0) {
    list.innerHTML = `<p class="hint">No cards drafted.</p>`;
  }
}

function renderDeckCardsView(rows) {
  const grid = document.getElementById("final-deck-cards");
  grid.innerHTML = "";

  for (const row of rows) {
    const tile = document.createElement("div");
    tile.className = "deck-card-tile" + (row.starting ? " starting" : "");

    if (row.count > 1) {
      const badge = document.createElement("div");
      badge.className = "deck-card-multiplier";
      badge.textContent = `x${row.count}`;
      tile.appendChild(badge);
    }

    const artWrap = document.createElement("div");
    artWrap.className = "card-art-wrap";
    const art = cardArt(row.card, row.isUpgraded);
    if (art) {
      const img = document.createElement("img");
      img.src = art;
      img.alt = row.card.name;
      img.onerror = () => {
        artWrap.innerHTML = `<div class="card-art-fallback">${row.card.name}</div>`;
      };
      artWrap.appendChild(img);
    } else {
      artWrap.innerHTML = `<div class="card-art-fallback">${row.card.name}</div>`;
    }
    tile.appendChild(artWrap);

    const name = document.createElement("div");
    name.className = "deck-card-name";
    name.textContent = displayName(row);
    tile.appendChild(name);

    grid.appendChild(tile);
  }

  if (rows.length === 0) {
    grid.innerHTML = `<p class="hint">No cards drafted.</p>`;
  }
}

function renderFinalDeck() {
  const rows = buildFinalDeckRows();
  renderDeckListView(rows);
  renderDeckCardsView(rows);
}

function setDeckView(view) {
  state.deckView = view;
  document
    .querySelectorAll(".view-btn")
    .forEach((b) => b.classList.toggle("selected", b.dataset.view === view));
  document
    .getElementById("final-deck-list")
    .classList.toggle("hidden", view !== "list");
  document
    .getElementById("final-deck-cards")
    .classList.toggle("hidden", view !== "cards");
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function init() {
  renderClassGrid();
  updateDeckSizeHint();

  document.getElementById("picks-select").addEventListener("change", (e) => {
    state.picksTotal = parseInt(e.target.value, 10);
    updateDeckSizeHint();
  });
  document.getElementById("copies-select").addEventListener("change", (e) => {
    state.copies = parseInt(e.target.value, 10);
    updateDeckSizeHint();
  });
  document.getElementById("include-colorless").addEventListener("change", (e) => {
    state.includeColorless = e.target.checked;
  });

  document.getElementById("start-draft-btn").addEventListener("click", () => {
    state.pityOffset = PITY_MIN;
    state.pickIndex = 0;
    state.deck = [];
    buildPool();
    showScreen("draft");
    rollNextPick();
    renderDraftScreen();
  });

  document.getElementById("include-starting-toggle").addEventListener(
    "change",
    renderFinalDeck
  );

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => setDeckView(btn.dataset.view));
  });

  document.getElementById("restart-btn").addEventListener("click", () => {
    setDeckView("list");
    showScreen("setup");
  });
}

init();
