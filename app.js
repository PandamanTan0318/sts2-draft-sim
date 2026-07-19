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

// Class-specific keyword tags are hidden by default (state.showNicheTags) since they're
// only meaningful if you know that character's mechanics. General tags always show.
const NICHE_TAGS = new Set([
  "Shiv", "Poison", "Sly", // Silent
  "Star", "Forge", // Regent
  "Summon", "Doom", "Souls", // Necrobinder
  "Channel", "Evoke", // Defect
]);

const CLASS_COLOR = {
  Ironclad: "#d1544a",
  Silent: "#57ad6b",
  Regent: "#e0953f",
  Necrobinder: "#9d72d4",
  Defect: "#4f9bd9",
};

const RARITY_ACCENT = { Common: "#9aa0ad", Uncommon: "#5aa9e6", Rare: "#e6c15a", Basic: "#8a8f9c" };
const TYPE_COLOR = { Attack: "#e07a6b", Skill: "#5aa9e6", Power: "#b48ce6" };
const RARITY_ORDER = { Rare: 0, Uncommon: 1, Common: 2, Basic: 3 };

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const cardsBySlug = new Map(CARD_DATA.map((c) => [c.slug, c]));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  className: null,
  includeColorless: false,
  showNicheTags: false,
  picksTotal: 10,
  copies: 1,
  pityOffset: PITY_MIN,
  pickIndex: 0,
  currentChoices: [],
  deck: [], // { slug, isUpgraded }
  poolByRarity: null,
  pool: null,
  history: [], // snapshots for undo: { pityOffset, pickIndex, deck, currentChoices }
  deckView: "cards",
  search: "",
  filterType: "All",
  filterRarity: "All",
  sortBy: "rarity",
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
  state.history.push({
    pityOffset: state.pityOffset,
    pickIndex: state.pickIndex,
    deck: state.deck.slice(),
    currentChoices: state.currentChoices,
  });

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
    renderDraftScreen(true);
  }
}

function undoLastPick() {
  if (state.history.length === 0) return;
  const snap = state.history.pop();
  state.pityOffset = snap.pityOffset;
  state.pickIndex = snap.pickIndex;
  state.deck = snap.deck;
  state.currentChoices = snap.currentChoices;
  renderDraftScreen(false);
}

function costBucket(card) {
  const n = parseInt(card.cost, 10);
  if (Number.isNaN(n)) return "X";
  if (n >= 4) return "4+";
  return String(n);
}

function groupDeck(deck) {
  const m = new Map();
  for (const e of deck) {
    const key = `${e.slug}|${e.isUpgraded}`;
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

function showScreen(name) {
  for (const s of ["setup", "draft", "final"]) {
    document.getElementById(`screen-${s}`).classList.toggle("hidden", s !== name);
  }
  document.getElementById("header-restart-btn").classList.toggle("hidden", name === "setup");
  renderStepper(name);
}

function stepMeta(active, done, num, label) {
  if (active) return { num, label, bg: "rgba(201,162,78,0.14)", border: "rgba(201,162,78,0.5)", dot: "#c9a24e", dotText: "#14110a", text: "#e0bd68" };
  if (done) return { num: "✓", label, bg: "transparent", border: "rgba(201,162,78,0.16)", dot: "rgba(201,162,78,0.35)", dotText: "#14110a", text: "#9a9382" };
  return { num, label, bg: "transparent", border: "rgba(255,255,255,0.08)", dot: "rgba(255,255,255,0.1)", dotText: "#9a9382", text: "#6f6a5e" };
}

function renderStepper(screen) {
  const steps = [
    stepMeta(screen === "setup", screen !== "setup", "1", "Setup"),
    stepMeta(screen === "draft", screen === "final", "2", "Draft"),
    stepMeta(screen === "final", false, "3", "Deck"),
  ];
  const el = document.getElementById("stepper");
  el.innerHTML = steps
    .map(
      (st) => `
    <div class="step" style="background:${st.bg}; border:1px solid ${st.border};">
      <span class="step-dot" style="background:${st.dot}; color:${st.dotText};">${st.num}</span>
      <span class="step-label" style="color:${st.text};">${st.label}</span>
    </div>`
    )
    .join("");
}

function cardArt(card, isUpgraded) {
  return isUpgraded && card.artUpgraded ? card.artUpgraded : card.artBase;
}

function cardText(card, isUpgraded) {
  return isUpgraded && card.upgradedText ? card.upgradedText : card.baseText;
}

function setArt(wrap, card, isUpgraded) {
  wrap.innerHTML = "";
  const art = cardArt(card, isUpgraded);
  if (art) {
    const img = document.createElement("img");
    img.src = art;
    img.alt = card.name;
    img.onerror = () => {
      wrap.innerHTML = `<div class="card-art-fallback">${card.name}</div>`;
    };
    wrap.appendChild(img);
  } else {
    wrap.innerHTML = `<div class="card-art-fallback">${card.name}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------

function renderClassGrid() {
  const grid = document.getElementById("class-select");
  grid.innerHTML = "";
  for (const cls of CLASSES) {
    const color = CLASS_COLOR[cls];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "class-btn";
    btn.style.setProperty("--class-color", color);
    btn.style.setProperty("--class-soft", hexA(color, 0.16));
    btn.style.setProperty("--class-line", hexA(color, 0.42));
    btn.innerHTML = `<div class="class-diamond"></div><div class="class-btn-name">${cls}</div>`;
    btn.addEventListener("click", () => {
      state.className = cls;
      document.querySelectorAll(".class-btn").forEach((b) => b.classList.toggle("selected", b === btn));
      updateStartButton();
    });
    grid.appendChild(btn);
  }
}

function setupSegmented(containerId, onSelect) {
  const container = document.getElementById(containerId);
  container.querySelectorAll(".segment").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".segment").forEach((b) => b.classList.toggle("selected", b === btn));
      onSelect(btn.dataset.value);
    });
  });
}

function setupCheckRow(id, onChange) {
  const row = document.getElementById(id);
  row.addEventListener("click", () => {
    const checked = !row.classList.contains("checked");
    row.classList.toggle("checked", checked);
    onChange(checked);
  });
}

function updateDeckSizeHint() {
  const picks = state.picksTotal;
  const copies = state.copies;
  document.getElementById("deck-size-hint").textContent =
    `${picks * copies} cards · ${picks} picks × ${copies}`;
}

function updateStartButton() {
  const disabled = !state.className;
  document.getElementById("start-draft-btn").disabled = disabled;
  document.getElementById("start-hint").classList.toggle("hidden", !disabled);
}

// ---------------------------------------------------------------------------
// Draft screen
// ---------------------------------------------------------------------------

function renderCardTile(choice, onClick) {
  const { card, rarity, isUpgraded } = choice;
  let previewUpgraded = isUpgraded;
  const hasDistinctUpgrade = card.upgradedText && card.upgradedText !== card.baseText;
  const accent = RARITY_ACCENT[rarity] || RARITY_ACCENT.Common;

  const tile = document.createElement("div");
  tile.className = "card-tile";
  tile.style.setProperty("--rarity-accent", accent);
  tile.setAttribute("role", "button");
  tile.setAttribute("tabindex", "0");
  tile.addEventListener("click", onClick);

  if (rarity === "Rare") {
    const flag = document.createElement("div");
    flag.className = "rare-flag";
    flag.textContent = "★ Rare";
    tile.appendChild(flag);
  }

  const artWrap = document.createElement("div");
  artWrap.className = "card-art-wrap";
  tile.appendChild(artWrap);

  const nameRow = document.createElement("div");
  nameRow.className = "card-name-row";
  tile.appendChild(nameRow);

  const badgeRow = document.createElement("div");
  badgeRow.className = "badge-row";
  tile.appendChild(badgeRow);

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "preview-toggle-btn";
  if (hasDistinctUpgrade) tile.appendChild(previewBtn);

  const text = document.createElement("div");
  text.className = "card-text";
  tile.appendChild(text);

  const visibleTags = (card.tags || []).filter((t) => state.showNicheTags || !NICHE_TAGS.has(t));
  if (visibleTags.length > 0) {
    const tagRow = document.createElement("div");
    tagRow.className = "tag-row";
    tagRow.innerHTML = visibleTags.map((t) => `<span class="tag-chip">${t}</span>`).join("");
    tile.appendChild(tagRow);
  }

  function renderVisual() {
    setArt(artWrap, card, previewUpgraded);

    nameRow.innerHTML = `<span class="card-name">${card.name}${
      previewUpgraded ? "+" : ""
    }</span><span class="card-cost">${card.cost ?? "-"}</span>`;

    badgeRow.innerHTML = `
      <span class="badge rarity-${rarity.toLowerCase()}">${rarity}</span>
      <span class="badge type">${card.type}</span>
      ${previewUpgraded ? '<span class="badge upgraded">Upgraded</span>' : ""}
      ${previewUpgraded !== isUpgraded ? '<span class="badge preview">Preview</span>' : ""}
    `;

    text.textContent = cardText(card, previewUpgraded);

    previewBtn.textContent = previewUpgraded ? "↴ Show Base" : "↴ Show Upgrade";
  }

  previewBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    previewUpgraded = !previewUpgraded;
    renderVisual();
  });

  renderVisual();
  return tile;
}

function playDeal(grid) {
  Array.from(grid.children).forEach((child, i) => {
    if (!child.animate) return;
    child.animate(
      [
        { opacity: 0, transform: "translateY(26px) scale(.94)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      { duration: 380, delay: i * 90, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }
    );
  });
}

function renderDraftScreen(animate) {
  const color = CLASS_COLOR[state.className] || "#c9a24e";
  const emblem = document.getElementById("draft-class-emblem");
  emblem.style.setProperty("--class-color", color);
  emblem.style.setProperty("--class-soft", hexA(color, 0.16));

  document.getElementById("pick-title").innerHTML =
    `Pick ${state.pickIndex + 1} <span class="of">of ${state.picksTotal}</span>`;
  document.getElementById("pick-class-name").textContent = state.className;
  document.getElementById("pick-class-name").style.color = color;

  const pct = Math.round((state.pickIndex / state.picksTotal) * 100);
  document.getElementById("progress-fill").style.width = pct + "%";

  const grid = document.getElementById("choice-grid");
  grid.innerHTML = "";
  state.currentChoices.forEach((choice, i) => {
    grid.appendChild(renderCardTile(choice, () => pickChoice(i)));
  });
  if (animate) playDeal(grid);

  const undoBtn = document.getElementById("undo-btn");
  undoBtn.disabled = state.history.length === 0;

  renderSidebar();
}

function computeDeckStats(deck) {
  const buckets = { "0": 0, "1": 0, "2": 0, "3": 0, "4+": 0, X: 0 };
  const types = {};
  let costSum = 0;
  let costN = 0;
  let upgradedCount = 0;
  const cards = [];

  for (const [key, count] of groupDeck(deck)) {
    const [slug, up] = key.split("|");
    const card = cardsBySlug.get(slug);
    if (!card) continue;
    for (let i = 0; i < count; i++) cards.push({ card, isUpgraded: up === "true" });
  }

  for (const d of cards) {
    buckets[costBucket(d.card)]++;
    const n = parseInt(d.card.cost, 10);
    if (!Number.isNaN(n)) {
      costSum += n;
      costN++;
    }
    if (d.isUpgraded) upgradedCount++;
    types[d.card.type] = (types[d.card.type] || 0) + 1;
  }

  return { buckets, types, totalCards: cards.length, costSum, costN, upgradedCount };
}

function renderEnergyCurve(container, buckets, color, showCounts) {
  const max = Math.max(1, ...Object.values(buckets));
  container.innerHTML = Object.keys(buckets)
    .map((label) => {
      const count = buckets[label];
      const h = Math.round((count / max) * 100);
      return `
      <div class="curve-bar-col">
        ${showCounts ? `<span class="curve-count">${count}</span>` : ""}
        <div class="curve-bar" style="height:${h}%; background:${color};"></div>
        <span class="curve-label">${label}</span>
      </div>`;
    })
    .join("");
}

function renderSidebar() {
  const color = CLASS_COLOR[state.className] || "#c9a24e";
  const stats = computeDeckStats(state.deck);

  document.getElementById("sidebar-deck-count").textContent = state.deck.length;
  renderEnergyCurve(document.getElementById("sidebar-curve"), stats.buckets, color, false);

  const total = stats.totalCards || 1;
  const typeBarEl = document.getElementById("sidebar-type-bar");
  typeBarEl.innerHTML = ["Attack", "Skill", "Power"]
    .map((label) => {
      const count = stats.types[label] || 0;
      const pct = Math.round((count / total) * 100);
      return `<div style="width:${pct}%; background:${TYPE_COLOR[label]};"></div>`;
    })
    .join("");
  document.getElementById("sidebar-type-legend").innerHTML = ["Attack", "Skill", "Power"]
    .map(
      (label) => `
    <div class="type-legend-item">
      <span class="type-swatch" style="background:${TYPE_COLOR[label]};"></span>${label} ${stats.types[label] || 0}
    </div>`
    )
    .join("");

  const trayRows = [];
  for (const [key, count] of groupDeck(state.deck)) {
    const [slug, up] = key.split("|");
    const card = cardsBySlug.get(slug);
    if (card) trayRows.push({ card, isUpgraded: up === "true", count });
  }
  trayRows.reverse();

  const tray = document.getElementById("sidebar-tray");
  if (trayRows.length === 0) {
    tray.innerHTML = `<div class="hint" style="padding:8px 0;">Nothing yet — make your first pick.</div>`;
    return;
  }
  tray.innerHTML = "";
  for (const r of trayRows) {
    const row = document.createElement("div");
    row.className = "tray-row";
    const accent = RARITY_ACCENT[r.card.rarity] || RARITY_ACCENT.Common;
    const artDiv = document.createElement("div");
    artDiv.className = "tray-art";
    artDiv.style.border = `1px solid ${accent}`;
    setArt(artDiv, r.card, r.isUpgraded);
    row.appendChild(artDiv);
    const name = document.createElement("span");
    name.className = "tray-name";
    name.textContent = r.card.name + (r.isUpgraded ? "+" : "");
    row.appendChild(name);
    if (r.count > 1) {
      const count = document.createElement("span");
      count.className = "tray-count";
      count.textContent = `×${r.count}`;
      row.appendChild(count);
    }
    tray.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Final deck screen
// ---------------------------------------------------------------------------

function buildFinalRows() {
  const rows = [];
  for (const [key, count] of groupDeck(state.deck)) {
    const [slug, upgraded] = key.split("|");
    const card = cardsBySlug.get(slug);
    if (card) rows.push({ card, isUpgraded: upgraded === "true", count, starting: false });
  }

  if (document.getElementById("include-starting-toggle").classList.contains("checked")) {
    const roster = STARTING_DECKS[state.className] || [];
    for (const entry of roster) {
      const card = cardsBySlug.get(entry.slug);
      if (card) rows.push({ card, isUpgraded: false, count: entry.count, starting: true });
    }
  }

  let filtered = rows;
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    filtered = filtered.filter((r) => r.card.name.toLowerCase().includes(q));
  }
  if (state.filterType !== "All") filtered = filtered.filter((r) => r.card.type === state.filterType);
  if (state.filterRarity !== "All") filtered = filtered.filter((r) => r.card.rarity === state.filterRarity);

  filtered.sort((a, b) => {
    if (a.starting !== b.starting) return a.starting ? 1 : -1;
    if (state.sortBy === "name") return a.card.name.localeCompare(b.card.name);
    if (state.sortBy === "cost") {
      const ca = parseInt(a.card.cost, 10);
      const cb = parseInt(b.card.cost, 10);
      const na = Number.isNaN(ca) ? 99 : ca;
      const nb = Number.isNaN(cb) ? 99 : cb;
      return na - nb || a.card.name.localeCompare(b.card.name);
    }
    const ra = RARITY_ORDER[a.card.rarity] ?? 9;
    const rb = RARITY_ORDER[b.card.rarity] ?? 9;
    return ra - rb || a.card.name.localeCompare(b.card.name);
  });

  return filtered;
}

function renderDeckCardsView(rows) {
  const grid = document.getElementById("final-deck-cards");
  grid.innerHTML = "";
  for (const row of rows) {
    const tile = document.createElement("div");
    tile.className = "deck-card-tile" + (row.starting ? " starting" : "");
    const accent = RARITY_ACCENT[row.card.rarity] || RARITY_ACCENT.Common;
    tile.style.setProperty("--rarity-accent", accent);

    if (row.count > 1) {
      const badge = document.createElement("div");
      badge.className = "deck-card-multiplier";
      badge.textContent = `×${row.count}`;
      tile.appendChild(badge);
    }

    const artWrap = document.createElement("div");
    artWrap.className = "card-art-wrap";
    setArt(artWrap, row.card, row.isUpgraded);
    tile.appendChild(artWrap);

    const name = document.createElement("div");
    name.className = "deck-card-name";
    name.textContent = row.card.name + (row.isUpgraded ? "+" : "");
    tile.appendChild(name);

    grid.appendChild(tile);
  }
}

function renderDeckListView(rows) {
  const list = document.getElementById("final-deck-list");
  list.innerHTML = "";
  for (const row of rows) {
    const accent = RARITY_ACCENT[row.card.rarity] || RARITY_ACCENT.Common;
    const div = document.createElement("div");
    div.className = "deck-row" + (row.starting ? " starting" : "");
    div.style.setProperty("--rarity-accent", accent);
    div.innerHTML = `
      <span class="deck-row-dot"></span>
      <span class="name">${row.card.name}${row.isUpgraded ? "+" : ""}</span>
      <span class="count">×${row.count}</span>
    `;
    list.appendChild(div);
  }
}

function renderFinalDeck() {
  document.getElementById("final-title").textContent = `Your ${state.className} deck`;
  const color = CLASS_COLOR[state.className] || "#c9a24e";
  const emblem = document.getElementById("final-class-emblem");
  emblem.style.setProperty("--class-color", color);
  emblem.style.setProperty("--class-soft", hexA(color, 0.16));

  const stats = computeDeckStats(state.deck);
  renderEnergyCurve(document.getElementById("final-curve"), stats.buckets, color, true);

  const total = stats.totalCards || 1;
  document.getElementById("final-type-bars").innerHTML = ["Attack", "Skill", "Power"]
    .map((label) => {
      const count = stats.types[label] || 0;
      const pct = Math.round((count / total) * 100);
      return `
      <div class="type-stat-row">
        <div class="type-stat-top"><span>${label}</span><span>${count}</span></div>
        <div class="type-stat-track"><div class="type-stat-fill" style="width:${pct}%; background:${TYPE_COLOR[label]};"></div></div>
      </div>`;
    })
    .join("");

  document.getElementById("stat-total").textContent = stats.totalCards;
  document.getElementById("stat-avg-cost").textContent = stats.costN ? (stats.costSum / stats.costN).toFixed(1) : "—";
  document.getElementById("stat-upgraded").textContent = stats.upgradedCount;

  const rows = buildFinalRows();
  renderDeckCardsView(rows);
  renderDeckListView(rows);
  document.getElementById("no-results-hint").classList.toggle("hidden", rows.length !== 0);
}

function setDeckView(view) {
  state.deckView = view;
  document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("selected", b.dataset.view === view));
  document.getElementById("final-deck-cards").classList.toggle("hidden", view !== "cards");
  document.getElementById("final-deck-list").classList.toggle("hidden", view !== "list");
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function init() {
  renderClassGrid();
  updateDeckSizeHint();
  updateStartButton();
  renderStepper("setup");

  setupSegmented("picks-select", (v) => {
    state.picksTotal = parseInt(v, 10);
    updateDeckSizeHint();
  });
  setupSegmented("copies-select", (v) => {
    state.copies = parseInt(v, 10);
    updateDeckSizeHint();
  });
  setupCheckRow("include-colorless", (checked) => {
    state.includeColorless = checked;
  });
  setupCheckRow("show-niche-tags", (checked) => {
    state.showNicheTags = checked;
  });
  setupCheckRow("include-starting-toggle", () => {
    renderFinalDeck();
  });

  document.getElementById("start-draft-btn").addEventListener("click", () => {
    state.pityOffset = PITY_MIN;
    state.pickIndex = 0;
    state.deck = [];
    state.history = [];
    buildPool();
    showScreen("draft");
    rollNextPick();
    renderDraftScreen(true);
  });

  document.getElementById("undo-btn").addEventListener("click", undoLastPick);

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => setDeckView(btn.dataset.view));
  });

  document.getElementById("deck-search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderFinalDeck();
  });
  document.getElementById("filter-type").addEventListener("change", (e) => {
    state.filterType = e.target.value;
    renderFinalDeck();
  });
  document.getElementById("filter-rarity").addEventListener("change", (e) => {
    state.filterRarity = e.target.value;
    renderFinalDeck();
  });
  document.getElementById("sort-by").addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    renderFinalDeck();
  });

  function restart() {
    setDeckView("cards");
    document.getElementById("include-starting-toggle").classList.remove("checked");
    state.search = "";
    document.getElementById("deck-search").value = "";
    state.filterType = "All";
    document.getElementById("filter-type").value = "All";
    state.filterRarity = "All";
    document.getElementById("filter-rarity").value = "All";
    state.sortBy = "rarity";
    document.getElementById("sort-by").value = "rarity";
    showScreen("setup");
  }
  document.getElementById("restart-btn").addEventListener("click", restart);
  document.getElementById("header-restart-btn").addEventListener("click", restart);
}

init();
