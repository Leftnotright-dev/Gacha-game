/* =========================
   main.js (hardened version)
   ========================= */

let INDEX_VIEW = 'normal';        // 'normal' | 'shiny'
let indexDataCache = null;        // for index and rates
let metaChancesCache = null;
let backpackCache = [];           // client-side copy of pulls for filtering

// ---- Special description registry (fallback strings; server decides what to reveal) ----
const UNIT_SPECIAL_DESCRIPTIONS = {
  // Celestial
  "admin Zy": "Gamma Burst — AOE 220% ATK, apply DEF Down (-30%, 3t), apply Burn (5% of caster ATK, 4t), self +25% ATK (3t). CD 6.",
  "Alex": "Gluttony — For 2 waves: each attack deals +10% target max HP +15% current HP; heal self 50% of total damage. Wave-based cooldown.",
  // Secret
  "Ted": "Vanish — Become invincible (5t). Enemies you attack are slowed -50% SPD while Vanish lasts. CD 10.",
  // Mythical
  "Djzilla": "Alert — Provoke all enemies to target Djzilla, redirect AOE to self, -50% damage taken while active. CD 10.",
  "Deshun": "Pay to Win — Roll a die (1–6) for a random effect (stun all 6t / self +25% ATK 5t / DEF Down all 4t / self heal 30% max HP / invincible 2t / AOE 100% ATK). Once per wave.",
  "Zafuu": "Severe — 300% ATK to a selected target, apply Corrupt (disables specials) and Bleed (5% ATK, 2t). Once per wave.",
  "Channon": "Aura — Team +25% ATK (2t) and DEF Down all enemies (-30%, 2t). CD 5.",
  // Ultra
  "Snorlax": "Rest — Restore 100% HP to self; if already at full HP, heal the lowest-HP ally by 100% of Snorlax’s base HP. Then apply Sleep (same effect as Stun; bosses immune) to all enemies for 10 turns. Once per wave.",
  "Fatima Do": "Florish — Heal all allies for 50% of their max HP. CD 15.",
  "Boa": "Life — Revive a fallen ally at 50% max HP (or heal 50% if alive) and grant +100% ATK (5t). Once per stage.",
  "Grinch": "Something — (Passive) At 1 HP enter Bloodthirsty (can’t die, +25% ATK per turn up to +200%) for 10 turns, then heal 30% max HP. Once per stage.",
};

// server-owned specials cache (populated by /index_data)
window.__ownedSpecials = window.__ownedSpecials || {};

/* ---------------- Small helpers ---------------- */

const $ = (id) => document.getElementById(id);
const safeText = (n, txt) => { if (n) n.textContent = txt; };
const safeHTML = (n, html) => { if (n) n.innerHTML = html; };
const exists = (id) => Boolean($(id));
const displayOf = (el) => (el ? getComputedStyle(el).display : 'none');

function getUsername() {
  const input = $('username');
  return input ? (input.value || '').trim() : '';
}

function panelVisible(id) {
  const el = $(id);
  if (!el) return false;
  const inline = el.style && el.style.display;
  if (inline) return inline !== 'none';
  return displayOf(el) !== 'none';
}

function escapeHtml(unsafe) {
  return String(unsafe ?? '')
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ---------------- PULL (single & x10) + HISTORY ---------------- */

async function pullUnit() {
  const username = getUsername();
  if (!username) return alert("Please enter your username!");

  try {
    const resp = await fetch("/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const data = await resp.json();
    if (!resp.ok) return alert(data.error || "Pull failed");

    renderLatestResult(data);
    safeText($("gems"), `💎 ${data.gems_left}`);
    safeText($("index-count"), `${data.index_count} unique units`);

    await loadHistory();
    if (panelVisible("unitIndexPanel")) await loadUnitIndex(true); // refresh specials + grid
    if (panelVisible("backpackPanel")) renderBackpack();
  } catch (err) {
    console.error(err);
    alert("Network error while pulling. Make sure your server/ngrok is running.");
  }
}

async function pullTen() {
  const username = getUsername();
  if (!username) return alert("Please enter your username!");

  try {
    const resp = await fetch("/pull10", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const data = await resp.json();
    if (!resp.ok) return alert(data.error || "10x pull failed");

    // show quick summary
    const rarCount = {};
    (data.pulls || []).forEach(p => rarCount[p.rarity] = (rarCount[p.rarity] || 0) + 1);
    const summary = Object.keys(rarCount).map(k => `${k}×${rarCount[k]}`).join(", ");
    safeHTML($("result"), `Pulled 10: ${escapeHtml(summary)} • 💎 Left: ${data.gems_left}`);

    safeText($("gems"), `💎 ${data.gems_left}`);
    safeText($("index-count"), `${data.index_count} unique units`);

    await loadHistory();
    if (panelVisible("unitIndexPanel")) await loadUnitIndex(true); // refresh specials + grid
    if (panelVisible("backpackPanel")) renderBackpack();
  } catch (err) {
    console.error(err);
    alert("Network error while pulling x10. Make sure your server/ngrok is running.");
  }
}

async function loadHistory() {
  const username = getUsername();
  const gemsEl = $("gems");
  const historyEl = $("history");
  const indexCountEl = $("index-count");

  if (historyEl) historyEl.innerHTML = "";
  if (indexCountEl) indexCountEl.textContent = `0 unique units`;
  if (!username) { safeText(gemsEl, "💎 Gems: —"); return; }

  try {
    const resp = await fetch("/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const data = await resp.json();
    if (!resp.ok) { safeText(gemsEl, "💎 Gems: 0"); return; }

    safeText(gemsEl, `💎 ${data.gems}`);
    safeText(indexCountEl, `${(data.index || []).length} unique units`);

    // Save pulls into backpack cache
    backpackCache = data.pulls || [];

    // Render basic history (if the list exists)
    if (historyEl) {
      backpackCache.slice().reverse().forEach(pull => {
        const li = document.createElement("li");
        li.className = "pull-item";

        const nameSpan = document.createElement("span");
        nameSpan.innerHTML = styleUnitLabel(pull);

        const metaSpan = document.createElement("span");
        metaSpan.className = "pull-meta";
        metaSpan.textContent = pull.rarity;

        li.appendChild(nameSpan);
        li.appendChild(metaSpan);
        historyEl.appendChild(li);
      });
    }

    // If backpack panel is visible, render with filters
    if (panelVisible("backpackPanel")) renderBackpack();

  } catch (err) {
    console.error(err);
    safeText(gemsEl, "💎 Gems: —");
    alert("Network error loading history. Make sure your server/ngrok is running.");
  }
}

function styleUnitLabel(pull) {
  const label = escapeHtml(pull?.unit_label ?? pull?.unit_name ?? '');
  if (pull?.celestial) return `<span class="gold-glow">${label}</span> 🌟`;
  if (pull?.rarity === "Secret") return `<span class="mono-rainbow-text">${label}</span> 🖤`;
  if (pull?.shiny) return `<span class="rainbow-text">${label}</span> ✨`;
  return label;
}

function renderLatestResult(data) {
  const resultEl = $("result");
  if (!resultEl) return;
  resultEl.classList.remove("rainbow-text", "gold-glow", "mono-rainbow-text");
  const label = escapeHtml(data.unit);
  if (data.celestial) {
    resultEl.innerHTML = `<span class="gold-glow">${label}</span> 🌟`;
  } else if (data.rarity === "Secret") {
    resultEl.innerHTML = `<span class="mono-rainbow-text">${label}</span>`;
  } else if (data.shiny) {
    resultEl.innerHTML = `<span class="rainbow-text">${label}</span> ✨`;
  } else {
    resultEl.textContent = data.unit;
  }
}

/* ---------------- RATES (server-driven) ---------------- */

function toggleRates() {
  const container = $("ratesContainer");
  const btn = $("showRatesBtn");
  if (!container || !btn) return; // page might not have rates UI

  const isHidden = displayOf(container) === "none";
  container.style.display = isHidden ? "block" : "none";
  btn.textContent = isHidden ? "Hide Rates" : "Show Rates";

  if (isHidden) {
    if (metaChancesCache) {
      fillRates(metaChancesCache);
    } else {
      loadUnitIndex(true).then(() => {
        if (metaChancesCache) fillRates(metaChancesCache);
      });
    }
  }
}

function fillRates(chances) {
  const tbody = $("ratesTbody");
  if (!tbody || !chances) return;

  const order = ["Common","Rare","Ultra","Mythical","Secret","Celestial"];
  const shinyChance = indexDataCache?.shinyChance ?? (1/4000);
  const shinyEligible = new Set(["Common","Rare","Ultra","Mythical","Celestial"]);
  const badge = { "Common":"⚪","Rare":"🔷","Ultra":"🟣","Mythical":"🟠","Secret":"🖤","Celestial":"🌟" };

  tbody.innerHTML = "";

  order.forEach(r => {
    if (!(r in chances)) return;
    const baseP = chances[r];
    const basePct = baseP * 100;
    const shinyOk = shinyEligible.has(r);
    const shinyP = shinyOk ? baseP * shinyChance : 0;
    const shinyPct = shinyP * 100;

    const tr = document.createElement("tr");
    tr.className = `rarity-row-${r}`;

    const tdR = document.createElement("td");
    tdR.innerHTML = `<span class="rarity-badge">${badge[r] || ""} ${r}</span>`;

    const tdBpct = document.createElement("td"); tdBpct.className = "num"; tdBpct.textContent = basePct.toFixed(4) + "%";
    const tdB1in = document.createElement("td"); tdB1in.className = "num"; tdB1in.textContent = fmtOneIn(baseP);
    const tdSpct = document.createElement("td"); tdSpct.className = "num"; tdSpct.textContent = shinyOk ? shinyPct.toFixed(6) + "%" : "—";
    const tdS1in = document.createElement("td"); tdS1in.className = "num"; tdS1in.textContent = shinyOk ? fmtOneIn(shinyP) : "—";

    tr.appendChild(tdR); tr.appendChild(tdBpct); tr.appendChild(tdB1in); tr.appendChild(tdSpct); tr.appendChild(tdS1in);
    tbody.appendChild(tr);
  });
}

function fmtOneIn(p) {
  if (!p || p <= 0) return "—";
  const x = 1 / p;
  if (x >= 1000) return "1 in " + Math.round(x).toLocaleString();
  return "1 in " + Math.round(x);
}

/* ---------------- UNIT INDEX (grid + progress + "???" + specials) ---------------- */

function toggleIndex() {
  const panel = $("unitIndexPanel");
  const btn = $("toggleIndexBtn");
  if (!panel || !btn) return; // page might not have index UI

  const isHidden = displayOf(panel) === "none";
  panel.style.display = isHidden ? "block" : "none";
  btn.textContent = isHidden ? "Hide Index" : "Show Index";

  if (isHidden) {
    loadUnitIndex(); // fetch & render (also populates window.__ownedSpecials)
  }
}

function setIndexView(view) {
  INDEX_VIEW = view;
  const normalBtn = $("viewNormalBtn");
  const shinyBtn  = $("viewShinyBtn");

  if (normalBtn) normalBtn.classList.toggle("active", view === "normal");
  if (shinyBtn)  shinyBtn.classList.toggle("active", view === "shiny");

  if (indexDataCache) renderUnitIndex(indexDataCache);
}

async function loadUnitIndex(silent=false) {
  const username = getUsername();
  if (!username) { if (!silent) alert("Enter a username first"); return; }

  try {
    const resp = await fetch("/index_data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username })
    });
    const data = await resp.json();
    if (!resp.ok) { if (!silent) alert(data.error || "Failed to load index"); return; }
    indexDataCache = data;
    metaChancesCache = data.chances || null;

    // Cache server-gated descriptions of specials for OWNED units
    window.__ownedSpecials = data.specials || {};

    renderUnitIndex(data);
  } catch (e) {
    console.error(e);
    if (!silent) alert("Network error while loading index");
  }
}

const rarityBarColor = {
  "Common":   "#9db0c6",
  "Rare":     "#6aa8ff",
  "Ultra":    "#b27bff",
  "Mythical": "#ff7bd7",
  "Secret":   "#000000",
  "Celestial":"#ffd700"
};

function renderUnitIndex(data) {
  const wrapper = $("unitIndex");
  const summary = $("indexSummary");
  if (!wrapper || !summary) return;

  // Clear previous render to avoid duplication
  wrapper.innerHTML = "";
  summary.innerHTML = "";

  const order = data.order || Object.keys(data.rarities);

  // overall totals for current view
  let overallOwned = 0, overallTotal = 0;
  const perRarityCounts = [];

  order.forEach(rarity => {
    const list = data.rarities[rarity] || [];
    const total = list.length;
    const ownedCount = list.reduce((acc, u) => {
      const owned = (INDEX_VIEW === "shiny") ? u.owned_shiny : u.owned_normal;
      return acc + (owned ? 1 : 0);
    }, 0);
    perRarityCounts.push({ rarity, total, owned: ownedCount });
    overallOwned += ownedCount; overallTotal += total;
  });

  // summary
  const overallPct = overallTotal ? Math.round((overallOwned / overallTotal) * 100) : 0;
  const overallChip = document.createElement("div");
  overallChip.className = "chip";
  overallChip.textContent = `Overall: ${overallOwned} / ${overallTotal} (${overallPct}%)`;
  summary.appendChild(overallChip);

  const overallBarWrap = document.createElement("div");
  overallBarWrap.className = "summary-bar";
  const overallBar = document.createElement("div");
  overallBar.className = "bar";
  overallBar.style.width = `${overallPct}%`;
  overallBarWrap.appendChild(overallBar);
  summary.appendChild(overallBarWrap);

  perRarityCounts.forEach(({rarity, total, owned}) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = `${rarity}: ${owned}/${total}`;
    summary.appendChild(chip);
  });

  // sections
  order.forEach(rarity => {
    const list = data.rarities[rarity] || [];

    const total = list.length;
    const ownedCount = list.reduce((acc, u) => (acc + ((INDEX_VIEW === "shiny") ? (u.owned_shiny ? 1 : 0) : (u.owned_normal ? 1 : 0))), 0);
    const pct = total ? Math.round((ownedCount / total) * 100) : 0;

    const sec = document.createElement("div");
    sec.className = "rarity-section";

    const header = document.createElement("div");
    header.className = "rarity-header";

    const title = document.createElement("h3");
    title.className = "rarity-title";
    title.textContent = rarity;

    const progWrap = document.createElement("div");
    progWrap.className = "progress-wrap";
    const prog = document.createElement("div");
    prog.className = "progress";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${pct}%`;
    bar.style.background = rarityBarColor[rarity] || "#32d27a";
    prog.appendChild(bar);

    const progLabel = document.createElement("div");
    progLabel.className = "progress-label";
    progLabel.textContent = `${ownedCount} / ${total}`;

    progWrap.appendChild(prog); progWrap.appendChild(progLabel);
    header.appendChild(title); header.appendChild(progWrap);
    sec.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "unit-grid";

    list.forEach(u => {
      const badge = document.createElement("div");
      badge.className = "unit-badge";

      const span = document.createElement("span");
      span.className = "tiny";

      // Unknown if never summoned in ANY form
      const isUnknown = !u.owned;
      if (isUnknown) {
        badge.classList.add("unknown");
        span.textContent = "???";
        badge.title = "Unknown (not discovered)";
      } else {
        if (u.owned) badge.classList.add("owned");
        if (u.owned_shiny) badge.classList.add("shiny");
        span.textContent = initials(u.name);

        // Use server-approved specials first, fallback to local text
        const desc =
          (window.__ownedSpecials && window.__ownedSpecials[u.name]) ||
          (UNIT_SPECIAL_DESCRIPTIONS && UNIT_SPECIAL_DESCRIPTIONS[u.name]);

        if (desc) {
          badge.title = `${u.name} — ${desc}`;
          const info = document.createElement("span");
          info.className = "corner";
          info.textContent = "ℹ️";
          info.style.fontSize = "13px";
          badge.appendChild(info);
        } else {
          badge.title = u.name;
        }

        // corner markers (only for known units)
        if (rarity === "Celestial") {
          const star = document.createElement("span");
          star.className = "corner gold-glow";
          star.textContent = "★";
          badge.appendChild(star);
        } else if (u.owned_shiny) {
          const spark = document.createElement("span");
          spark.className = "corner";
          spark.innerHTML = `<span class="rainbow-text">✦</span>`;
          badge.appendChild(spark);
        }
      }

      // Greyscale based on the current view’s ownership
      const showOwnedInView = (INDEX_VIEW === "shiny") ? u.owned_shiny : u.owned_normal;
      if (!showOwnedInView) {
        badge.style.filter = "grayscale(100%) brightness(0.9)";
        badge.style.opacity = "0.6";
      }

      if (!isUnknown && !badge.title) {
        badge.title = `${u.name}`;
      }

      badge.appendChild(span);
      grid.appendChild(badge);
    });

    sec.appendChild(grid);
    wrapper.appendChild(sec);
  });
}

function initials(name) {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* ---------------- BACKPACK (filterable + group duplicates) ---------------- */

function toggleBackpack() {
  const panel = $("backpackPanel");
  const btn = $("toggleBackpackBtn");
  if (!panel || !btn) return; // safety

  const isHidden = displayOf(panel) === "none";
  panel.style.display = isHidden ? "block" : "none";
  btn.textContent = isHidden ? "Hide Backpack" : "Show Backpack";

  if (isHidden) {
    try { renderBackpack(); } catch (e) { console.error("renderBackpack error:", e); }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const panel = $("backpackPanel");
  if (panel) panel.style.display = "none"; // ensure initial
});

function renderBackpack() {
  const listEl   = $("bpList");
  const rarityEl = $("bpRarity");
  const shinyEl  = $("bpShinyOnly");
  const groupEl  = $("bpGroup");
  const searchEl = $("bpSearch");

  if (!listEl || !rarityEl || !shinyEl || !searchEl) return;

  listEl.innerHTML = "";
  if (!Array.isArray(backpackCache)) return;

  const raritySel  = (rarityEl.value || "All");
  const shinyOnly  = !!shinyEl.checked;
  const groupDupes = groupEl ? !!groupEl.checked : false;
  const q          = (searchEl.value || "").toLowerCase().trim();

  const rarityEmoji = { "Common":"⚪","Rare":"🔷","Ultra":"🟣","Mythical":"🟠","Secret":"🖤","Celestial":"🌟" };

  // 1) Filter first
  const filtered = backpackCache.filter(p => {
    if (raritySel !== "All" && p.rarity !== raritySel) return false;
    if (shinyOnly && !p.shiny && !p.celestial) return false; // celestial can be shiny; gold overrides UI
    if (q && !String(p.unit_label).toLowerCase().includes(q)) return false;
    return true;
  });

  if (!groupDupes) {
    // No grouping: render each item
    filtered.slice().reverse().forEach(p => {
      const li = document.createElement("li");
      li.className = "bp-item";

      const left = document.createElement("div");
      left.className = "bp-left";

      const emoji = document.createElement("span");
      emoji.className = "bp-emoji";
      emoji.textContent = rarityEmoji[p.rarity] || "•";

      const name = document.createElement("span");
      name.innerHTML = styleUnitLabel(p);

      const tags = document.createElement("span");
      tags.className = "tag";
      tags.textContent = p.rarity + (p.shiny ? " • Shiny" : "");

      left.appendChild(emoji);
      left.appendChild(name);
      li.appendChild(left);
      li.appendChild(tags);
      listEl.appendChild(li);
    });
    return;
  }

  // Grouping: (unit_label, rarity, shiny, celestial)
  const groups = new Map();
  for (const p of filtered) {
    const key = JSON.stringify({
      unit_label: p.unit_label,
      rarity: p.rarity,
      shiny: !!p.shiny,
      celestial: !!p.celestial
    });
    const g = groups.get(key) || { exemplar: p, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }

  // Sort by rarity importance, then count desc, then name
  const rarityOrder = { "Celestial": 6, "Secret": 5, "Mythical": 4, "Ultra": 3, "Rare": 2, "Common": 1 };
  const rows = Array.from(groups.values()).sort((a, b) => {
    const ra = rarityOrder[a.exemplar.rarity] || 0;
    const rb = rarityOrder[b.exemplar.rarity] || 0;
    if (rb !== ra) return rb - ra;
    if (b.count !== a.count) return b.count - a.count;
    return String(a.exemplar.unit_label).localeCompare(String(b.exemplar.unit_label));
  });

  rows.forEach(({ exemplar, count }) => {
    const li = document.createElement("li");
    li.className = "bp-item";

    const left = document.createElement("div");
    left.className = "bp-left";

    const emoji = document.createElement("span");
    emoji.className = "bp-emoji";
    emoji.textContent = rarityEmoji[exemplar.rarity] || "•";

    const name = document.createElement("span");
    name.innerHTML = `${styleUnitLabel(exemplar)} <span style="opacity:.7">×${count}</span>`;

    const tags = document.createElement("span");
    tags.className = "tag";
    tags.textContent = exemplar.rarity + (exemplar.shiny ? " • Shiny" : "");

    left.appendChild(emoji);
    left.appendChild(name);
    li.appendChild(left);
    li.appendChild(tags);
    listEl.appendChild(li);
  });
}

/* ---------- Tiny bootstrap so pages “just work” ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // Fill username from localStorage if present (helps when reloading)
  const u = $('username');
  if (u && !u.value) {
    const saved = localStorage.getItem('swca_username') || '';
    if (saved) u.value = saved;
  }
  // Auto-load history/gems on pages that have the UI
  if ($('history') || $('gems')) {
    try { loadHistory(); } catch (e) { console.warn('loadHistory failed:', e); }
  }
});

/* expose pulls for inline buttons if needed */
window.pullUnit = pullUnit;
window.pullTen = pullTen;
window.toggleRates = toggleRates;
window.toggleIndex = toggleIndex;
window.setIndexView = setIndexView;
