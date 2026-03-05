"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* =========================
   PERMISSIONS
========================= */
const ADMIN_NAMES = new Set(["zach", "zach petersen", "pete"]);

/* =========================
   THEME
========================= */
const THEME = {
  green: "#205A28",
  greenDark: "#18451F",
  greenBright: "#2F7A38",
  red: "#C72B32",
  white: "#FFFFFF",
};

/* =========================
   CONFIG: ESPN SCORING + GRAND PRIZES
========================= */
const ESPN_POINTS = {
  "Round 1": 10,
  "Round 2": 20,
  "Sweet Sixteen": 40,
  "Elite 8": 80,
  "Final Four": 160,
  Final: 320,
};

const GRAND_PRIZES = { first: 500, second: 200 };

/* =========================
   TOURNAMENT STRUCTURE
========================= */
const REGIONS = ["East", "West", "South", "Midwest"];
const R1_PAIRINGS = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

const ROUND_ORDER = {
  "Round 1": 1,
  "Round 2": 2,
  "Sweet Sixteen": 3,
  "Elite 8": 4,
  "Final Four": 5,
  Final: 6,
};

const ROUND_LIST = ["Round 1", "Round 2", "Sweet Sixteen", "Elite 8", "Final Four", "Final"];

/* =========================
   SIDE BETS (6 TOTAL — 1 PER ROUND)
========================= */
const SIDE_BETS = [
  {
    id: 1,
    title: "Round 1 – Most Upsets Correctly Picked",
    round: "Round 1",
    prize: 100,
    desc: "Any lower seed that beats a higher seed is an upset. Most correctly picked upsets wins.",
  },
  {
    id: 2,
    title: "Round 2 – Most Wins Correctly Picked",
    round: "Round 2",
    prize: 50,
    desc: "Most correct picks in Round 2 (wins only).",
  },
  {
    id: 3,
    title: "Sweet Sixteen – Win + Upset Points",
    round: "Sweet Sixteen",
    prize: 25,
    desc: "Win = 1 point. Upset = 2 points. Most points wins.",
  },

  // ✅ last 3 unchanged (as you requested)
  {
    id: 6,
    title: "Elite Eight – Closest Combined Seed Total (Final Four seeds)",
    round: "Elite 8",
    prize: 50,
    desc: "Closest predicted final four seed sum wins. Even if all of your team are eliminated, the seed sum goes off of your original predictions.",
  },
  {
    id: 7,
    title: "Final Four – Championship Teams Picked",
    prize: 100,
    gameIds: [61, 62],
    desc: "Each correctly picked championship team = +1 point. Bonus: +3 if only you picked the team, +2 if 2–3 people picked the team, +1 if 4–6 people picked the team, +0 if 7+ people picked the team. If no one correctly picks either team it is a tie among all.",
  },
  {
    id: 8,
    title: "Final – Most Wins Overall",
    round: "Final",
    prize: 150,
    desc: "Most wins throughout the entire tournament, not points.",
  },
];

/* =========================
   HELPERS
========================= */
function dollars(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}
function safeLower(x) {
  return String(x ?? "").trim().toLowerCase();
}
function normalizeNameMatch(inputName, candidates) {
  const t = safeLower(inputName);
  if (!t) return "";
  const exact = (candidates || []).find((c) => safeLower(c) === t);
  return exact || "";
}
function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function sourceLabel(gameId) {
  return `Game ${gameId}`;
}
function matchupLabel(g) {
  const t1 = g.teams?.[0];
  const t2 = g.teams?.[1];

  const isTBD1 = !t1?.name || t1.name === "TBD";
  const isTBD2 = !t2?.name || t2.name === "TBD";

  const left =
    isTBD1 && g.sources?.[0]
      ? `TBD (Winner of ${sourceLabel(g.sources[0])})`
      : `(${t1?.seed ?? "—"}) ${t1?.name ?? "TBD"}`;

  const right =
    isTBD2 && g.sources?.[1]
      ? `TBD (Winner of ${sourceLabel(g.sources[1])})`
      : `(${t2?.seed ?? "—"}) ${t2?.name ?? "TBD"}`;

  if (!isTBD1 && !isTBD2) return `(${t1.seed ?? "—"}) ${t1.name} vs (${t2.seed ?? "—"}) ${t2.name}`;
  return `${left} vs ${right}`;
}

/* =========================
   ADVANCED BOOST HELPERS + SIM
========================= */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function winProbForTeamA(teamA, teamB) {
  const aSeed = Number(teamA?.seed);
  const bSeed = Number(teamB?.seed);
  if (!Number.isFinite(aSeed) || !Number.isFinite(bSeed)) return 0.5;
  const favIsA = aSeed < bSeed;
  const diff = Math.abs(aSeed - bSeed);
  const pFav = clamp(0.5 + diff * 0.03, 0.55, 0.9);
  return favIsA ? pFav : 1 - pFav;
}

/* =========================
   CSV PARSERS
========================= */
function parseResultsCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = safeLower(lines[0]);
  const startIndex = first.includes("game") && first.includes("winner") ? 1 : 0;

  const updates = [];
  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    if (parts.length < 2) continue;
    const gameId = Number(parts[0]);
    const winnerName = parts.slice(1).join(",").trim();
    if (!Number.isFinite(gameId) || !winnerName) continue;
    updates.push({ gameId, winnerName });
  }
  return updates;
}
function parseBracketsCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = safeLower(lines[0]);
  const startIndex = first.includes("name") && first.includes("game") && first.includes("pick") ? 1 : 0;

  const rows = [];
  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    if (parts.length < 3) continue;

    const name = parts[0];
    const gameId = Number(parts[1]);
    const pickName = parts.slice(2).join(",").trim();
    if (!name || !Number.isFinite(gameId) || !pickName) continue;

    rows.push({ name, gameId, pickName });
  }
  return rows;
}
function parseSeedMapCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = safeLower(lines[0]);
  const startIndex = first.includes("region") && first.includes("seed") ? 1 : 0;

  const rows = [];
  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim());
    if (parts.length < 3) continue;
    const region = parts[0];
    const seed = Number(parts[1]);
    const teamName = parts.slice(2).join(",").trim();
    if (!region || !Number.isFinite(seed) || seed < 1 || seed > 16 || !teamName) continue;
    rows.push({ region, seed, teamName });
  }
  return rows;
}

/* =========================
   TOURNAMENT GENERATOR (63 games)
========================= */
function buildTournamentGames(seedTeamsByRegion) {
  let id = 1;
  const games = [];
  const regionElite8GameId = {};

  for (const region of REGIONS) {
    const seeds = seedTeamsByRegion?.[region] || {};
    const r1Ids = [];

    for (let i = 0; i < R1_PAIRINGS.length; i++) {
      const [a, b] = R1_PAIRINGS[i];
      const tA = seeds[a] ? { name: seeds[a], seed: a } : { name: "TBD", seed: a };
      const tB = seeds[b] ? { name: seeds[b], seed: b } : { name: "TBD", seed: b };

      games.push({
        id,
        day: 0,
        round: "Round 1",
        sources: null,
        slot: { region, label: `${region}-R1-${i + 1}` },
        espnGameId: "",
        teams: [tA, tB],
        winnerName: "",
      });
      r1Ids.push(id);
      id++;
    }

    const r2Ids = [];
    for (let i = 0; i < 4; i++) {
      const sA = r1Ids[i * 2];
      const sB = r1Ids[i * 2 + 1];
      games.push({
        id,
        day: 0,
        round: "Round 2",
        sources: [sA, sB],
        slot: { region, label: `${region}-R2-${i + 1}` },
        espnGameId: "",
        teams: [{ name: "TBD", seed: null }, { name: "TBD", seed: null }],
        winnerName: "",
      });
      r2Ids.push(id);
      id++;
    }

    const s16Ids = [];
    for (let i = 0; i < 2; i++) {
      const sA = r2Ids[i * 2];
      const sB = r2Ids[i * 2 + 1];
      games.push({
        id,
        day: 0,
        round: "Sweet Sixteen",
        sources: [sA, sB],
        slot: { region, label: `${region}-S16-${i + 1}` },
        espnGameId: "",
        teams: [{ name: "TBD", seed: null }, { name: "TBD", seed: null }],
        winnerName: "",
      });
      s16Ids.push(id);
      id++;
    }

    const e8Id = id;
    games.push({
      id,
      day: 0,
      round: "Elite 8",
      sources: [s16Ids[0], s16Ids[1]],
      slot: { region, label: `${region}-E8` },
      espnGameId: "",
      teams: [{ name: "TBD", seed: null }, { name: "TBD", seed: null }],
      winnerName: "",
    });
    regionElite8GameId[region] = e8Id;
    id++;
  }

  const f4_1 = id;
  games.push({
    id,
    day: 0,
    round: "Final Four",
    sources: [regionElite8GameId["East"], regionElite8GameId["West"]],
    slot: { region: "Final Four", label: "F4-1" },
    espnGameId: "",
    teams: [{ name: "TBD", seed: null }, { name: "TBD", seed: null }],
    winnerName: "",
  });
  id++;

  const f4_2 = id;
  games.push({
    id,
    day: 0,
    round: "Final Four",
    sources: [regionElite8GameId["South"], regionElite8GameId["Midwest"]],
    slot: { region: "Final Four", label: "F4-2" },
    espnGameId: "",
    teams: [{ name: "TBD", seed: null }, { name: "TBD", seed: null }],
    winnerName: "",
  });
  id++;

  games.push({
    id,
    day: 0,
    round: "Final",
    sources: [f4_1, f4_2],
    slot: { region: "Final", label: "Final" },
    espnGameId: "",
    teams: [{ name: "TBD", seed: null }, { name: "TBD", seed: null }],
    winnerName: "",
  });

  const r1 = games.filter((g) => g.round === "Round 1").sort((a, b) => a.id - b.id);
  r1.forEach((g, idx) => (g.day = idx < 16 ? 1 : 2));

  const r2 = games.filter((g) => g.round === "Round 2").sort((a, b) => a.id - b.id);
  r2.forEach((g, idx) => (g.day = idx < 8 ? 3 : 4));

  games.filter((g) => g.round === "Sweet Sixteen").forEach((g) => (g.day = 5));
  games.filter((g) => g.round === "Elite 8").forEach((g) => (g.day = 6));
  games.filter((g) => g.round === "Final Four").forEach((g) => (g.day = 7));
  games.filter((g) => g.round === "Final").forEach((g) => (g.day = 8));

  return games.sort((a, b) => a.id - b.id);
}

function applySeedTeamsToRound1(games, seedTeamsByRegion) {
  return games.map((g) => {
    if (g.round !== "Round 1") return g;
    const region = g.slot?.region;
    const seeds = seedTeamsByRegion?.[region] || {};
    const t1 = g.teams?.[0];
    const t2 = g.teams?.[1];

    const nextT1 =
      t1?.seed && seeds[t1.seed]
        ? { name: seeds[t1.seed], seed: t1.seed }
        : { name: t1?.name ?? "TBD", seed: t1?.seed ?? null };

    const nextT2 =
      t2?.seed && seeds[t2.seed]
        ? { name: seeds[t2.seed], seed: t2.seed }
        : { name: t2?.name ?? "TBD", seed: t2?.seed ?? null };

    return { ...g, teams: [nextT1, nextT2] };
  });
}

function recomputeDerivedMatchups(games) {
  const byId = new Map(
    games.map((g) => [
      g.id,
      { ...g, teams: (g.teams || []).map((t) => ({ ...t })) },
    ])
  );

  const getWinnerTeam = (gameId) => {
    const g = byId.get(gameId);
    if (!g || !g.winnerName) return null;
    const t1 = g.teams?.[0];
    const t2 = g.teams?.[1];
    const winner = normalizeNameMatch(g.winnerName, [t1?.name, t2?.name]);
    if (!winner) return null;
    if (safeLower(winner) === safeLower(t1?.name)) return { name: t1.name, seed: t1.seed };
    if (safeLower(winner) === safeLower(t2?.name)) return { name: t2.name, seed: t2.seed };
    return null;
  };

  const ordered = Array.from(byId.values()).sort((a, b) => a.id - b.id);

  for (const g of ordered) {
    if (!g.sources || g.sources.length !== 2) continue;

    const a = getWinnerTeam(g.sources[0]);
    const b = getWinnerTeam(g.sources[1]);

    const nextTeam1 = a ? { name: a.name, seed: a.seed } : { name: "TBD", seed: null };
    const nextTeam2 = b ? { name: b.name, seed: b.seed } : { name: "TBD", seed: null };

    const prev1 = g.teams?.[0] || { name: "TBD", seed: null };
    const prev2 = g.teams?.[1] || { name: "TBD", seed: null };

    const changed =
      prev1.name !== nextTeam1.name ||
      prev1.seed !== nextTeam1.seed ||
      prev2.name !== nextTeam2.name ||
      prev2.seed !== nextTeam2.seed;

    if (changed) {
      g.teams = [nextTeam1, nextTeam2];
      if (g.winnerName) {
        const valid = normalizeNameMatch(g.winnerName, [g.teams[0]?.name, g.teams[1]?.name]);
        if (!valid) g.winnerName = "";
      }
      byId.set(g.id, g);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

function computePossibleTeamsByGame(games) {
  const map = new Map();
  const byId = new Map(games.map((g) => [g.id, g]));
  const ordered = games.slice().sort((a, b) => a.id - b.id);

  const teamsInGame = (g) => {
    const s = new Set();
    (g.teams || []).forEach((t) => {
      const nm = String(t?.name || "").trim();
      if (nm && nm !== "TBD") s.add(nm);
    });
    return s;
  };

  const possibleWinnersOf = (sourceId) => {
    const sg = byId.get(sourceId);
    if (!sg) return new Set();
    if (sg.winnerName) return new Set([sg.winnerName]);
    return map.get(sourceId) || new Set();
  };

  for (const g of ordered) {
    if (!g.sources) {
      map.set(g.id, teamsInGame(g));
      continue;
    }
    const a = possibleWinnersOf(g.sources[0]);
    const b = possibleWinnersOf(g.sources[1]);
    map.set(g.id, new Set([...a, ...b]));
  }

  return map;
}

function computeEliminatedTeams(games) {
  const eliminated = new Set();
  for (const g of games) {
    if (!g.winnerName) continue;
    const t1 = g.teams?.[0]?.name;
    const t2 = g.teams?.[1]?.name;
    if (!t1 || !t2 || t1 === "TBD" || t2 === "TBD") continue;
    const w = g.winnerName;
    if (safeLower(w) === safeLower(t1)) eliminated.add(t2);
    else if (safeLower(w) === safeLower(t2)) eliminated.add(t1);
  }
  return eliminated;
}

/* =========================
   UI COMPONENTS
========================= */
function Card({ title, subtitle, rightHeader, children }) {
  return (
    <div style={styles.card}>
      {(title || subtitle || rightHeader) && (
        <div style={styles.cardHeader}>
          <div>
            {title && <div style={styles.cardTitle}>{title}</div>}
            {subtitle && <div style={styles.cardSubtitle}>{subtitle}</div>}
          </div>
          {rightHeader ? <div style={{ marginLeft: "auto" }}>{rightHeader}</div> : null}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

function Pill({ children, tone = "neutral", onGreen = false }) {
    const style =
    tone === "green"
      ? onGreen
        ? styles.pillGreenOnGreen
        : styles.pillGreen
      : tone === "red"
      ? onGreen
        ? styles.pillRedOnGreen
        : styles.pillRed
      : tone === "blue"
      ? onGreen
        ? styles.pillBlueOnGreen
        : styles.pillBlue
      : tone === "yellow"
      ? styles.pillYellow
      : onGreen
      ? styles.pillOnGreen
      : styles.pill;

  return <span style={style}>{children}</span>;
}

function SmoothCollapse({ isOpen, children }) {
  return (
    <div
      style={{
        ...styles.collapse,
        maxHeight: isOpen ? 2400 : 0,
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? "translateY(0px)" : "translateY(-4px)",
        paddingTop: isOpen ? 10 : 0,
        paddingBottom: isOpen ? 12 : 0,
        borderTopWidth: isOpen ? 1 : 0,
      }}
      aria-hidden={!isOpen}
    >
      <div style={{ pointerEvents: isOpen ? "auto" : "none" }}>{children}</div>
    </div>
  );
}

/* =========================
   LOGO: SIMPLE GOLD "PP"
========================= */
function GoldenPP({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <linearGradient id="ppGoldA" x1="10" y1="10" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF7D6" />
          <stop offset="0.45" stopColor="#FBBF24" />
          <stop offset="1" stopColor="#B45309" />
        </linearGradient>
        <linearGradient id="ppGoldB" x1="56" y1="10" x2="10" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF7ED" />
          <stop offset="0.55" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#92400E" />
        </linearGradient>
        <filter id="ppShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="rgba(0,0,0,0.28)" />
        </filter>
      </defs>

      <g filter="url(#ppShadow)" transform="translate(0 1)">
        <path
          d="
            M12 50
            L20 50
            L20 38.2
            L31.5 38.2
            C38.5 38.2 43 33.9 43 27.9
            C43 21.9 38.5 18 31.5 18
            L12 18
            Z

            M20 31.8
            L31 31.8
            C34.2 31.8 36.4 30.1 36.4 27.9
            C36.4 25.7 34.2 24 31 24
            L20 24
            Z
          "
          fill="url(#ppGoldA)"
          fillRule="evenodd"
          clipRule="evenodd"
        />

        <path
          d="
            M34 50
            L42 50
            L42 38.2
            L53.5 38.2
            C60.5 38.2 64 33.9 64 27.9
            C64 21.9 60.5 18 53.5 18
            L34 18
            Z

            M42 31.8
            L53 31.8
            C56.2 31.8 58.4 30.1 58.4 27.9
            C58.4 25.7 56.2 24 53 24
            L42 24
            Z
          "
          fill="url(#ppGoldB)"
          fillRule="evenodd"
          clipRule="evenodd"
          opacity="0.98"
        />
      </g>
    </svg>
  );
}

/* =========================
   SEED HELPERS for Bet #6
========================= */
function seedForTeamInRegion(seedTeamsByRegion, region, teamName) {
  const nm = safeLower(teamName);
  if (!nm) return null;

  const seeds = seedTeamsByRegion?.[region] || {};
  for (const [seedStr, name] of Object.entries(seeds)) {
    if (safeLower(name) === nm) {
      const s = Number(seedStr);
      return Number.isFinite(s) ? s : null;
    }
  }
  return null;
}

function seedForPickInGame({ seedTeamsByRegion, game, pickName }) {
  const pick = String(pickName || "").trim();
  if (!pick) return null;

  const t1 = game?.teams?.[0];
  const t2 = game?.teams?.[1];
  const norm = normalizeNameMatch(pick, [t1?.name, t2?.name]);
  if (norm) {
    if (safeLower(norm) === safeLower(t1?.name)) return Number.isFinite(Number(t1?.seed)) ? Number(t1.seed) : null;
    if (safeLower(norm) === safeLower(t2?.name)) return Number.isFinite(Number(t2.seed)) ? Number(t2.seed) : null;
  }

  const region = game?.slot?.region;
  if (!region) return null;
  return seedForTeamInRegion(seedTeamsByRegion, region, pick);
}

function seedForWinnerInGame({ seedTeamsByRegion, game }) {
  if (!game?.winnerName) return null;
  return seedForPickInGame({ seedTeamsByRegion, game, pickName: game.winnerName });
}

/* =========================
   BRACKET MAP LAYOUT (IMPROVED)
========================= */
function buildBracketMapLayout({ games }) {
  const byId = new Map(games.map((g) => [g.id, g]));

  const BOX_W = 280;
  const BOX_H = 104;
  const COL_GAP = 96;
  const ROW_GAP = 16;
  const REGION_GAP = 68;

  const rounds = ["Round 1", "Round 2", "Sweet Sixteen", "Elite 8"];

  const gamePos = new Map();
  const nodes = [];
  const edges = [];

  const joinNodesByTarget = new Map();

  const addGameNode = (g, x, y) => {
    const rect = { x, y, w: BOX_W, h: BOX_H };
    nodes.push({ kind: "game", id: g.id, ...rect });
    gamePos.set(g.id, rect);
  };

  const ensureJoinNode = (targetId) => {
    if (joinNodesByTarget.has(targetId)) return joinNodesByTarget.get(targetId);
    const tgt = gamePos.get(targetId);
    if (!tgt) return null;

    const joinId = `join-${targetId}`;
    const jW = 14;
    const jH = 14;
    const jX = tgt.x - 34;
    const jY = tgt.y + tgt.h / 2 - jH / 2;

    const node = { kind: "join", id: joinId, x: jX, y: jY, w: jW, h: jH, joinForTarget: targetId };
    nodes.push(node);
    joinNodesByTarget.set(targetId, node);
    return node;
  };

  const rectCenterY = (r) => r.y + r.h / 2;

  const regionBuckets = {};
  for (const r of REGIONS) {
    regionBuckets[r] = { "Round 1": [], "Round 2": [], "Sweet Sixteen": [], "Elite 8": [] };
  }
  for (const g of games) {
    const r = g?.slot?.region;
    if (!REGIONS.includes(r)) continue;
    if (rounds.includes(g.round)) regionBuckets[r][g.round].push(g);
  }
  for (const r of REGIONS) {
    for (const rd of rounds) regionBuckets[r][rd].sort((a, b) => a.id - b.id);
  }

  const regionHeight = 8 * BOX_H + 7 * ROW_GAP;

  REGIONS.forEach((region, idx) => {
    const baseY = idx * (regionHeight + REGION_GAP) + 10;
    const baseX = 10;

    const xByRound = {
      "Round 1": baseX + 0 * (BOX_W + COL_GAP),
      "Round 2": baseX + 1 * (BOX_W + COL_GAP),
      "Sweet Sixteen": baseX + 2 * (BOX_W + COL_GAP),
      "Elite 8": baseX + 3 * (BOX_W + COL_GAP),
    };

    const r1 = regionBuckets[region]["Round 1"];
    r1.forEach((g, i) => {
      const y = baseY + i * (BOX_H + ROW_GAP);
      addGameNode(g, xByRound["Round 1"], y);
    });

    const placeRoundBySources = (roundName) => {
      const list = regionBuckets[region][roundName];
      list.forEach((g) => {
        const s = g.sources || [];
        const a = gamePos.get(s[0]);
        const b = gamePos.get(s[1]);
        const y = a && b ? (rectCenterY(a) + rectCenterY(b)) / 2 - BOX_H / 2 : baseY;
        addGameNode(g, xByRound[roundName], y);
      });
    };

    placeRoundBySources("Round 2");
    placeRoundBySources("Sweet Sixteen");
    placeRoundBySources("Elite 8");

    const allTargets = [
      ...regionBuckets[region]["Round 2"],
      ...regionBuckets[region]["Sweet Sixteen"],
      ...regionBuckets[region]["Elite 8"],
    ];
    for (const tgt of allTargets) {
      if (!Array.isArray(tgt.sources) || tgt.sources.length !== 2) continue;
      const join = ensureJoinNode(tgt.id);
      if (!join) continue;
      edges.push({ fromId: tgt.sources[0], toId: join.id });
      edges.push({ fromId: tgt.sources[1], toId: join.id });
      edges.push({ fromId: join.id, toId: tgt.id });
    }
  });

  const finalFour = games.filter((g) => g.round === "Final Four").sort((a, b) => a.id - b.id);
  const finalGame = games.find((g) => g.round === "Final");

  const regionsBlockHeight = REGIONS.length * regionHeight + (REGIONS.length - 1) * REGION_GAP + 20;
  const centerY = regionsBlockHeight / 2;

  const f4X = 10 + 4 * (BOX_W + COL_GAP) + 10;
  const f4Y1 = centerY - (BOX_H + 52);
  const f4Y2 = centerY + 52;

  if (finalFour[0]) addGameNode(finalFour[0], f4X, f4Y1);
  if (finalFour[1]) addGameNode(finalFour[1], f4X, f4Y2);

  const finalX = f4X + (BOX_W + COL_GAP);
  const finalY = centerY - BOX_H / 2;
  if (finalGame) addGameNode(finalGame, finalX, finalY);

  for (const f4 of finalFour) {
    if (!Array.isArray(f4.sources) || f4.sources.length !== 2) continue;
    const join = ensureJoinNode(f4.id);
    if (!join) continue;
    edges.push({ fromId: f4.sources[0], toId: join.id });
    edges.push({ fromId: f4.sources[1], toId: join.id });
    edges.push({ fromId: join.id, toId: f4.id });
  }

  if (finalGame && Array.isArray(finalGame.sources) && finalGame.sources.length === 2) {
    const join = ensureJoinNode(finalGame.id);
    if (join) {
      edges.push({ fromId: finalGame.sources[0], toId: join.id });
      edges.push({ fromId: finalGame.sources[1], toId: join.id });
      edges.push({ fromId: join.id, toId: finalGame.id });
    }
  }

  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const pad = 40;
  const width = maxX + pad;
  const height = maxY + pad;

  const rectFor = (idOrJoin) => {
    if (typeof idOrJoin === "string" && idOrJoin.startsWith("join-")) {
      return nodes.find((z) => z.id === idOrJoin) || null;
    }
    const gid = Number(idOrJoin);
    if (!Number.isFinite(gid)) return null;
    return gamePos.get(gid) || null;
  };

  const centerRight = (r) => ({ x: r.x + r.w, y: r.y + r.h / 2 });
  const centerLeft = (r) => ({ x: r.x, y: r.y + r.h / 2 });

  const segments = [];
  for (const e of edges) {
    const a = rectFor(e.fromId);
    const b = rectFor(e.toId);
    if (!a || !b) continue;

    const p1 = centerRight(a);
    const p4 = centerLeft(b);

    const midX = (p1.x + p4.x) / 2;
    const p2 = { x: midX, y: p1.y };
    const p3 = { x: midX, y: p4.y };

    segments.push([p1, p2, p3, p4]);
  }

  return { width, height, nodes, segments, byId };
}

/* =========================
   APP
========================= */
export default function Page() {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [activeTab, setActiveTab] = useState("sidebets");
  const [expandedBet, setExpandedBet] = useState(null);
const [hoveredBetId, setHoveredBetId] = useState(null);
 const [bracketViewMode, setBracketViewMode] = useState("map"); // map | game | team | player
  const [selectedGameId, setSelectedGameId] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
const [playerViewSelected, setPlayerViewSelected] = useState("");
  const [teamPageSearch, setTeamPageSearch] = useState("");
  const [teamPageSelected, setTeamPageSelected] = useState("");

  const [resultsMsg, setResultsMsg] = useState("");
  const [manualDay, setManualDay] = useState(1);
  const [manualResultsMsg, setManualResultsMsg] = useState("");
  const [bracketsMsg, setBracketsMsg] = useState("");
  const [seedMsg, setSeedMsg] = useState("");
  const [templateDay, setTemplateDay] = useState("ALL");
  const [exportMsg, setExportMsg] = useState("");
const [isDesktop, setIsDesktop] = useState(false);

useEffect(() => {
  const check = () => setIsDesktop(window.innerWidth >= 900);
  check();
  window.addEventListener("resize", check);
  return () => window.removeEventListener("resize", check);
}, []);
  const [seedTeamsByRegion, setSeedTeamsByRegion] = useState({
    East: {},
    West: {},
    South: {},
    Midwest: {},
  });

  const [games, setGames] = useState(() =>
    recomputeDerivedMatchups(buildTournamentGames({ East: {}, West: {}, South: {}, Midwest: {} }))
  );
  const [brackets, setBrackets] = useState([]);
  const [finalGameTotalPoints, setFinalGameTotalPoints] = useState("");

  // ORDER / SCHEDULE
  const [scheduleOrderByGameId, setScheduleOrderByGameId] = useState({});

  const [sharedLoaded, setSharedLoaded] = useState(false);
  const [sharedError, setSharedError] = useState("");
  const [sharedSaving, setSharedSaving] = useState(false);
  const [serverIsAdmin, setServerIsAdmin] = useState(false);

  // simulation
  const [simChaos, setSimChaos] = useState(0.22);
  const [simMsg, setSimMsg] = useState("");

  /* =========================
     AUTH
  ========================= */
  useEffect(() => {
    const raw = localStorage.getItem("mm_user");
    if (!raw) {
      setAuthChecked(true);
      router.replace("/login");
      return;
    }
    try {
      setCurrentUser(JSON.parse(raw));
    } catch {
      localStorage.removeItem("mm_user");
      router.replace("/login");
    } finally {
      setAuthChecked(true);
    }
  }, [router]);

  const isAdmin = useMemo(() => {
    const n = safeLower(currentUser?.name || "");
    return Boolean(serverIsAdmin || currentUser?.isAdmin || currentUser?.role === "admin" || ADMIN_NAMES.has(n));
  }, [serverIsAdmin, currentUser]);

  const readOnly = !isAdmin;

  const logout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    } catch {}
    localStorage.removeItem("mm_user");
    router.replace("/login");
  };

  /* =========================
     LOAD SHARED STATE ONCE
  ========================= */
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setSharedError("");
      try {
        const res = await fetch("/api/state", { cache: "no-store", credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to load /api/state");

        const st = data.state || {};
        if (cancelled) return;

        if (st.seedTeamsByRegion) setSeedTeamsByRegion(st.seedTeamsByRegion);
        if (Array.isArray(st.games)) setGames(recomputeDerivedMatchups(st.games));
        if (Array.isArray(st.brackets)) setBrackets(st.brackets);
        if (typeof st.finalGameTotalPoints === "string" || typeof st.finalGameTotalPoints === "number") {
          setFinalGameTotalPoints(String(st.finalGameTotalPoints ?? ""));
        }
        if (st.scheduleOrderByGameId && typeof st.scheduleOrderByGameId === "object") {
          setScheduleOrderByGameId(st.scheduleOrderByGameId);
        }

        setServerIsAdmin(Boolean(data?.isAdmin));
        setSharedLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setSharedError(e?.message || "Shared state load failed");
        setSharedLoaded(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /* =========================
     KEEP GAMES CONSISTENT WHEN SEEDS CHANGE
  ========================= */
  useEffect(() => {
    setGames((prev) => recomputeDerivedMatchups(applySeedTeamsToRound1(prev, seedTeamsByRegion)));
  }, [seedTeamsByRegion]);

  /* =========================
     AUTO-SAVE SHARED STATE (ADMIN ONLY, DEBOUNCED)
  ========================= */
  const saveTimerRef = useRef(null);
  const lastPayloadRef = useRef("");

  const sharedStatePayload = useMemo(() => {
    return { seedTeamsByRegion, games, brackets, finalGameTotalPoints, scheduleOrderByGameId };
  }, [seedTeamsByRegion, games, brackets, finalGameTotalPoints, scheduleOrderByGameId]);

  useEffect(() => {
    if (!sharedLoaded) return;
    if (readOnly) return;

    const payloadString = JSON.stringify(sharedStatePayload);
    if (payloadString === lastPayloadRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      setSharedSaving(true);
      setSharedError("");
      try {
        const res = await fetch("/api/state", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: sharedStatePayload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || "Save failed");

        lastPayloadRef.current = payloadString;
        setSharedError("");
      } catch (e) {
        setSharedError(e?.message || "Save failed");
      } finally {
        setSharedSaving(false);
      }
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sharedStatePayload, readOnly, sharedLoaded]);

  /* =========================
   DERIVED DATA
========================= */

// ORDER# helpers (order first)
function getOrderNum(gameId) {
  const raw = scheduleOrderByGameId?.[gameId];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function compareByOrderThenId(a, b) {
  const ao = getOrderNum(a?.id);
  const bo = getOrderNum(b?.id);

  if (ao != null && bo != null) return ao - bo || (a.id - b.id);
  if (ao != null) return -1;
  if (bo != null) return 1;

  return a.id - b.id;
}

// ✅ Single source of truth for “Day” based on Order# cutoffs
// If no Order# is set, fall back to g.day (assigned in buildTournamentGames)
function effectiveDayForGame(g) {
  const ord = getOrderNum(g?.id);

  if (ord == null) return Number(g?.day) || 1;

  // Common pattern:
  // 1–16  = Day 1 (Round 1)
  // 17–32 = Day 2 (Round 1)
  // 33–40 = Day 3 (Round 2)
  // 41–48 = Day 4 (Round 2)
  if (ord <= 16) return 1;
  if (ord <= 32) return 2;
  if (ord <= 40) return 3;
  if (ord <= 48) return 4;

  // Later rounds (or if you keep ordering past 48)
  return Number(g?.day) || 1;
}

const gamesById = useMemo(() => Object.fromEntries(games.map((g) => [g.id, g])), [games]);

const uniqueDays = useMemo(() => {
  const set = new Set();
  for (const g of games) set.add(effectiveDayForGame(g));
  return Array.from(set).filter(Number.isFinite).sort((a, b) => a - b);
}, [games, scheduleOrderByGameId]);

const manualDayGames = useMemo(() => {
  const d = Number(manualDay);
  if (!Number.isFinite(d)) return [];
  return games
    .filter((g) => effectiveDayForGame(g) === d)
    .slice()
    .sort(compareByOrderThenId);
}, [games, manualDay, scheduleOrderByGameId]);
const playerList = useMemo(
  () => brackets.slice().map((b) => b.name).sort((a, b) => a.localeCompare(b)),
  [brackets]
);

useEffect(() => {
  if (!playerViewSelected && playerList.length) setPlayerViewSelected(playerList[0]);
}, [playerViewSelected, playerList]);
// ORDER# helpers (order first)


  const getTeam = (g, idx) => g.teams?.[idx] || { name: "TBD", seed: null };

  const getWinnerTeamObj = (g) => {
    if (!g.winnerName) return null;
    const t1 = getTeam(g, 0);
    const t2 = getTeam(g, 1);
    const w = normalizeNameMatch(g.winnerName, [t1.name, t2.name]);
    if (!w) return null;
    if (safeLower(w) === safeLower(t1.name)) return t1;
    if (safeLower(w) === safeLower(t2.name)) return t2;
    return null;
  };

  const getLoserTeamObj = (g) => {
    const w = getWinnerTeamObj(g);
    if (!w) return null;
    const t1 = getTeam(g, 0);
    const t2 = getTeam(g, 1);
    if (safeLower(w.name) === safeLower(t1.name)) return t2;
    return t1;
  };

  const isUpset = (g) => {
    const w = getWinnerTeamObj(g);
    const l = getLoserTeamObj(g);
    if (!w || !l) return false;
    if (w.seed == null || l.seed == null) return false;
    return Number(w.seed) > Number(l.seed);
  };

  const eliminatedTeams = useMemo(() => computeEliminatedTeams(games), [games]);
  const possibleTeamsByGame = useMemo(() => computePossibleTeamsByGame(games), [games]);
  useEffect(() => {
    // default manualDay to the first tournament day available
    if (!uniqueDays.length) return;
    if (!uniqueDays.includes(Number(manualDay))) setManualDay(uniqueDays[0]);
  }, [uniqueDays, manualDay]);
  const boostDay = useMemo(() => {
    const pendingDays = uniqueDays.filter((d) => games.some((g) => effectiveDayForGame(g) === d && !g.winnerName));
    if (pendingDays.length) return pendingDays[0];
    return uniqueDays.length ? uniqueDays[uniqueDays.length - 1] : 1;
  }, [uniqueDays, games]);

  const teamsPlayingThatDay = useMemo(() => {
    const set = new Set();
    for (const g of games) {
      if (effectiveDayForGame(g) !== boostDay) continue;
      if (g.winnerName) continue;
      const t1 = g.teams?.[0]?.name;
      const t2 = g.teams?.[1]?.name;
      if (!t1 || !t2 || t1 === "TBD" || t2 === "TBD") continue;
      set.add(t1);
      set.add(t2);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games, boostDay]);

  const pointsByPlayer = useMemo(() => {
    const points = {};
    brackets.forEach((b) => (points[b.name] = 0));

    for (const g of games) {
      if (!g.winnerName) continue;
      const pts = ESPN_POINTS[g.round] ?? 0;
      for (const b of brackets) {
        const pick = safeLower(b.picks?.[g.id] || "");
        if (pick && pick === safeLower(g.winnerName)) points[b.name] += pts;
      }
    }
    return points;
  }, [games, brackets]);

  const remainingPotentialByPlayer = useMemo(() => {
    const out = {};
    for (const b of brackets) out[b.name] = 0;

    for (const g of games) {
      if (g.winnerName) continue;
      const pts = ESPN_POINTS[g.round] ?? 0;
      const possible = possibleTeamsByGame.get(g.id) || new Set();

      for (const b of brackets) {
        const pick = String(b.picks?.[g.id] ?? "").trim();
        if (!pick || pick === "TBD") continue;
        if (eliminatedTeams.has(pick)) continue;
        if (!possible.has(pick)) continue;
        out[b.name] += pts;
      }
    }
    return out;
  }, [games, brackets, possibleTeamsByGame, eliminatedTeams]);

  const [biggestBoostByPlayer, setBiggestBoostByPlayer] = useState({});
  useEffect(() => {
    if (!mounted) return;

    const dayGames = games
      .filter((g) => effectiveDayForGame(g) === boostDay && !g.winnerName)
      .filter((g) => {
        const t1 = g.teams?.[0]?.name;
        const t2 = g.teams?.[1]?.name;
        return t1 && t2 && t1 !== "TBD" && t2 !== "TBD";
      })
      .sort(compareByOrderThenId);

    const empty = {};
    for (const b of brackets) empty[b.name] = "";
    if (!dayGames.length) {
      setBiggestBoostByPlayer(empty);
      return;
    }

    const currentPts = {};
    for (const b of brackets) currentPts[b.name] = pointsByPlayer[b.name] ?? 0;

    const candidates = teamsPlayingThatDay.filter((t) => !eliminatedTeams.has(t));
    if (!candidates.length) {
      setBiggestBoostByPlayer(empty);
      return;
    }

    function estimateLeadProbability(forcedLossTeamName) {
      const forced = String(forcedLossTeamName || "").trim();
      const forcedLower = safeLower(forced);

      const ITER = 800;
      const rng =
        mulberry32(
          1337 +
            boostDay * 97 +
            (forcedLower ? forcedLower.length * 31 : 0) +
            (forcedLower ? forcedLower.charCodeAt(0) || 0 : 0)
        );

      const winShares = {};
      for (const b of brackets) winShares[b.name] = 0;

      for (let it = 0; it < ITER; it++) {
        const add = {};
        for (const b of brackets) add[b.name] = 0;

        for (const g of dayGames) {
          const tA = g.teams?.[0];
          const tB = g.teams?.[1];
          const aName = tA?.name;
          const bName = tB?.name;
          const pts = ESPN_POINTS[g.round] ?? 0;

          let winnerName = "";

          if (forcedLower && (safeLower(aName) === forcedLower || safeLower(bName) === forcedLower)) {
            winnerName = safeLower(aName) === forcedLower ? bName : aName;
          } else {
            const pA = winProbForTeamA(tA, tB);
            winnerName = rng() < pA ? aName : bName;
          }

          for (const b of brackets) {
            const pick = String(b.picks?.[g.id] ?? "").trim();
            if (!pick) continue;
            if (safeLower(pick) === safeLower(winnerName)) add[b.name] += pts;
          }
        }

        let max = -Infinity;
        const totals = {};
        for (const b of brackets) {
          const total = (currentPts[b.name] ?? 0) + (add[b.name] ?? 0);
          totals[b.name] = total;
          if (total > max) max = total;
        }

        const leaders = brackets.filter((b) => totals[b.name] === max).map((b) => b.name);
        const share = leaders.length ? 1 / leaders.length : 0;
        for (const nm of leaders) winShares[nm] += share;
      }

      const probs = {};
      for (const b of brackets) probs[b.name] = winShares[b.name] / ITER;
      return probs;
    }

    const baselineProbs = estimateLeadProbability("");
    const forcedProbsByTeam = {};
    for (const team of candidates) forcedProbsByTeam[team] = estimateLeadProbability(team);

    const rows = {};
    for (const me of brackets) {
      const base = baselineProbs[me.name] ?? 0;

      let bestTeam = "";
      let bestDelta = 0;

      for (const team of candidates) {
        const p = forcedProbsByTeam[team]?.[me.name] ?? 0;
        const delta = p - base;
        if (delta > bestDelta) {
          bestDelta = delta;
          bestTeam = team;
        }
      }

      if (!bestTeam || bestDelta <= 0.0005) rows[me.name] = "";
      else rows[me.name] = `If ${bestTeam} loses (+${(bestDelta * 100).toFixed(1)}%)`;
    }

    setBiggestBoostByPlayer(rows);
  }, [mounted, games, boostDay, brackets, pointsByPlayer, teamsPlayingThatDay, eliminatedTeams, scheduleOrderByGameId]);

  const pointsLeaderboard = useMemo(() => {
    return brackets
      .map((b) => {
        const points = pointsByPlayer[b.name] ?? 0;
        const remain = remainingPotentialByPlayer[b.name] ?? 0;
        const boost = biggestBoostByPlayer[b.name] ?? "";
        return { name: b.name, points, remain, boost };
      })
      .sort((a, b) => b.points - a.points);
  }, [brackets, pointsByPlayer, remainingPotentialByPlayer, biggestBoostByPlayer]);

  const resolved = Number.isFinite(Number(finalGameTotalPoints));

  const grandPrizeMoneyByPlayer = useMemo(() => {
    const payouts = {};
    brackets.forEach((b) => (payouts[b.name] = 0));
    if (!pointsLeaderboard.length) return payouts;

    const actual = Number(finalGameTotalPoints);
    const hasActual = Number.isFinite(actual);

    const sorted = pointsLeaderboard.map((r) => ({ name: r.name, points: r.points })).slice();
    sorted.sort((a, b) => b.points - a.points);

    const topPts = sorted[0].points;
    const topGroup = sorted.filter((r) => r.points === topPts);

    const tieBreakSort = (rows) => {
      if (!hasActual) return rows;
      return rows
        .slice()
        .sort((a, b) => {
          const aGuess = Number(brackets.find((x) => x.name === a.name)?.tiebreaker);
          const bGuess = Number(brackets.find((x) => x.name === b.name)?.tiebreaker);
          const aDiff = Number.isFinite(aGuess) ? Math.abs(aGuess - actual) : Number.POSITIVE_INFINITY;
          const bDiff = Number.isFinite(bGuess) ? Math.abs(bGuess - actual) : Number.POSITIVE_INFINITY;
          if (aDiff !== bDiff) return aDiff - bDiff;
          return a.name.localeCompare(b.name);
        });
    };

    let firstName = null;
    if (topGroup.length === 1) firstName = topGroup[0].name;
    else {
      if (!hasActual) return payouts;
      firstName = tieBreakSort(topGroup)[0].name;
    }
    payouts[firstName] += GRAND_PRIZES.first;

    const remaining = sorted.filter((r) => r.name !== firstName);
    if (!remaining.length) return payouts;

    const secondPts = remaining[0].points;
    const secondGroup = remaining.filter((r) => r.points === secondPts);

    let secondName = null;
    if (secondGroup.length === 1) secondName = secondGroup[0].name;
    else {
      if (!hasActual) return payouts;
      secondName = tieBreakSort(secondGroup)[0].name;
    }
    payouts[secondName] += GRAND_PRIZES.second;

    return payouts;
  }, [pointsLeaderboard, brackets, finalGameTotalPoints]);

  const sideBetComputed = useMemo(() => {
  const money = {};
  brackets.forEach((b) => (money[b.name] = 0));

  // helper: standardize standings objects for UI
  const packStandings = ({ rows, sortFn, metricLabel }) => {
    const sorted = rows.slice().sort(sortFn);
    return {
      standings: sorted.map((r, idx) => ({
        rank: idx + 1,
        name: r.name,
        primary: r.primary,
        secondary: r.secondary ?? null,
      })),
      metricLabel,
    };
  };

 const results = SIDE_BETS.map((bet) => {
  const betGames = (() => {
    // 1) Explicit gameIds always wins
    if (Array.isArray(bet.gameIds) && bet.gameIds.length) {
      const idSet = new Set(bet.gameIds.map((x) => Number(x)).filter(Number.isFinite));
      return games
        .filter((g) => idSet.has(Number(g.id)))
        .slice()
        .sort(compareByOrderThenId);
    }

    // 2) Otherwise: round-based (your new model)
    if (bet.round) {
      // Special case: Final bet (#8) is "Most Wins Overall" and should include all games
      if (bet.id === 8) return games.slice().sort(compareByOrderThenId);

      return games
        .filter((g) => String(g.round) === String(bet.round))
        .slice()
        .sort(compareByOrderThenId);
    }

    return [];
  })();

  // ... keep the rest of your bet logic below unchanged
// =========================
// BET #7 — FINAL FOUR UNIQUENESS (2 semifinal games only)
// =========================
if (bet.id === 7) {
  // Identify the 2 semifinal games.
  // Best: set bet.gameIds = [<semi1GameId>, <semi2GameId>] in SIDE_BETS.
  // Fallback: infer from round label.
  const semifinalGames = (() => {
    if (Array.isArray(bet.gameIds) && bet.gameIds.length) {
      const idSet = new Set(bet.gameIds.map((x) => Number(x)).filter(Number.isFinite));
      return games
        .filter((g) => idSet.has(Number(g.id)))
        .slice()
        .sort(compareByOrderThenId);
    }

    // Fallback inference by round name
    const semis = games.filter((g) => safeLower(String(g?.round || "")).includes("final four"));
    return semis.slice().sort(compareByOrderThenId);
  })().slice(0, 2); // ensure we only use two games

  // Helper: does bracket pick match winner for this game?
  const didPickWinner = (bracket, g) => {
    const winner = String(g?.winnerName || "").trim();
    if (!winner) return false;

    const t1 = String(g?.teams?.[0]?.name || "").trim();
    const t2 = String(g?.teams?.[1]?.name || "").trim();
    const candidates = [t1, t2].filter((x) => x && x !== "TBD");

    const winnerNorm = candidates.length ? normalizeNameMatch(winner, candidates) : winner;

    const pickRaw = String(bracket?.picks?.[g.id] ?? "").trim();
    if (!pickRaw || pickRaw === "TBD") return false;

    const pickNorm = candidates.length ? normalizeNameMatch(pickRaw, candidates) : pickRaw;
    if (!pickNorm) return false;

    return safeLower(pickNorm) === safeLower(winnerNorm);
  };

  // Bonus table based on # of correct pickers for that semifinal winner
  const bonusForCorrectCount = (n) => {
    if (n === 1) return 3;
    if (n === 2 || n === 3) return 2;
    if (n >= 4 && n <= 6) return 1;
    return 0; // 7+
  };

  // For each semifinal, count how many people correctly picked that winner
  const correctCountsByGameId = {};
  for (const g of semifinalGames) {
    if (!g?.winnerName) continue; // unresolved => no count yet
    let count = 0;
    for (const b of brackets) if (didPickWinner(b, g)) count += 1;
    correctCountsByGameId[g.id] = count;
  }

  // Build scores
  const scores = brackets.map((b) => {
    let points = 0;
    const parts = [];

    for (const g of semifinalGames) {
      if (!g?.winnerName) {
        parts.push(`Game ${g.id}: pending`);
        continue;
      }

      const correctCount = Number(correctCountsByGameId[g.id] ?? 0);

      // If nobody got this semifinal winner, everyone gets 0 for this game
      if (correctCount === 0) {
        parts.push(`Game ${g.id}: 0 (nobody)`);
        continue;
      }

      const correct = didPickWinner(b, g);
      if (!correct) {
        parts.push(`Game ${g.id}: 0`);
        continue;
      }

      const base = 1;
      const bonus = bonusForCorrectCount(correctCount);
      points += base + bonus;

      parts.push(`Game ${g.id}: ${base + bonus} (1+${bonus}, n=${correctCount})`);
    }

    return { name: b.name, points, parts };
  });

  const semisResolved = semifinalGames.length === 2 && semifinalGames.every((g) => Boolean(g?.winnerName));
  const noOneCorrectEither =
    semisResolved && semifinalGames.every((g) => Number(correctCountsByGameId[g.id] ?? 0) === 0);

  const maxPoints = scores.length ? Math.max(...scores.map((s) => s.points)) : 0;

  let winners = [];
  if (noOneCorrectEither) {
    // Your requested scenario: full tie across everyone
    winners = brackets.map((b) => b.name).slice().sort((a, b) => a.localeCompare(b));
  } else if (maxPoints > 0) {
    winners = scores
      .filter((s) => s.points === maxPoints)
      .map((s) => s.name)
      .sort((a, b) => a.localeCompare(b));
  }

  const split = winners.length ? bet.prize / winners.length : 0;
  winners.forEach((w) => (money[w] += split));

  // ✅ Premium standings (uses your existing helper)
const { standings, metricLabel } = packStandings({
  rows: scores.map((s) => ({
    name: s.name,
    primary: s.points,
    secondary: s.parts?.length ? s.parts.join(" • ") : "",
  })),
  sortFn: (a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
  metricLabel: "Points",
});

  const hitLabel =
    semifinalGames.length < 2
      ? "Bet needs 2 Final Four semifinal games. Add bet.gameIds = [semi1, semi2] in SIDE_BETS."
      : "";

  const desc =
    "Each correctly picked championship team = +1 point. Bonus: +3 if only you picked the team, +2 if 2-3 people picked the team, +1 if 4-6 people picked the team, +0 if 7+ people picked the team. If no one correctly picks either team it is a tie among all.";

  return { ...bet, winners, split, hitLabel, standings, metricLabel, desc };
}
    // =========================
    // BET #3 (Win=1 / Upset=2)
    // =========================
    if (bet.id === 3) {
      const scores = brackets.map((p) => {
        let points = 0;
        let picksCounted = 0;

        for (const g of betGames) {
          if (!g.winnerName) continue;

          const pickRaw = String(p.picks?.[g.id] ?? "").trim();
          if (!pickRaw) continue;

          picksCounted++;

          if (safeLower(pickRaw) !== safeLower(g.winnerName)) continue;
          points += isUpset(g) ? 2 : 1;
        }

        return { name: p.name, points, picksCounted };
      });

      const max = scores.length ? Math.max(...scores.map((s) => s.points)) : 0;
      const winners = scores.filter((s) => s.points === max && max > 0).map((s) => s.name);

      const split = winners.length ? bet.prize / winners.length : 0;
      winners.forEach((w) => (money[w] += split));

 const totalPicksCounted = scores.reduce((sum, s) => sum + (s.picksCounted || 0), 0);

const hitLabel =
  totalPicksCounted === 0
    ? "No picks found for these gameIds (check uploaded bracket CSV includes Round 2 gameIds)."
    : ""; // keep empty so UI doesn't show scoring text
      // ✅ Premium standings (for every bet)
      const { standings, metricLabel } = packStandings({
        rows: scores.map((s) => ({
          name: s.name,
          primary: s.points,
          secondary: `${s.picksCounted} picked`,
        })),
        sortFn: (a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
        metricLabel: "Points",
      });

      return { ...bet, winners, split, hitLabel, standings, metricLabel };
    }

    // =========================
    // BET #6 (Seed total diff)
    // =========================
    if (bet.id === 6) {
      const complete = betGames.length > 0 && betGames.every((g) => Boolean(g.winnerName));
      if (!complete) {
        // still include standings shell (clean UI even before complete)
        const { standings, metricLabel } = packStandings({
          rows: brackets.map((p) => ({ name: p.name, primary: "—", secondary: "" })),
          sortFn: (a, b) => a.name.localeCompare(b.name),
          metricLabel: "Diff",
        });
        return { ...bet, winners: [], split: 0, hitLabel: "", standings, metricLabel };
      }

      const actualSum = betGames.reduce((sum, g) => {
        const s = seedForWinnerInGame({ seedTeamsByRegion, game: g });
        return sum + (Number.isFinite(s) ? s : 0);
      }, 0);

      const scores = brackets.map((p) => {
        const predSum = betGames.reduce((sum, g) => {
          const pick = p.picks?.[g.id];
          const s = seedForPickInGame({ seedTeamsByRegion, game: g, pickName: pick });
          return sum + (Number.isFinite(s) ? s : 0);
        }, 0);

        const diff = Math.abs(predSum - actualSum);
        return { name: p.name, predSum, diff };
      });

      const minDiff = scores.length ? Math.min(...scores.map((s) => s.diff)) : Infinity;
      const winners = scores.filter((s) => s.diff === minDiff).map((s) => s.name);

      const split = winners.length ? bet.prize / winners.length : 0;
      winners.forEach((w) => (money[w] += split));

      const hitLabel = `Actual Final Four seed total: ${actualSum}`;

      // ✅ Premium standings
      const { standings, metricLabel } = packStandings({
        rows: scores.map((s) => ({
          name: s.name,
          primary: s.diff,
          secondary: `pred ${s.predSum}`,
        })),
        sortFn: (a, b) => Number(a.primary) - Number(b.primary) || a.name.localeCompare(b.name),
        metricLabel: "Diff",
      });

      return { ...bet, winners, split, hitLabel, actualSum, standings, metricLabel };
    }
// =========================
// BET #7 — FINAL FOUR UNIQUENESS (2 semifinal games only)
// +1 for each correct semifinal winner
// Bonus by # of correct pickers for that winner:
// 1 => +3, 2–3 => +2, 4–6 => +1, 7+ => +0
// If nobody gets either winner (both games), full tie.
// =========================
if (bet.id === 7) {
  // We expect betGames to already be [61,62] from bet.gameIds
  const semifinalGames = betGames.slice(0, 2);

  // Helper: did this bracket pick the winner of game g?
  const didPickWinner = (bracket, g) => {
    const winner = String(g?.winnerName || "").trim();
    if (!winner) return false;

    const t1 = String(g?.teams?.[0]?.name || "").trim();
    const t2 = String(g?.teams?.[1]?.name || "").trim();
    const candidates = [t1, t2].filter((x) => x && x !== "TBD");

    const winnerNorm = candidates.length ? normalizeNameMatch(winner, candidates) : winner;

    const pickRaw = String(bracket?.picks?.[g.id] ?? "").trim();
    if (!pickRaw || pickRaw === "TBD") return false;

    const pickNorm = candidates.length ? normalizeNameMatch(pickRaw, candidates) : pickRaw;
    if (!pickNorm) return false;

    return safeLower(pickNorm) === safeLower(winnerNorm);
  };

  // Count correct pickers per semifinal winner
  const correctCountsByGameId = {};
  for (const g of semifinalGames) {
    if (!g?.winnerName) continue;
    let count = 0;
    for (const b of brackets) {
      if (didPickWinner(b, g)) count += 1;
    }
    correctCountsByGameId[g.id] = count;
  }

  // Bonus tier
  const bonusForCorrectCount = (n) => {
    if (n === 1) return 3;
    if (n === 2 || n === 3) return 2;
    if (n >= 4 && n <= 6) return 1;
    return 0; // 7+
  };

  // Build per-player scores
const scores = brackets.map((b) => {
  let points = 0;
  let correctTeams = 0;
  let bonusTotal = 0;

  for (const g of semifinalGames) {
    if (!g?.winnerName) continue;

    const correctCount = Number(correctCountsByGameId[g.id] ?? 0);
    if (correctCount === 0) continue;

    const correct = didPickWinner(b, g);
    if (!correct) continue;

    const base = 1;
    const bonus = bonusForCorrectCount(correctCount);

    points += base + bonus;
    correctTeams += 1;
    bonusTotal += bonus;
  }

  return { name: b.name, points, correctTeams, bonusTotal };
});

  // Premium standings (clean)
  const { standings, metricLabel } = packStandings({
    rows: scores.map((s) => ({
      name: s.name,
      primary: s.points,
      secondary:
        semifinalGames.length === 2
          ? `${s.correctTeams}/2 correct • +${s.bonusTotal} bonus`
          : `+${s.bonusTotal} bonus`,
    })),
    sortFn: (a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
    metricLabel: "Points",
  });

  // Winner logic
  const semisResolved = semifinalGames.length === 2 && semifinalGames.every((g) => Boolean(g?.winnerName));

  const noOneCorrectEither =
    semisResolved &&
    semifinalGames.every((g) => Number(correctCountsByGameId[g.id] ?? 0) === 0);

  const maxPoints = scores.length ? Math.max(...scores.map((s) => s.points)) : 0;

  let winners = [];
  if (noOneCorrectEither) {
    // Full tie: everyone wins
    winners = brackets.map((b) => b.name).slice().sort((a, b) => a.localeCompare(b));
  } else if (maxPoints > 0) {
    winners = scores
      .filter((s) => s.points === maxPoints)
      .map((s) => s.name)
      .sort((a, b) => a.localeCompare(b));
  }

  const split = winners.length ? bet.prize / winners.length : 0;
  winners.forEach((w) => (money[w] += split));

  const hitLabel = semisResolved
    ? noOneCorrectEither
      ? "Nobody correctly picked either championship team — full tie."
      : ""
    : "Scoring updates when Final Four winners are set.";

  const desc =
    "Each correctly picked championship teams = +1 point. Bonus: +3 if only you picked the team, +2 if 2-3 people picked the team, +1 if 4-6 people picked the team, +0 if 7+ people picked the team If no one correctly picks either team it is a tie among all.";

  return { ...bet, winners, split, hitLabel, standings, metricLabel, desc };
}
// =========================
// BET #8 — MOST WINS OVERALL (ALL GAMES, LIVE LEADER)
// =========================
if (bet.id === 8) {
  const allGames = games.slice().sort(compareByOrderThenId);

  const scores = brackets.map((p) => {
    let wins = 0;

    for (const g of allGames) {
      if (!g.winnerName) continue;

      const pickRaw = String(p.picks?.[g.id] ?? "").trim();
      if (!pickRaw) continue;

      if (safeLower(pickRaw) === safeLower(g.winnerName)) wins += 1;
    }

    return { name: p.name, wins };
  });

  const maxWins = scores.length ? Math.max(...scores.map((s) => s.wins)) : 0;

  // ✅ LIVE leaders (only if someone has > 0 wins)
  const winners =
    maxWins > 0
      ? scores.filter((s) => s.wins === maxWins).map((s) => s.name)
      : [];

  const split = winners.length ? bet.prize / winners.length : 0;

  // ✅ This is what makes the money "bounce" live:
  winners.forEach((w) => (money[w] += split));

  const decided = allGames.filter((g) => Boolean(g.winnerName)).length;
  const hitLabel = `Games decided: ${decided}/${allGames.length}`;

  const { standings, metricLabel } = packStandings({
    rows: scores.map((s) => ({
      name: s.name,
      primary: s.wins,
      secondary: "",
    })),
    sortFn: (a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
    metricLabel: "Wins",
  });

  return { ...bet, winners, split, hitLabel, standings, metricLabel };
}
    // =========================
    // LONGEST STREAK (your existing logic)
    // =========================
    const isLongestStreakBet = bet.round === "Round 2" && Number(bet.day) === 2;

    if ((bet.id === 4 || bet.id === 5) && isLongestStreakBet) {
      const rows = brackets.map((p) => {
  let streak = 0;
  let started = false;

  let startedAtGameId = null;
  let startedAtOrder = null;

  let status = "none"; // none | in_progress | ended_wrong | complete

  for (const g of betGames) {
    const pickRaw = String(p.picks?.[g.id] ?? "").trim();
    if (!pickRaw || pickRaw === "TBD") continue; // ✅ skip

    const t1 = String(g.teams?.[0]?.name || "").trim();
    const t2 = String(g.teams?.[1]?.name || "").trim();
    const candidates = [t1, t2].filter((x) => x && x !== "TBD");
    if (candidates.length !== 2) continue; // ✅ can't evaluate yet

    // ✅ If their pick isn't one of the teams in this matchup, skip (doesn't help/hurt)
    const pickNorm = normalizeNameMatch(pickRaw, candidates);
    if (!pickNorm) continue; // ✅ skip (this is the key fix)

    // ✅ streak "starts" at first valid pick-in-matchup (even if winner not decided yet)
    if (!started) {
      started = true;
      status = "complete";
      startedAtGameId = g.id;
      const ord = getOrderNum(g.id);
      startedAtOrder = ord != null ? ord : null;
    }

    // If the game isn't resolved yet, streak is in progress and we stop scanning
    const winnerRaw = String(g.winnerName || "").trim();
    if (!winnerRaw) {
      status = "in_progress";
      break;
    }

    // ✅ normalize winner the same way (prevents casing/alias mismatch)
    const winnerNorm = normalizeNameMatch(winnerRaw, candidates) || winnerRaw;

    if (safeLower(pickNorm) === safeLower(winnerNorm)) {
      streak += 1;
      continue;
    }

    // ✅ Wrong pick (for an actual matchup they picked) ends the streak
    status = "ended_wrong";
    break;
  }

  if (!started) status = "none";

  return {
    name: p.name,
    streak,
    status,
    startedAtGameId,
    startedAtOrder,
  };
});

      const maxStreak = rows.length ? Math.max(...rows.map((r) => r.streak)) : 0;
      const winners = maxStreak > 0 ? rows.filter((r) => r.streak === maxStreak).map((r) => r.name) : [];
      const split = winners.length ? bet.prize / winners.length : 0;
      winners.forEach((w) => (money[w] += split));

      const standings = rows
        .slice()
        .sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name))
        .map((r, idx) => ({
          rank: idx + 1,
          name: r.name,
          primary: r.streak,
          secondary:
            r.status === "in_progress"
              ? "In progress"
              : r.status === "ended_wrong"
              ? "Ended"
              : r.status === "none"
              ? "No picks"
              : "Complete",
        }));

      return {
        ...bet,
        winners,
        split,
        standings,
        metricLabel: "Streak",
        maxStreak,
      };
    }

    // =========================
    // DEFAULT BETS (your existing scoring, plus standings)
    // =========================
    const scores = brackets.map((p) => {
      let score = 0;

      for (const g of betGames) {
        if (!g.winnerName) continue;
        const pick = safeLower(p.picks?.[g.id] || "");
        if (!pick) continue;
        if (pick !== safeLower(g.winnerName)) continue;

        if (bet.id === 1) {
          if (isUpset(g)) score++;
        } else {
          score++;
        }
      }

      return { name: p.name, score };
    });

    const max = scores.length ? Math.max(...scores.map((s) => s.score)) : 0;
    const winners = scores.filter((s) => s.score === max && max > 0).map((s) => s.name);
    const split = winners.length ? bet.prize / winners.length : 0;
    winners.forEach((w) => (money[w] += split));

    // ✅ Premium standings (added; does NOT change winners/split)
    const { standings, metricLabel } = packStandings({
      rows: scores.map((s) => ({
        name: s.name,
        primary: s.score,
        secondary: null,
      })),
      sortFn: (a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
      metricLabel: "Score",
    });

    return { ...bet, winners, split, standings, metricLabel };
  });

  return { results, sideBetMoneyByPlayer: money };
}, [games, brackets, seedTeamsByRegion, scheduleOrderByGameId]);
  const totalMoneyLeaderboard = useMemo(() => {
    const names = new Set([
      ...brackets.map((b) => b.name),
      ...Object.keys(sideBetComputed.sideBetMoneyByPlayer || {}),
      ...Object.keys(grandPrizeMoneyByPlayer || {}),
    ]);

    const rows = Array.from(names).map((name) => {
      const side = sideBetComputed.sideBetMoneyByPlayer?.[name] ?? 0;
      const grand = grandPrizeMoneyByPlayer?.[name] ?? 0;
      return { name, side, grand, total: side + grand };
    });

    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [brackets, sideBetComputed.sideBetMoneyByPlayer, grandPrizeMoneyByPlayer]);

  /* =========================
     ADMIN GUARDS + MUTATORS
  ========================= */
  const requireAdmin = (actionLabel) => {
    if (readOnly) {
      const msg = `Admin only: ${actionLabel}`;
      setResultsMsg(msg);
      setBracketsMsg(msg);
      setSeedMsg(msg);
      setExportMsg(msg);
      setSimMsg(msg);
      return false;
    }
    return true;
  };
    const setManualWinnerForGame = (gameId, winnerName) => {
    setManualResultsMsg("");
    if (!requireAdmin("Manual result entry")) return;

    const gid = Number(gameId);
    if (!Number.isFinite(gid)) return;

    setGames((prev) => {
      const byId = new Map(
        prev.map((g) => [g.id, { ...g, teams: (g.teams || []).map((t) => ({ ...t })) }])
      );

      const g = byId.get(gid);
      if (!g) return prev;

      const candidates = [g.teams?.[0]?.name, g.teams?.[1]?.name].filter(Boolean);
      const normalized = normalizeNameMatch(winnerName, candidates);
      if (!normalized) return prev;

      g.winnerName = normalized;
      byId.set(gid, g);

      const next = recomputeDerivedMatchups(Array.from(byId.values()));
      setManualResultsMsg(`Saved: Game ${gid} winner = ${normalized}`);
      return next;
    });
  };

  const clearManualWinnerForGame = (gameId) => {
    setManualResultsMsg("");
    if (!requireAdmin("Clear manual result")) return;

    const gid = Number(gameId);
    if (!Number.isFinite(gid)) return;

    setGames((prev) => {
      const next = prev.map((g) => (g.id === gid ? { ...g, winnerName: "" } : g));
      setManualResultsMsg(`Cleared: Game ${gid}`);
      return recomputeDerivedMatchups(next);
    });
  };

  /* =========================
     SIMULATION
  ========================= */
const simulateWhere = (predicate, label) => {
  setSimMsg("");
  if (!requireAdmin(label)) return;

  setGames((prev) => {
    // clone games
    let next = recomputeDerivedMatchups(
      prev.map((g) => ({ ...g, teams: (g.teams || []).map((t) => ({ ...t })) }))
    );

    const rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
    const chaos = clamp(Number(simChaos) || 0, 0, 0.55);

    // IMPORTANT: make a stable list of IDs once
    const orderedIds = next
      .slice()
      .sort(
        (a, b) =>
          (ROUND_ORDER[a.round] ?? 999) - (ROUND_ORDER[b.round] ?? 999) || a.id - b.id
      )
      .map((g) => g.id);

    let filled = 0;

    for (const id of orderedIds) {
      // re-build byId for the CURRENT `next` so we always mutate live objects
      const byId = new Map(next.map((g) => [g.id, g]));
      const g = byId.get(id);
      if (!g) continue;

      if (!predicate(g)) continue;
      if (g.winnerName) continue;

      const t1 = g.teams?.[0];
      const t2 = g.teams?.[1];
      const aName = String(t1?.name || "").trim();
      const bName = String(t2?.name || "").trim();

      // can't simulate TBD games
      if (!aName || !bName || aName === "TBD" || bName === "TBD") continue;

      let pA = winProbForTeamA(t1, t2);
      pA = pA * (1 - chaos) + 0.5 * chaos;

      const winner = rng() < pA ? aName : bName;
      g.winnerName = winner;
      filled++;

      // recompute after each result so later-round matchups populate
      next = recomputeDerivedMatchups(next);
    }

    setSimMsg(
      filled ? `Simulated ${filled} game(s) — ${label}.` : `Nothing to simulate — ${label}.`
    );
    return next;
  });
};

  const simulateRound = (roundName) => simulateWhere((g) => g.round === roundName, `Simulate ${roundName}`);
  const simulateDay = (dayNum) => simulateWhere((g) => effectiveDayForGame(g) === dayNum, `Simulate Day ${dayNum}`);

  const simulateNextRound = () => {
    const sorted = games
      .slice()
      .sort((a, b) => (ROUND_ORDER[a.round] ?? 999) - (ROUND_ORDER[b.round] ?? 999) || a.id - b.id);

    let nextRound = null;
    for (const g of sorted) {
      if (g.winnerName) continue;
      const aName = g.teams?.[0]?.name;
      const bName = g.teams?.[1]?.name;
      if (!aName || !bName || aName === "TBD" || bName === "TBD") continue;
      nextRound = g.round;
      break;
    }
    if (!nextRound) {
      setSimMsg("Nothing to simulate — all remaining games are TBD or complete.");
      return;
    }
    simulateRound(nextRound);
  };

  const simulateRemaining = () => simulateWhere((g) => true, "Simulate Remaining");

  const clearAllWinners = () => {
    setSimMsg("");
    if (!requireAdmin("Clear all winners")) return;
    setGames((prev) => {
      const cleared = prev.map((g) => ({ ...g, winnerName: "" }));
      const next = recomputeDerivedMatchups(cleared);
      setSimMsg("Cleared all winners.");
      return next;
    });
  };

  /* =========================
     EXPORTS
  ========================= */
  const exportGamesSQL = async () => {
    setExportMsg("");
    if (!requireAdmin("Export Games SQL")) return;
    try {
      const res = await fetch("/api/admin/export-games", { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Export failed (${res.status})`);
      }
      const sql = await res.text();
      downloadTextFile("pp_games_seed.sql", sql);
      setExportMsg("Downloaded pp_games_seed.sql");
    } catch (e) {
      setExportMsg(e?.message || "Export failed");
    }
  };

  const exportPlayersSQL = async () => {
    setExportMsg("");
    if (!requireAdmin("Export Players SQL")) return;
    try {
      const res = await fetch("/api/admin/export-players", { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Export failed (${res.status})`);
      }
      const sql = await res.text();
      downloadTextFile("pp_players_seed.sql", sql);
      setExportMsg("Downloaded pp_players_seed.sql");
    } catch (e) {
      setExportMsg(e?.message || "Export failed");
    }
  };

  const exportPicksResultsSQL = async () => {
    setExportMsg("");
    if (!requireAdmin("Export Picks + Results SQL")) return;
    try {
      const res = await fetch("/api/admin/export-picks-results", { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Export failed (${res.status})`);
      }
      const sql = await res.text();
      downloadTextFile("pp_picks_results_seed.sql", sql);
      setExportMsg("Downloaded pp_picks_results_seed.sql");
    } catch (e) {
      setExportMsg(e?.message || "Export failed");
    }
  };

  const downloadResultsTemplate = () => {
    if (!requireAdmin("Download results template")) return;
    const dayNum = templateDay === "ALL" ? null : Number(templateDay);
    const filtered = dayNum ? games.filter((g) => effectiveDayForGame(g) === dayNum) : games;

    const header = "gameId,winnerName,matchup\n";
    const rows = filtered
      .slice()
      .sort(compareByOrderThenId)
      .map((g) => `${g.id},,${JSON.stringify(matchupLabel(g))}`)
      .join("\n");

    const fileName = dayNum ? `results_day_${dayNum}.csv` : `results_all_games.csv`;
    downloadTextFile(fileName, header + rows + "\n");
  };

  const onUploadResultsCSV = async (file) => {
    setResultsMsg("");
    if (!file) return;
    if (!requireAdmin("Upload results CSV")) return;

    try {
      const text = await file.text();
      const updates = parseResultsCSV(text);
      if (!updates.length) {
        setResultsMsg("No valid rows found. Expected: gameId,winnerName");
        return;
      }

      setGames((prev) => {
        const byId = new Map(prev.map((g) => [g.id, { ...g, teams: (g.teams || []).map((t) => ({ ...t })) }]));
        let applied = 0;

        for (const u of updates) {
          const g = byId.get(u.gameId);
          if (!g) continue;

          const candidates = [g.teams?.[0]?.name, g.teams?.[1]?.name].filter(Boolean);
          const normalized = normalizeNameMatch(u.winnerName, candidates);
          if (!normalized) continue;

          g.winnerName = normalized;
          byId.set(g.id, g);
          applied++;
        }

        const next = recomputeDerivedMatchups(Array.from(byId.values()));
        setResultsMsg(applied ? `Applied ${applied} result(s).` : "Uploaded, but no rows matched game IDs/teams.");
        return next;
      });
    } catch {
      setResultsMsg("Could not read the file. Try saving as .csv and re-uploading.");
    }
  };

  const mergeBrackets = (incoming) => {
    setBrackets((prev) => {
      const map = new Map(prev.map((p) => [safeLower(p.name), { ...p, picks: { ...p.picks }, tiebreaker: p.tiebreaker }]));

      for (const inc of incoming) {
        const name = String(inc.name || "").trim();
        if (!name) continue;
        const key = safeLower(name);
        const existing = map.get(key) || { name, picks: {}, tiebreaker: null };

        const mergedPicks = { ...existing.picks };
        for (const [k, v] of Object.entries(inc.picks || {})) {
          const gid = Number(k);
          if (!Number.isFinite(gid)) continue;
          mergedPicks[gid] = String(v);
        }

        const tiebreaker = inc.tiebreaker ?? existing.tiebreaker ?? null;
        map.set(key, { name: existing.name || name, picks: mergedPicks, tiebreaker });
      }

      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const onUploadBracketsCSV = async (file) => {
    setBracketsMsg("");
    if (!file) return;
    if (!requireAdmin("Upload brackets CSV")) return;

    try {
      const text = await file.text();
      const rows = parseBracketsCSV(text);
      if (!rows.length) {
        setBracketsMsg("No valid rows found. Expected: name,gameId,pickName");
        return;
      }

      const byName = new Map();
      for (const r of rows) {
        const name = r.name.trim();
        if (!byName.has(name)) byName.set(name, {});
        byName.get(name)[r.gameId] = r.pickName;
      }

      const incoming = Array.from(byName.entries()).map(([name, picks]) => ({ name, picks }));
      mergeBrackets(incoming);
      setBracketsMsg(`Imported brackets for ${incoming.length} player(s).`);
    } catch {
      setBracketsMsg("Could not read CSV. Try saving as .csv and re-uploading.");
    }
  };

  const setSeedTeam = (region, seed, value) => {
    if (!requireAdmin("Edit seed team names")) return;
    const name = String(value ?? "").trim();
    setSeedTeamsByRegion((prev) => ({
      ...(prev || {}),
      [region]: { ...((prev && prev[region]) || {}), [seed]: name },
    }));
  };

  const downloadSeedTemplate = () => {
    if (!requireAdmin("Download seed template")) return;
    const header = "region,seed,teamName\n";
    let rows = "";
    for (const region of REGIONS) {
      for (let seed = 1; seed <= 16; seed++) rows += `${region},${seed},\n`;
    }
    downloadTextFile("seed_team_map_template.csv", header + rows);
  };

  const onUploadSeedMapCSV = async (file) => {
    setSeedMsg("");
    if (!file) return;
    if (!requireAdmin("Upload seed map CSV")) return;

    try {
      const text = await file.text();
      const rows = parseSeedMapCSV(text);
      if (!rows.length) {
        setSeedMsg("No valid rows found. Expected: region,seed,teamName");
        return;
      }

      setSeedTeamsByRegion((prev) => {
        const next = { ...(prev || {}) };
        for (const r of rows) {
          const match = REGIONS.find((x) => safeLower(x) === safeLower(r.region));
          const region = match || r.region;
          next[region] = { ...(next[region] || {}) };
          next[region][r.seed] = r.teamName;
        }
        return next;
      });

      setSeedMsg(`Applied ${rows.length} seed name(s).`);
    } catch {
      setSeedMsg("Could not read seed map CSV. Try saving as .csv and re-uploading.");
    }
  };

  const rebuildTournament = () => {
    if (!requireAdmin("Rebuild tournament")) return;
    const fresh = buildTournamentGames(seedTeamsByRegion);
    setGames(recomputeDerivedMatchups(fresh));
    setSeedMsg("Rebuilt the full 63-game structure (winners cleared; ESPN IDs cleared).");
  };
// Who picked the actual winner for a game (returns array of player names)
function playersWhoPickedWinnerForGame(game, brackets) {
  if (!game?.winnerName) return [];
  const winnerLower = safeLower(String(game.winnerName || "").trim());
  if (!winnerLower) return [];

  const out = [];
  for (const b of brackets || []) {
    const pickRaw = String(b?.picks?.[game.id] ?? "").trim();
    if (!pickRaw) continue;

    // Normalize against the two teams if possible (handles punctuation/apostrophes better)
    const t1 = game?.teams?.[0]?.name;
    const t2 = game?.teams?.[1]?.name;
    const norm = normalizeNameMatch(pickRaw, [t1, t2].filter(Boolean)) || pickRaw;

    if (safeLower(norm) === winnerLower) out.push(b.name);
  }

  return out.sort((a, b) => a.localeCompare(b));
}
  /* =========================
     BRACKET VIEWER HELPERS
  ========================= */
  const gameListForDropdown = useMemo(() => {
    const list = Array.isArray(games) ? [...games] : [];
    return list.sort(compareByOrderThenId);
  }, [games, scheduleOrderByGameId]);

  useEffect(() => {
    if (!selectedGameId && gameListForDropdown.length) setSelectedGameId(String(gameListForDropdown[0].id));
  }, [selectedGameId, gameListForDropdown]);

  const selectedGame = useMemo(() => {
    const gid = Number(selectedGameId);
    if (!Number.isFinite(gid)) return null;
    return gamesById[gid] || null;
  }, [selectedGameId, gamesById]);

  const pickRowTone = (player, g) => {
    const pickRaw = String(player.picks?.[g.id] ?? "").trim();
    if (!pickRaw) return { tone: "neutral", label: "No pick" };

    const t1 = getTeam(g, 0);
    const t2 = getTeam(g, 1);
    const norm = normalizeNameMatch(pickRaw, [t1.name, t2.name]);
    if (!norm) return { tone: "neutral", label: "Not in matchup" };

    if (eliminatedTeams.has(norm)) return { tone: "red", label: "Eliminated" };

    if (!g.winnerName) return { tone: "neutral", label: "Pending" };

    if (safeLower(norm) === safeLower(g.winnerName)) return { tone: "green", label: "Correct" };
    return { tone: "red", label: "Wrong" };
  };

  /* =========================
     TEAM VIEW (POTENTIAL GAMES + DEPTH)
  ========================= */
  const allTeams = useMemo(() => {
    const set = new Set();
    for (const g of games) {
      const t1 = g.teams?.[0]?.name;
      const t2 = g.teams?.[1]?.name;
      if (t1 && t1 !== "TBD") set.add(t1);
      if (t2 && t2 !== "TBD") set.add(t2);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const filteredTeams = useMemo(() => {
    const q = safeLower(teamPageSearch);
    if (!q) return allTeams;
    return allTeams.filter((t) => safeLower(t).includes(q));
  }, [allTeams, teamPageSearch]);

  useEffect(() => {
    if (!teamPageSelected && filteredTeams.length) setTeamPageSelected(filteredTeams[0]);
    if (teamPageSelected && filteredTeams.length && !filteredTeams.includes(teamPageSelected)) setTeamPageSelected(filteredTeams[0]);
  }, [teamPageSelected, filteredTeams]);

  const teamPotentialGames = useMemo(() => {
    const team = String(teamPageSelected || "").trim();
    if (!team) return [];

    const out = [];
    for (const g of games) {
      const possible = possibleTeamsByGame.get(g.id) || new Set();
      if (possible.has(team)) out.push(g);
    }

    out.sort((a, b) => (ROUND_ORDER[a.round] ?? 999) - (ROUND_ORDER[b.round] ?? 999) || compareByOrderThenId(a, b));
    return out;
  }, [games, possibleTeamsByGame, teamPageSelected, scheduleOrderByGameId]);

  const teamPotentialGamesGrouped = useMemo(() => {
    const groups = {};
    for (const rd of ROUND_LIST) groups[rd] = [];
    for (const g of teamPotentialGames) {
      if (!groups[g.round]) groups[g.round] = [];
      groups[g.round].push(g);
    }
    return groups;
  }, [teamPotentialGames]);

  const playerTeamDepthRows = useMemo(() => {
    const team = String(teamPageSelected || "").trim();
    if (!team) return [];
    const teamLower = safeLower(team);

    const rows = brackets.map((b) => {
      let furthestOrder = 0;
      let furthestRound = "";
      let furthestGameId = null;
      let furthestStillPossible = false;

      for (const g of games) {
        const pick = String(b.picks?.[g.id] ?? "").trim();
        if (!pick) continue;
        if (safeLower(pick) !== teamLower) continue;

        const ord = ROUND_ORDER[g.round] ?? 0;
        if (ord > furthestOrder) {
          furthestOrder = ord;
          furthestRound = g.round;
          furthestGameId = g.id;

          const possible = possibleTeamsByGame.get(g.id) || new Set();
          furthestStillPossible = !eliminatedTeams.has(team) && possible.has(team);
        }
      }

      const picked = furthestOrder > 0;
      return {
        name: b.name,
        picked,
        furthestOrder,
        furthestRound,
        furthestGameId,
        stillPossible: picked ? furthestStillPossible : false,
      };
    });

    const pickedRows = rows.filter((r) => r.picked);
    pickedRows.sort((a, b) => b.furthestOrder - a.furthestOrder || Number(b.stillPossible) - Number(a.stillPossible) || a.name.localeCompare(b.name));
    return pickedRows;
  }, [brackets, games, possibleTeamsByGame, eliminatedTeams, teamPageSelected]);

  /* =========================
     BRACKET MAP DATA
  ========================= */
  const bracketMap = useMemo(() => buildBracketMapLayout({ games }), [games]);

  /* =========================
     AUTH GUARDS
  ========================= */
  useEffect(() => {}, []);

  if (!authChecked) {
    return (
      <div style={styles.loading}>
        <div style={{ fontWeight: 900 }}>Loading…</div>
      </div>
    );
  }
  if (!currentUser) return null;

const adminBadge = isAdmin ? (
  <Pill tone="green">ADMIN</Pill>
) : (
  <Pill>USER</Pill>
);

const sharedStatus = (() => {
  if (sharedSaving) return <Pill tone="blue">Saving…</Pill>;
  if (sharedError) return <Pill tone="red">Sync error</Pill>;
  return <Pill tone="green">Synced</Pill>;
})();

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div style={styles.topBarInner}>
          <div style={styles.leftCluster}>
            <div style={styles.brand}>
              <div style={styles.brand}>
  {/* Icon pill */}
  <div style={styles.brandMark} aria-label="Pete's Pandemonium">
<img
  src="/logo-icon.png"
  alt="Pete’s Pandemonium"
  style={{ height: 36, width: 36, display: "block" }}
/>
  </div>
</div>
              <div style={{ minWidth: 0 }}>
                <div style={styles.brandTitle}>Pete&apos;s Pandemonium</div>
                <div style={styles.brandSubtitle}>2026 NCAA March Madness</div>
              </div>
            </div>

            <div style={styles.topTabs}>
              <button onClick={() => setActiveTab("leaderboards")} style={topTab(activeTab === "leaderboards")}>
                Leaderboards
              </button>
              <button onClick={() => setActiveTab("sidebets")} style={topTab(activeTab === "sidebets")}>
                Side Bets
              </button>
              <button onClick={() => setActiveTab("bracket")} style={topTab(activeTab === "bracket")}>
  Bracket
</button>
            </div>
          </div>

          <div style={styles.rightCluster}>
            {adminBadge}
            {sharedStatus}
            <div style={styles.signedIn}>
              Signed in as <span style={{ fontWeight: 950 }}>{currentUser?.name}</span>
            </div>
            <button onClick={logout} style={styles.logoutBtn} title="Sign out">
              Logout
            </button>
          </div>
        </div>
      </div>

      <div style={styles.container}>
        {sharedError && (
          <div style={{ marginTop: 16 }}>
            <div style={styles.syncBanner}>
              <b>Shared state issue:</b> {sharedError}.
            </div>
          </div>
        )}

        {/* SIM CONTROLS (HIDDEN FROM NON-ADMINS) */}
        {isAdmin && (
          <div style={{ marginTop: 16 }}>
            <Card
              title="Simulation"
              subtitle="Seed-based probabilities with a chaos slider (admin only). Use round buttons to simulate round-by-round."
              rightHeader={<Pill tone="blue">SIM</Pill>}
            >
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ minWidth: 260 }}>
                  <div style={styles.fieldLabel}>Chaos</div>
                  <div style={styles.helpText}>0 = chalk • 0.5 = madness</div>
                  <input
                    type="range"
                    min="0"
                    max="0.55"
                    step="0.01"
                    value={simChaos}
                    onChange={(e) => setSimChaos(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                  <div style={{ marginTop: 6, fontWeight: 950 }}>{Number(simChaos).toFixed(2)}</div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={simulateNextRound} style={styles.btnDark}>
                    Simulate Next Round
                  </button>

                  <button onClick={() => simulateRound("Round 1")} style={styles.btnGhost}>Round 1</button>
                  <button onClick={() => simulateRound("Round 2")} style={styles.btnGhost}>Round 2</button>
                  <button onClick={() => simulateRound("Sweet Sixteen")} style={styles.btnGhost}>Sweet 16</button>
                  <button onClick={() => simulateRound("Elite 8")} style={styles.btnGhost}>Elite 8</button>
                  <button onClick={() => simulateRound("Final Four")} style={styles.btnGhost}>Final Four</button>
                  <button onClick={() => simulateRound("Final")} style={styles.btnGhost}>Final</button>

                  <button onClick={simulateRemaining} style={styles.btnDark}>Simulate Remaining</button>
                  <button onClick={clearAllWinners} style={styles.btnGhost}>Clear Winners</button>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={() => simulateDay(1)} style={styles.btnGhost}>Day 1</button>
                  <button onClick={() => simulateDay(2)} style={styles.btnGhost}>Day 2</button>
                  <button onClick={() => simulateDay(3)} style={styles.btnGhost}>Day 3</button>
                  <button onClick={() => simulateDay(4)} style={styles.btnGhost}>Day 4</button>
                </div>

                {simMsg ? <div style={{ ...styles.notice, marginLeft: "auto" }}>{simMsg}</div> : null}
              </div>
            </Card>
          </div>
        )}

        {/* ADMIN TOOLS */}
        {isAdmin && (
          <div style={{ marginTop: 16 }}>
            <Card title="Admin Tools" subtitle="Edits here sync to everyone automatically." rightHeader={<Pill tone="green">LIVE</Pill>}>
              <div style={styles.adminGrid}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Card
                    title="Seed → Team Name Mapper"
                    subtitle="Enter team names by region/seed. This updates Round 1 matchups automatically."
                    rightHeader={<Pill tone="green">ADMIN</Pill>}
                  >
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <button onClick={downloadSeedTemplate} style={styles.btnDark}>
                        Download Seed Template
                      </button>
                      <button onClick={rebuildTournament} style={styles.btnGhost}>
                        Rebuild Tournament (63 games)
                      </button>

                      <button onClick={exportGamesSQL} style={styles.btnDark}>
                        Export Games SQL
                      </button>
                      <button onClick={exportPlayersSQL} style={styles.btnDark}>
                        Export Players SQL
                      </button>
                      <button onClick={exportPicksResultsSQL} style={styles.btnDark}>
                        Export Picks + Results SQL
                      </button>

                      <div style={styles.helpText}>
                        Seed CSV: <code>region,seed,teamName</code>
                      </div>
                    </div>

                    {exportMsg && <div style={{ marginTop: 10, ...styles.notice }}>{exportMsg}</div>}

                    <div style={{ marginTop: 10 }}>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => onUploadSeedMapCSV(e.target.files?.[0])}
                      />
                      {seedMsg && <div style={{ marginTop: 10, ...styles.notice }}>{seedMsg}</div>}
                    </div>

                    <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
                      {REGIONS.map((region) => (
                        <div key={region} style={styles.seedRegion}>
                          <div style={styles.seedRegionTitle}>{region}</div>
                          <div style={styles.seedGrid}>
                            {Array.from({ length: 16 }).map((_, idx) => {
                              const seed = idx + 1;
                              const val = seedTeamsByRegion?.[region]?.[seed] || "";
                              return (
                                <div key={`${region}-${seed}`} style={styles.seedCell}>
                                  <div style={styles.seedLabel}>#{seed}</div>
                                  <input
                                    value={val}
                                    onChange={(e) => setSeedTeam(region, seed, e.target.value)}
                                    placeholder="Team name"
                                    style={styles.inputTight}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                <div style={styles.adminPanel}>
                  <div style={styles.fieldLabel}>Championship Total Points (tie-breaker)</div>
                  <div style={styles.helpText}>
                    Only needed if there’s a tie on ESPN points. Enter the <b>actual total points</b> of the final.
                  </div>
                  <input
                    value={finalGameTotalPoints}
                    onChange={(e) => setFinalGameTotalPoints(e.target.value)}
                    placeholder="Example: 149"
                    style={styles.input}
                  />
                </div>

                <div style={styles.adminPanel}>
                  <div style={styles.fieldLabel}>Results CSV</div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                    <select value={templateDay} onChange={(e) => setTemplateDay(e.target.value)} style={styles.select}>
                      <option value="ALL">All Games</option>
                      {uniqueDays.map((d) => (
                        <option key={d} value={String(d)}>
                          Day {d}
                        </option>
                      ))}
                    </select>
                    <button onClick={downloadResultsTemplate} style={styles.btnDark}>
                      Download Template
                    </button>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => onUploadResultsCSV(e.target.files?.[0])}
                    />
                    {resultsMsg && <div style={{ marginTop: 10, ...styles.notice }}>{resultsMsg}</div>}
                    <div style={styles.helpText}>
                      Format: <code>gameId,winnerName</code>
                    </div>
                                      {/* MANUAL DAY RESULTS ENTRY */}
                  <div style={{ marginTop: 14 }}>
                    <div style={styles.fieldLabel}>Manual Entry (Day X Results)</div>
                    <div style={styles.helpText}>
                      Pick the day, then select the winner for each game. This updates the bracket immediately.
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                      <select
                        value={String(manualDay)}
                        onChange={(e) => setManualDay(Number(e.target.value))}
                        style={styles.select}
                      >
                        {uniqueDays.map((d) => (
                          <option key={d} value={String(d)}>
                            Day {d}
                          </option>
                        ))}
                      </select>

                      {manualResultsMsg ? <div style={styles.notice}>{manualResultsMsg}</div> : null}
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      {manualDayGames.map((g) => {
                        const t1 = g.teams?.[0];
                        const t2 = g.teams?.[1];

                        const a = String(t1?.name || "").trim();
                        const b = String(t2?.name || "").trim();

                        const canPick = a && b && a !== "TBD" && b !== "TBD";

                        const current = g.winnerName ? g.winnerName : "";

                        return (
                          <div key={g.id} style={styles.gameRow}>
                            <div style={styles.gameLeft}>
                              <div style={styles.gameId}>
                                Game {g.id} <span style={{ opacity: 0.75 }}>• {g.round} • {g.slot?.region}</span>
                              </div>
                              <div style={styles.gameMatchup}>{matchupLabel(g)}</div>
                            </div>

                            <div style={styles.gameRight}>
                              {!canPick ? (
                                <Pill>Waiting on teams</Pill>
                              ) : (
                                <>
                                  <select
                                    value={current}
                                    onChange={(e) => setManualWinnerForGame(g.id, e.target.value)}
                                    style={styles.select}
                                    title="Select winner"
                                  >
                                    <option value="">— Winner —</option>
                                    <option value={a}>{a}</option>
                                    <option value={b}>{b}</option>
                                  </select>

                                  {g.winnerName ? (
                                    <button onClick={() => clearManualWinnerForGame(g.id)} style={styles.btnGhost}>
                                      Clear
                                    </button>
                                  ) : null}

                                  {g.winnerName ? <Pill tone="blue">Winner: {g.winnerName}</Pill> : <Pill>Pending</Pill>}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  </div>
                </div>

                <div style={styles.adminPanel}>
                  <div style={styles.fieldLabel}>Brackets Upload (Internal)</div>

                  <div style={{ marginTop: 10 }}>
                    <div style={styles.helpText}>
                      CSV: <code>name,gameId,pickName</code>
                    </div>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => onUploadBracketsCSV(e.target.files?.[0])}
                    />
                  </div>

                  {bracketsMsg && <div style={{ marginTop: 10, ...styles.notice }}>{bracketsMsg}</div>}
                  <div style={{ marginTop: 12 }}>
<button
  onClick={async () => {
    if (!requireAdmin("Reset all brackets")) return;
    if (!confirm("Delete ALL brackets for EVERYONE? This cannot be undone.")) return;

    // Clear UI immediately
    setBrackets([]);
    setBracketsMsg("Clearing brackets for everyone…");

    // Force-write to server state so refresh doesn't bring them back
    try {
      const nextState = {
        seedTeamsByRegion,
        games,
        brackets: [],
        finalGameTotalPoints,
        scheduleOrderByGameId,
      };

      setSharedSaving(true);
      setSharedError("");

      const res = await fetch("/api/state", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Server clear failed");

      // Prevent debounce autosave from thinking it still needs to write old payload
      lastPayloadRef.current = JSON.stringify(nextState);

      setBracketsMsg("✅ All brackets cleared for everyone (server saved). Refresh to confirm.");
    } catch (e) {
      setBracketsMsg(`❌ Clear failed: ${e?.message || "Unknown error"}`);
      setSharedError(e?.message || "Clear failed");
    } finally {
      setSharedSaving(false);
    }
  }}
  style={styles.btnGhost}
>
  Reset All Brackets
</button>
</div>
                </div>
              </div>
            </Card>
          </div>
        )}



{/* Side Bets */}
{activeTab === "sidebets" && (
  <div style={{ marginTop: 16 }}>
    <div style={styles.sectionTitle}>Side Bets</div>
    <div style={styles.sectionSub}>Click a tile to expand.</div>

    <div style={isDesktop ? styles.twoColDesktop : styles.twoCol}>
      <div style={{ display: "grid", gap: 12 }}>
        {sideBetComputed.results.map((bet) => {
          // ✅ IMPORTANT: This keeps your existing bet → games logic (no scoring/config changes)
const betGames = (() => {
  if (bet.id === 8) {
    return games.slice().sort(compareByOrderThenId);
  }

  if (Array.isArray(bet.gameIds) && bet.gameIds.length) {
    const idSet = new Set(bet.gameIds.map((x) => Number(x)).filter(Number.isFinite));
    return games
      .filter((g) => idSet.has(Number(g.id)))
      .slice()
      .sort(compareByOrderThenId);
  }

  if (bet.round) {
    return games
      .filter((g) => String(g.round) === String(bet.round))
      .slice()
      .sort(compareByOrderThenId);
  }

  return [];
})();

          const open = expandedBet === bet.id;

const totalGames = betGames.length;
const resolvedGames = betGames.filter((g) => Boolean(g.winnerName)).length;

// ✅ If there are no brackets/players, side bets should reset to WAITING
const hasBrackets = Array.isArray(brackets) && brackets.length > 0;

const status =
  !hasBrackets
    ? "WAITING"
    : totalGames === 0 || resolvedGames === 0
    ? "WAITING"
    : resolvedGames === totalGames
    ? "COMPLETED"
    : "LIVE";

const statusPill =
  status === "COMPLETED" ? (
    <Pill tone="blue">✓ COMPLETED</Pill>
  ) : status === "LIVE" ? (
    <span style={styles.pillLiveGlow}>
      <Pill tone="green">● LIVE</Pill>
    </span>
  ) : (
    <Pill>🔒 WAITING</Pill>
  );

          const hasWinners = Array.isArray(bet.winners) && bet.winners.length > 0;

          // Compute pickers for THIS game winner directly from brackets (same as your current UI)
          const playersWhoPickedWinner = (g) => {
            const w = String(g?.winnerName || "").trim();
            if (!w) return [];

            const t1 = String(g?.teams?.[0]?.name || "").trim();
            const t2 = String(g?.teams?.[1]?.name || "").trim();

            // If teams aren't set, we can still compare directly to winnerName
            const candidates = [t1, t2].filter((x) => x && x !== "TBD");
            const winnerNorm = candidates.length ? normalizeNameMatch(w, candidates) : w;

            const out = [];
            for (const b of brackets) {
              const pickRaw = String(b?.picks?.[g.id] ?? "").trim();
              if (!pickRaw) continue;

              const pickNorm = candidates.length ? normalizeNameMatch(pickRaw, candidates) : pickRaw;
              if (!pickNorm) continue;

              if (safeLower(pickNorm) === safeLower(winnerNorm)) out.push(b.name);
            }

            return out.sort((a, b) => a.localeCompare(b));
          };

          const progressPct = totalGames ? Math.round((resolvedGames / totalGames) * 100) : 0;

          return (
            <div
  key={bet.id}
  onMouseEnter={() => setHoveredBetId(bet.id)}
  onMouseLeave={() => setHoveredBetId(null)}
  style={{
    ...styles.betCard,
    ...(hasWinners ? styles.betCardHot : {}),
    ...(hoveredBetId === bet.id ? styles.betCardHover : {}),
  
  }}
>
              {/* Collapsed header (premium layout) */}
              <div
                onClick={() => setExpandedBet(open ? null : bet.id)}
                style={styles.betCardTop}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" ? setExpandedBet(open ? null : bet.id) : null)}
              >
                <div style={styles.betCardTopSheen} />
                {/* Accent strip */}
                <div
                  style={{
                    width: 6,
                    alignSelf: "stretch",
                    borderRadius: 999,
                    background:
                      status === "LIVE"
                        ? THEME.green
                        : status === "COMPLETED"
                        ? "rgba(15,23,42,0.35)"
                        : "rgba(15,23,42,0.14)",
                    boxShadow:
                      status === "LIVE"
                        ? "0 0 0 1px rgba(32,90,40,0.20), 0 10px 18px rgba(32,90,40,0.18)"
                        : "none",
                  }}
                />

                <div style={{ display: "grid", gap: 8, flex: 1, minWidth: 0 }}>
                  {/* Row 1: Title + status + prize */}
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 10, minWidth: 0, flex: 1 }}>
                      <div style={styles.chev}>{open ? "▾" : "▸"}</div>

                      <div style={{ minWidth: 0 }}>
                        <div style={styles.betTitle}>{bet.title}</div>
                    
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div style={{ fontWeight: 950, fontSize: 14 }}>
                        {dollars(bet.prize)}
                      </div>
                      {statusPill}
                    </div>
                  </div>

                  {/* Row 2: Leader */}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {hasWinners ? (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 950 }}>
                          🥇 {bet.winners.join(", ")}
                          <span style={{ fontWeight: 850, opacity: 0.75 }}> — {dollars(bet.split)} each</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.65 }}>
                        No Leader Yet
                      </div>
                    )}

                    <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
                      Results: <b>{resolvedGames}/{totalGames}</b>
                    </div>
                  </div>

                  {/* Row 3: Progress bar */}
                  <div style={{ display: "grid", gap: 6 }}>
                    <div
                      style={{
                        height: 10,
                        borderRadius: 999,
                        border: "1px solid rgba(15,23,42,0.10)",
                        background: "rgba(15,23,42,0.05)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${progressPct}%`,
                          borderRadius: 999,
                          background:
                            status === "LIVE"
                              ? THEME.green
                              : status === "COMPLETED"
                              ? "rgba(15,23,42,0.55)"
                              : "rgba(15,23,42,0.20)",
                          transition: "width 250ms ease",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 850, opacity: 0.7 }}>
                      {progressPct}% complete
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded body */}
              <SmoothCollapse isOpen={open}>
                <div style={styles.betBodyInner}>
                 

                  {bet.hitLabel ? (
  <div style={styles.callout}>
    <b>{bet.hitLabel}</b>
  </div>
) : null}
{bet.desc ? (
  <div style={{ marginBottom: 10, fontSize: 12, fontWeight: 800, color: "rgba(15,23,42,0.72)" }}>
    {bet.desc}
  </div>
) : null}
{Array.isArray(bet.standings) && bet.standings.length ? (
  <div style={{ marginBottom: 12 }}>
   <div style={styles.standingsHeaderRow}>
  <div>Player</div>
  <div style={{ textAlign: "right" }}>{bet.metricLabel || "Score"}</div>
</div>

    <div style={styles.standingsPanel}>
     {bet.standings.slice(0, 20).map((r, idx) => {
  const isLeader =
    Array.isArray(bet.winners) && bet.winners.includes(r.name) && (bet.winners?.length || 0) > 0;

  return (
    <div
      key={r.name}
      style={{
        ...styles.standingsRow,
        ...(idx % 2 === 1 ? styles.standingsRowAlt : {}),
        borderTop: idx === 0 ? "none" : styles.standingsRow.borderTop,
      }}
    >
      {/* LEFT: rank + name */}
      <div style={styles.standingsLeft}>
        <div style={styles.standingsRank}>{idx + 1}</div>

        <div style={{ minWidth: 0 }}>
          <div style={styles.standingsName}>
            {r.name}
            {isLeader ? <span style={styles.leaderChip}>LEADER</span> : null}
          </div>

          {/* optional secondary under name if you want it here instead */}
          {/* {r.secondary ? <div style={styles.standingsSecondary}>{r.secondary}</div> : null} */}
        </div>
      </div>

      {/* RIGHT: metric */}
      <div style={styles.standingsRight}>
        <div style={styles.standingsPrimary}>{String(r.primary)}</div>
        {r.secondary ? <div style={styles.standingsSecondary}>{r.secondary}</div> : null}
      </div>
    </div>
  );
})}

      {bet.standings.length > 20 ? (
        <div style={styles.standingsFooter}>Showing top 20 • ({bet.standings.length} total)</div>
      ) : null}
    </div>
  </div>
) : null}
                  

                  {/* Games list */}
                  <div style={bet.id === 8 ? styles.gamesScroll : { display: "grid", gap: 8 }}>
                    

{betGames.map((g, idx) => {
  const up = isUpset(g);

  const t1 = g.teams?.[0];
  const t2 = g.teams?.[1];

  const t1Name = String(t1?.name ?? "TBD").trim();
  const t2Name = String(t2?.name ?? "TBD").trim();

  const t1Seed = t1?.seed;
  const t2Seed = t2?.seed;

  const winner = String(g.winnerName || "").trim();
  const wLower = safeLower(winner);

  const t1IsWinner = wLower && safeLower(t1Name) === wLower;
  const t2IsWinner = wLower && safeLower(t2Name) === wLower;

  const pickers = g.winnerName ? playersWhoPickedWinner(g) : [];
  const showPickers = Boolean(g.winnerName) && pickers.length;

  const teamStyle = (isWinner, isLoser) => ({
    fontWeight: isWinner ? 950 : 850,
    ...(isWinner && {
      color: THEME.green,
      background: "rgba(32,90,40,0.10)",
      padding: "1px 4px",
      borderRadius: 6,
    }),
    ...(isLoser && {
      textDecoration: "line-through",
      opacity: 0.55,
    }),
  });

  return (
    <div key={g.id} style={{ display: "grid" }}>
      {/* Premium divider (between games only) */}
      {idx !== 0 ? <div style={styles.gameDividerPremium} /> : null}

      <div style={styles.gameRow}>
        {/* LEFT: matchup single-line like before */}
        <div style={styles.gameLeft}>
          <div style={styles.gameId}>
            Game {g.id} <span style={{ opacity: 0.75 }}>• {g.slot?.region}</span>
          </div>

          <div style={styles.gameMatchup}>
            <span style={teamStyle(t1IsWinner, wLower && !t1IsWinner && t2IsWinner)}>
              ({t1Seed ?? "—"}) {t1Name}
            </span>

            <span style={{ margin: "0 8px", opacity: 0.65, fontWeight: 800 }}>vs</span>

            <span style={teamStyle(t2IsWinner, wLower && !t2IsWinner && t1IsWinner)}>
              ({t2Seed ?? "—"}) {t2Name}
            </span>

            {up ? <span style={styles.upsetTag}>UPSET</span> : null}
          </div>
        </div>

        {/* RIGHT: who picked winner */}
        <div style={{ ...styles.gameRight, alignItems: "flex-start" }}>
          {!g.winnerName ? (
            <Pill>Pending</Pill>
          ) : (
            <div style={{ textAlign: "right" }}>
              <div style={styles.pickersLabel}>Picked Winner</div>
              <div style={styles.pickersValue}>
                {showPickers ? pickers.join(", ") : "—"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
})}
                  </div>
                </div>
              </SmoothCollapse>
            </div>
          );
        })}
      </div>

      <div>
<Card title="Moneyboard" rightHeader={<Pill tone="green">AUTO</Pill>}>
  <div style={styles.moneyboardWrap}>
    <div style={styles.moneyboardHeader}>
      <div>#</div>
      <div>Player</div>
      <div style={{ textAlign: "right" }}>Winnings</div>
    </div>

    <div style={styles.moneyboardList}>
      {Object.entries(sideBetComputed.sideBetMoneyByPlayer)
        .map(([name, money]) => ({ name, money }))
        .sort((a, b) => b.money - a.money)
        .map((row, i) => (
          <div
            key={row.name}
            style={{
              ...styles.moneyboardRow,
              ...(i === 0 ? styles.moneyboardRowTop : {}),
            }}
          >
            <div style={styles.moneyboardRank}>
  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
</div>
            <div style={styles.moneyboardName}>{row.name}</div>
            <div style={styles.moneyboardAmt}>{dollars(row.money)}</div>
          </div>
        ))}
    </div>
  </div>
</Card>
      </div>
    </div>
  </div>
)}
        {/* Leaderboards */}
        {activeTab === "leaderboards" && (
          <div style={{ marginTop: 16 }}>
            <div style={styles.sectionTitle}>Leaderboards</div>
            

            <div style={isDesktop ? styles.twoColDesktop : styles.twoCol}>
              <div>
<Card title="Leaderboard" subtitle="ESPN Points" rightHeader={<Pill tone="green">LIVE</Pill>}>
  <div style={styles.moneyboardWrap}>
    <div style={styles.lbHeader}>
      <div>#</div>
      <div>Player</div>
      <div style={{ textAlign: "right" }}>Points</div>
      <div style={{ textAlign: "right" }}>Remaining</div>
      <div>Biggest Boost (Day {boostDay})</div>
    </div>

    <div style={styles.moneyboardList}>
      {pointsLeaderboard.map((row, i) => (
        <div
          key={row.name}
          style={{
            ...styles.lbRow,
            ...(i === 0 ? styles.moneyboardRowTop : {}),
          }}
        >
<div style={styles.moneyboardRank}>
  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
</div>

          <div style={styles.lbName}>{row.name}</div>

          <div style={styles.lbValueRight}>{row.points}</div>
          <div style={styles.lbValueRight}>{row.remain}</div>

          <div style={styles.lbBoostCell}>
            {row.boost ? <Pill tone="green">{row.boost}</Pill> : <Pill>—</Pill>}
          </div>
        </div>
      ))}
    </div>
  </div>
</Card>
              </div>

              <div>
                <Card title="Moneyboard" rightHeader={<Pill tone="green">LIVE</Pill>}>
  <div style={styles.moneyboardWrap}>
    <div style={styles.moneyboardHeader}>
      <div>#</div>
      <div>Player</div>
      <div style={{ textAlign: "right" }}>Winnings</div>
    </div>

    <div style={styles.moneyboardList}>
      {totalMoneyLeaderboard.map((r, i) => (
        <div
          key={r.name}
          style={{
            ...styles.moneyboardRow,
            ...(i === 0 ? styles.moneyboardRowTop : {}),
          }}
        >
<div style={styles.moneyboardRank}>
  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
</div>

          <div style={styles.moneyboardName}>{r.name}</div>

          <div style={{ textAlign: "right" }}>
            <div style={styles.moneyboardAmt}>{dollars(r.total)}</div>
                <div>Grand: {dollars(r.grand)}</div>
    <div>Side: {dollars(r.side)}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
</Card>
              </div>
            </div>
          </div>
        )}

{/* BRACKET (MAP + VIEWER) */}
{activeTab === "bracket" && (
  <div style={{ marginTop: 16 }}>
    <div style={styles.sectionTitle}>Bracket</div>
    

    {/* Mode buttons UNDER the title */}
    <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button onClick={() => setBracketViewMode("map")} style={tabPill(bracketViewMode === "map")}>
        Map
      </button>
      <button onClick={() => setBracketViewMode("game")} style={tabPill(bracketViewMode === "game")}>
        View by Game
      </button>
      <button onClick={() => setBracketViewMode("team")} style={tabPill(bracketViewMode === "team")}>
        View by Team
      </button>
      <button onClick={() => setBracketViewMode("player")} style={tabPill(bracketViewMode === "player")}>
        View by Player
      </button>
    </div>

    {/* MAP */}
    {bracketViewMode === "map" && (
      <div style={{ marginTop: 14 }}>
        <div style={styles.sectionSub}>
          Winner is <span style={{ color: THEME.green, fontWeight: 950 }}>highlighted</span>. Loser is{" "}
          <span style={{ textDecoration: "line-through", opacity: 0.7, fontWeight: 900 }}>struck through</span>.
        </div>

        <div style={{ marginTop: 12 }}>
          <Card title="Bracket Map" subtitle="Lines are driven by the real sources." rightHeader={<Pill tone="blue">LIVE</Pill>}>
            <div style={{ overflowX: "auto", paddingBottom: 8 }}>
              <div style={{ position: "relative", width: bracketMap.width, height: bracketMap.height, minHeight: 650 }}>
                <svg
                  width={bracketMap.width}
                  height={bracketMap.height}
                  style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                >
                  {bracketMap.segments.map((seg, idx) => {
                    const d = `M ${seg[0].x} ${seg[0].y} L ${seg[1].x} ${seg[1].y} L ${seg[2].x} ${seg[2].y} L ${seg[3].x} ${seg[3].y}`;
                    return <path key={idx} d={d} fill="none" stroke="rgba(15,23,42,0.35)" strokeWidth="2" />;
                  })}
                </svg>

                {bracketMap.nodes.map((n) => {
                  if (n.kind === "join") {
                    return (
                      <div
                        key={n.id}
                        style={{
                          position: "absolute",
                          left: n.x,
                          top: n.y,
                          width: n.w,
                          height: n.h,
                          borderRadius: 999,
                          background: "rgba(15,23,42,0.25)",
                          color: "#0f172a",
                          border: "2px solid rgba(15,23,42,0.28)",
                          boxShadow: "0 6px 14px rgba(2,6,23,0.10)",
                        }}
                        title={`Join to Game ${String(n.joinForTarget)}`}
                      />
                    );
                  }

                  const g = bracketMap.byId.get(n.id);
                  const orderVal = scheduleOrderByGameId?.[n.id] ?? "";

                  const t1 = g?.teams?.[0];
                  const t2 = g?.teams?.[1];

                  const w = String(g?.winnerName || "").trim();
                  const wLower = safeLower(w);

                  const lineFromTeam = (team, srcId) => {
                    const nm = team?.name;
                    const seed = team?.seed;
                    if (nm && nm !== "TBD") return `(${seed ?? "—"}) ${nm}`;
                    if (srcId) return `TBD (W of Game ${srcId})`;
                    return "TBD";
                  };

                  const l1 = lineFromTeam(t1, g?.sources?.[0]);
                  const l2 = lineFromTeam(t2, g?.sources?.[1]);

                  const t1IsWinner = wLower && safeLower(t1?.name) === wLower;
                  const t2IsWinner = wLower && safeLower(t2?.name) === wLower;

                  const lineStyle = (isWinner, isLoser) => ({
                    ...styles.clamp2,
                    ...(isWinner ? styles.teamWinner : {}),
                    ...(isLoser ? styles.teamLoser : {}),
                  });

                  return (
                    <div
                      key={n.id}
                      style={{
                        position: "absolute",
                        left: n.x,
                        top: n.y,
                        width: n.w,
                        height: n.h,
                        borderRadius: 16,
                        border: "1px solid rgba(15,23,42,0.12)",
                        background: "white",
                        boxShadow: "0 12px 26px rgba(2,6,23,0.08)",
                        padding: 12,
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div style={{ fontWeight: 950, fontSize: 12 }}>
                          {orderVal ? (
                            <>
                              Order #{orderVal} <span style={{ opacity: 0.6 }}>•</span> Game {g?.id}{" "}
                              <span style={{ opacity: 0.7 }}>• {g?.round}</span>
                            </>
                          ) : (
                            <>
                              Game {g?.id} <span style={{ opacity: 0.7 }}>• {g?.round}</span>
                            </>
                          )}
                        </div>

                        {isAdmin ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 950, opacity: 0.75 }}>Order#</span>
                            <input
                              value={orderVal}
                              onChange={(e) => {
                                const v = String(e.target.value ?? "").replace(/[^\d]/g, "").slice(0, 3);
                                setScheduleOrderByGameId((prev) => ({ ...(prev || {}), [n.id]: v }));
                              }}
                              inputMode="numeric"
                              placeholder="—"
                              style={{
                                width: 52,
                                height: 28,
                                borderRadius: 10,
                                border: "1px solid rgba(15,23,42,0.16)",
                                padding: "0 8px",
                                fontWeight: 950,
                                fontSize: 12,
                                outline: "none",
                              }}
                              title="Game schedule order"
                            />
                          </div>
                        ) : orderVal ? (
                          <Pill tone="blue">#{orderVal}</Pill>
                        ) : (
                          <Pill>—</Pill>
                        )}
                      </div>

                      <div style={{ flex: 1, display: "grid", gap: 6, alignContent: "start" }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 850,
                            color: "rgba(15,23,42,0.82)",
                            lineHeight: "16px",
                            minHeight: 0,
                          }}
                        >
                          <div style={lineStyle(t1IsWinner, wLower && !t1IsWinner && t2IsWinner)}>{l1}</div>
                          <div style={lineStyle(t2IsWinner, wLower && !t2IsWinner && t1IsWinner)}>{l2}</div>
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.72 }}>{g?.slot?.region}</div>
                        <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>{w ? `Winner set` : `Pending`}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 12, ...styles.helpText }}>
              <b>Tip:</b> Enter Order# when the schedule drops — no need to renumber gameIds.
            </div>
          </Card>
        </div>
      </div>
    )}

    {/* VIEWER: By Player */}
{bracketViewMode === "player" && (
  <div style={{ marginTop: 14 }}>
    <Card title="By Player" subtitle="Select a player — their picks will be highlighted on the map." rightHeader={<Pill tone="blue">LIVE</Pill>}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={playerViewSelected}
          onChange={(e) => setPlayerViewSelected(e.target.value)}
          style={styles.select}
        >
          {playerList.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <Pill tone="green">Highlighting: {playerViewSelected || "—"}</Pill>
      </div>
    </Card>

    {/* Map underneath, with player highlighting enabled */}
    <div style={{ marginTop: 12 }}>
      <Card
        title="Bracket Map"
        subtitle="Highlighted lines show the selected player’s picks."
        rightHeader={<Pill tone="blue">LIVE</Pill>}
      >
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div style={{ position: "relative", width: bracketMap.width, height: bracketMap.height, minHeight: 650 }}>
            <svg
              width={bracketMap.width}
              height={bracketMap.height}
              style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
            >
              {bracketMap.segments.map((seg, idx) => {
                const d = `M ${seg[0].x} ${seg[0].y} L ${seg[1].x} ${seg[1].y} L ${seg[2].x} ${seg[2].y} L ${seg[3].x} ${seg[3].y}`;
                return <path key={idx} d={d} fill="none" stroke="rgba(15,23,42,0.35)" strokeWidth="2" />;
              })}
            </svg>

            {bracketMap.nodes.map((n) => {
              if (n.kind === "join") {
                return (
                  <div
                    key={n.id}
                    style={{
                      position: "absolute",
                      left: n.x,
                      top: n.y,
                      width: n.w,
                      height: n.h,
                      borderRadius: 999,
                      background: "rgba(15,23,42,0.25)",
                      color: "#0f172a",
                      border: "2px solid rgba(15,23,42,0.28)",
                      boxShadow: "0 6px 14px rgba(2,6,23,0.10)",
                    }}
                    title={`Join to Game ${String(n.joinForTarget)}`}
                  />
                );
              }

              const g = bracketMap.byId.get(n.id);
              const orderVal = scheduleOrderByGameId?.[n.id] ?? "";

              const t1 = g?.teams?.[0];
              const t2 = g?.teams?.[1];

              const w = String(g?.winnerName || "").trim();
              const wLower = safeLower(w);

              // ✅ Player pick highlighting
              const selectedBracket =
                playerViewSelected ? brackets.find((b) => safeLower(b.name) === safeLower(playerViewSelected)) : null;

              const pickRaw = String(selectedBracket?.picks?.[g?.id] ?? "").trim();
              const t1Name = String(t1?.name || "").trim();
              const t2Name = String(t2?.name || "").trim();
              const candidates = [t1Name, t2Name].filter((x) => x && x !== "TBD");

              const pickNorm = pickRaw && candidates.length ? normalizeNameMatch(pickRaw, candidates) : pickRaw;

              const pickIsT1 = pickNorm && safeLower(pickNorm) === safeLower(t1Name);
              const pickIsT2 = pickNorm && safeLower(pickNorm) === safeLower(t2Name);

              const pickCorrect = wLower && pickNorm && safeLower(pickNorm) === wLower;
              const pickWrong = wLower && pickNorm && safeLower(pickNorm) !== wLower;
              const pickExists = Boolean(pickRaw && pickRaw !== "TBD");
              const pickNotInMatchup = pickExists && candidates.length && !pickIsT1 && !pickIsT2;
              const lineFromTeam = (team, srcId) => {
                const nm = team?.name;
                const seed = team?.seed;
                if (nm && nm !== "TBD") return `(${seed ?? "—"}) ${nm}`;
                if (srcId) return `TBD (W of Game ${srcId})`;
                return "TBD";
              };

              const l1 = lineFromTeam(t1, g?.sources?.[0]);
              const l2 = lineFromTeam(t2, g?.sources?.[1]);

              const t1IsWinner = wLower && safeLower(t1?.name) === wLower;
              const t2IsWinner = wLower && safeLower(t2?.name) === wLower;

              const lineStyle = (isWinner, isLoser, isPicked) => ({
                ...styles.clamp2,
                ...(isWinner ? styles.teamWinner : {}),
                ...(isLoser ? styles.teamLoser : {}),
                ...(isPicked ? styles.playerPickLine : {}),
                ...(isPicked && pickCorrect ? styles.playerPickCorrect : {}),
                ...(isPicked && pickWrong ? styles.playerPickWrong : {}),
              });

              return (
                <div
                  key={n.id}
                  style={{
                    position: "absolute",
                    left: n.x,
                    top: n.y,
                    width: n.w,
                    height: n.h,
                    borderRadius: 16,
                    border: "1px solid rgba(15,23,42,0.12)",
                    background: "white",
                    boxShadow: "0 12px 26px rgba(2,6,23,0.08)",
                    padding: 12,
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 950, fontSize: 12 }}>
                      {orderVal ? (
                        <>
                          Order #{orderVal} <span style={{ opacity: 0.6 }}>•</span> Game {g?.id}{" "}
                          <span style={{ opacity: 0.7 }}>• {g?.round}</span>
                        </>
                      ) : (
                        <>
                          Game {g?.id} <span style={{ opacity: 0.7 }}>• {g?.round}</span>
                        </>
                      )}
                    </div>

{pickExists ? (
  <Pill tone={pickNotInMatchup ? "yellow" : pickCorrect ? "green" : pickWrong ? "red" : "blue"}>
    Pick: {pickRaw}
  </Pill>
) : (
  <Pill>—</Pill>
)}
                  </div>

                  <div style={{ flex: 1, display: "grid", gap: 6, alignContent: "start" }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 850,
                        color: "rgba(15,23,42,0.82)",
                        lineHeight: "16px",
                        minHeight: 0,
                      }}
                    >
                      <div style={lineStyle(t1IsWinner, wLower && !t1IsWinner && t2IsWinner, pickIsT1)}>{l1}</div>
                      <div style={lineStyle(t2IsWinner, wLower && !t2IsWinner && t1IsWinner, pickIsT2)}>{l2}</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.72 }}>{g?.slot?.region}</div>
                    <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>{w ? `Winner set` : `Pending`}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  </div>
)}
            {/* View by Game */}
            {bracketViewMode === "game" && (
              <div style={{ marginTop: 14 }}>
                <Card title="By Game" subtitle="Pick a game to see everyone’s pick + who’s still alive." rightHeader={<Pill tone="blue">LIVE</Pill>}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Search teams / matchups…"
                      style={{ ...styles.input, maxWidth: 340 }}
                    />

                    <select value={selectedGameId} onChange={(e) => setSelectedGameId(e.target.value)} style={styles.select}>
                      {gameListForDropdown
                        .filter((g) => {
                          const q = safeLower(teamSearch);
                          if (!q) return true;
                          return (
                            safeLower(matchupLabel(g)).includes(q) ||
                            safeLower(g.slot?.region || "").includes(q) ||
                            safeLower(g.round || "").includes(q)
                          );
                        })
                        .map((g) => {
                          const ord = scheduleOrderByGameId?.[g.id];
                          return (
                            <option key={g.id} value={String(g.id)}>
  {ord ? `Order #${ord} — ` : ""}{matchupLabel(g)} — Game {g.id}
</option>
                          );
                        })}
                    </select>
                  </div>

                  {selectedGame ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={styles.bracketGameHeader}>
                        <div>
                          <div style={styles.bracketGameTitle}>
                            Game {selectedGame.id} • {selectedGame.round} • {selectedGame.slot?.region}
                          </div>
                          <div style={styles.bracketGameMatchup}>{matchupLabel(selectedGame)}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <Pill tone="green">Worth {ESPN_POINTS[selectedGame.round] ?? 0}</Pill>
                          {selectedGame.winnerName ? <Pill tone="blue">Winner: {selectedGame.winnerName}</Pill> : <Pill>Pending</Pill>}
                          {isUpset(selectedGame) ? <Pill tone="red">UPSET</Pill> : null}
                        </div>
                      </div>

                      <div style={styles.pickTableHeader}>
                        <div style={styles.pickColName}>Player</div>
                        <div style={styles.pickColPick}>Pick</div>
                        <div style={styles.pickColStatus}>Status</div>
                      </div>

                      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        {brackets
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((p) => {
                            const pick = String(p.picks?.[selectedGame.id] ?? "").trim();
                            const info = pickRowTone(p, selectedGame);

                            return (
                              <div key={p.name} style={styles.pickRow}>
                                <div style={styles.pickColName}>
                                  <div style={{ fontWeight: 950 }}>{p.name}</div>
                                </div>
                                <div style={styles.pickColPick}>
                                  {pick ? <span style={{ fontWeight: 850 }}>{pick}</span> : <span style={{ opacity: 0.6, fontWeight: 800 }}>—</span>}
                                </div>
                                <div style={styles.pickColStatus}>
                                  {info.tone === "green" ? (
                                    <Pill tone="green">{info.label}</Pill>
                                  ) : info.tone === "red" ? (
                                    <Pill tone="red">{info.label}</Pill>
                                  ) : (
                                    <Pill>{info.label}</Pill>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, ...styles.notice }}>Pick a game to view player picks.</div>
                  )}
                </Card>
              </div>
            )}

            {/* View by Team */}
            {bracketViewMode === "team" && (
              <div style={{ marginTop: 14 }}>
                <Card title="By Team" subtitle="Pick a team to see their potential path + who picked them (and how far)." rightHeader={<Pill tone="blue">LIVE</Pill>}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      value={teamPageSearch}
                      onChange={(e) => setTeamPageSearch(e.target.value)}
                      placeholder="Search team…"
                      style={{ ...styles.input, maxWidth: 340 }}
                    />

                    <select value={teamPageSelected} onChange={(e) => setTeamPageSelected(e.target.value)} style={styles.select}>
                      {filteredTeams.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    {teamPageSelected ? (
                      eliminatedTeams.has(teamPageSelected) ? (
                        <Pill tone="red">Eliminated</Pill>
                      ) : (
                        <Pill tone="green">Alive / Possible</Pill>
                      )
                    ) : null}
                  </div>

                  {teamPageSelected ? (
                    <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                      <div style={styles.teamSection}>
                        <div style={styles.teamSectionTitle}>Potential games {teamPageSelected} could appear in</div>
                        <div style={styles.helpText}>
                          This is driven by the bracket logic (sources) + completed winners. As games resolve, this list will shrink.
                        </div>

                        {ROUND_LIST.map((rd) => {
                          const list = teamPotentialGamesGrouped[rd] || [];
                          if (!list.length) return null;

                          return (
                            <div key={rd} style={{ marginTop: 10 }}>
                              <div style={{ fontWeight: 950, marginBottom: 6 }}>{rd}</div>
                              <div style={{ display: "grid", gap: 8 }}>
                                {list.map((g) => (
                                  <div key={g.id} style={styles.gameRow}>
                                    <div style={styles.gameLeft}>
                                      <div style={styles.gameId}>
                                        Game {g.id} <span style={{ opacity: 0.75 }}>• {g.slot?.region}</span>
                                      </div>
                                      <div style={styles.gameMatchup}>{matchupLabel(g)}</div>
                                    </div>
                                    <div style={styles.gameRight}>
                                      {g.winnerName ? <Pill tone="blue">Winner: {g.winnerName}</Pill> : <Pill>Pending</Pill>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
<div style={styles.teamSection}>
  <div style={{ fontWeight: 950, fontSize: 16, color: "#0f172a" }}>{teamPageSelected}</div>
  <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, color: "rgba(15,23,42,0.65)" }}>
    Players who picked this team (and how far)
  </div>

  {playerTeamDepthRows.length ? (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      {playerTeamDepthRows.map((r) => (
        <div
          key={r.name}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid rgba(15,23,42,0.10)",
            background: "rgba(255,255,255,0.70)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 950, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, fontWeight: 800, color: "rgba(15,23,42,0.65)" }}>
              {r.furthestRound} {r.furthestGameId ? `• Game ${r.furthestGameId}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            {r.stillPossible ? <Pill tone="green">Alive</Pill> : <Pill tone="red">Dead</Pill>}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div style={{ ...styles.notice, marginTop: 12 }}>Nobody picked {teamPageSelected}.</div>
  )}
</div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, ...styles.notice }}>Select a team.</div>
                  )}
                </Card>
              </div>
            )}
          </div>
        )}

        <div style={{ height: 28 }} />
      </div>
    </div>
  );
}

/* =========================
   STYLES
========================= */
const styles = {
  loading: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#f4f6f8",
    color: "#0f172a",
    fontFamily: "Arial, sans-serif",
  },
  page: {
  background: "#F4F6F5",
  minHeight: "100vh",
  color: "#e5e7eb",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
},
  container: { maxWidth: 1180, margin: "0 auto", padding: "0 16px" },

topBar: {
  background: "white",
  borderBottom: "4px solid #14532d", // strong green sportsbook accent
  boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
  position: "sticky",
  top: 0,
  zIndex: 50,
},
  topBarInner: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
  },
  leftCluster: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minWidth: 0 },
  rightCluster: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },

  brand: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 },
brandMark: {
width: 52,
height: 52,
borderRadius: 16,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(20,83,45,0.06)",
  border: "1px solid rgba(20,83,45,0.15)",
},
brandTitle: {
  fontWeight: 950,
  fontSize: 18,
  color: "#0f172a",
},

brandSubtitle: {
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(15,23,42,0.60)",
},

  topTabs: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },

  signedIn: { fontWeight: 850, fontSize: 12, color: "rgba(15,23,42,0.72)" },
logoutBtn: {
  background: "rgba(15,23,42,0.03)",
  border: "1px solid rgba(15,23,42,0.14)",
  color: "rgba(15,23,42,0.88)",
  padding: "8px 10px",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 950,
  fontSize: 12,
},
  gamesScroll: {
  maxHeight: 360,              // adjust: 300–450 feels good
  overflowY: "auto",
  paddingRight: 6,             // keeps text from hiding under scrollbar
},

gamesScrollInner: {
  display: "grid",
  gap: 8,
},

  syncBanner: {
    background: "rgba(15,23,42,0.03)",
    border: "1px solid rgba(15,23,42,0.10)",
    padding: "10px 12px",
    borderRadius: 16,
    boxShadow: "0 10px 24px rgba(2,6,23,0.06)",
    fontWeight: 900,
    color: "rgba(15,23,42,0.80)",
  },
  standingsRowAlt: {
  background: "rgba(15,23,42,0.025)",
},
  standingsHeaderRow: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontWeight: 900,
  fontSize: 11,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: "rgba(15,23,42,0.65)",
  marginBottom: 8,
},

standingsPanel: {
  border: "1px solid rgba(15,23,42,0.10)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.70)",
  overflow: "hidden",
},

standingsRow: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "9px 12px",
  borderTop: "1px solid rgba(15,23,42,0.08)",
},

standingsLeft: {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
},

standingsRank: {
  width: 24,
  height: 24,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  fontWeight: 950,
  fontSize: 11,
  color: "rgba(15,23,42,0.70)",
  background: "rgba(15,23,42,0.05)",
  border: "1px solid rgba(15,23,42,0.10)",
  flex: "0 0 auto",
},
moneyboardWrap: {
  border: "1px solid rgba(15,23,42,0.10)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.70)",
  overflow: "hidden",
},
lbHeader: {
  display: "grid",
  gridTemplateColumns: "44px 1fr 120px 130px 1.4fr",
  gap: 10,
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: "rgba(15,23,42,0.65)",
  background: "rgba(15,23,42,0.03)",
  borderBottom: "1px solid rgba(15,23,42,0.08)",
},
moneyboardBreakdown: {
  marginTop: 4,
  fontSize: 10,                 // smaller
  fontWeight: 600,              // lighter
  color: "rgba(15,23,42,0.50)",  // softer color
  display: "flex",
  flexDirection: "column",
  gap: 1,
  lineHeight: "14px",
},
lbRow: {
  display: "grid",
  gridTemplateColumns: "44px 1fr 120px 130px 1.4fr",
  gap: 10,
  alignItems: "center",
  padding: "12px 12px",
  borderTop: "1px solid rgba(15,23,42,0.06)",
  background: "rgba(255,255,255,0.92)",
},

lbName: {
  fontWeight: 950,
  color: "#0f172a",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
},

lbValueRight: {
  textAlign: "right",
  fontWeight: 950,
  fontSize: 14,
  color: "#0f172a",
},

lbBoostCell: {
  display: "flex",
  justifyContent: "flex-start",
  flexWrap: "wrap",
  gap: 8,
},
moneyboardHeader: {
  display: "grid",
  gridTemplateColumns: "44px 1fr 120px",
  gap: 10,
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: "rgba(15,23,42,0.65)",
  background: "rgba(15,23,42,0.03)",
  borderBottom: "1px solid rgba(15,23,42,0.08)",
},
moneyboardSub: {
  marginTop: 3,
  fontSize: 11,
  fontWeight: 800,
  color: "rgba(15,23,42,0.60)",
},
moneyboardList: {
  display: "grid",
},

moneyboardRow: {
  display: "grid",
  gridTemplateColumns: "44px 1fr 120px",
  gap: 10,
  alignItems: "center",
  padding: "12px 12px",
  borderTop: "1px solid rgba(15,23,42,0.06)",
  background: "rgba(255,255,255,0.92)",
},

moneyboardRowTop: {
  background: "linear-gradient(180deg, rgba(32,90,40,0.10) 0%, rgba(255,255,255,0.92) 70%)",
},

moneyboardRank: {
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  fontWeight: 950,
  fontSize: 20,          // makes medals look good
  background: "transparent",
  border: "none",
},

moneyboardName: {
  fontWeight: 950,
  color: "#0f172a",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
},

moneyboardAmt: {
  textAlign: "right",
  fontWeight: 950,
  fontSize: 14,
  color: "#0f172a",
},
standingsName: {
  fontWeight: 950,
  fontSize: 12,
  color: "rgba(15,23,42,0.92)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
},

standingsRight: {
  textAlign: "right",
  flex: "0 0 auto",
},

standingsPrimary: {
  fontWeight: 950,
  fontSize: 12,
  color: "rgba(15,23,42,0.92)",
},

standingsSecondary: {
  marginTop: 2,
  fontSize: 11,
  fontWeight: 800,
  color: "rgba(15,23,42,0.60)",
},

// no pill/chip — just subtle text
leaderChip: {
  marginLeft: 8,
  fontSize: 10,
  fontWeight: 950,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  color: THEME.green,
},

standingsFooter: {
  padding: "9px 12px",
  fontSize: 11,
  fontWeight: 800,
  color: "rgba(15,23,42,0.60)",
  borderTop: "1px solid rgba(15,23,42,0.08)",
},

card: {
  background: "#f8fafc",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  boxShadow: "0 18px 45px rgba(0,0,0,0.35)",
  padding: 14,
  color: "#0f172a", // ✅ makes text readable inside cards
},
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    paddingBottom: 10,
    marginBottom: 10,
    borderBottom: "1px solid rgba(15,23,42,0.08)",
  },
  cardTitle: { fontWeight: 950, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, color: "#0f172a" },
  cardSubtitle: { marginTop: 4, fontSize: 12, color: "rgba(15,23,42,0.7)", fontWeight: 700 },

  clamp2: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
playerPickLine: {
  outline: "2px solid rgba(59,130,246,0.35)",
  borderRadius: 10,
  padding: "4px 6px",
  background: "rgba(59,130,246,0.10)",
},

playerPickCorrect: {
  outline: "2px solid rgba(34,197,94,0.40)",
  background: "rgba(34,197,94,0.12)",
},

playerPickWrong: {
  outline: "2px solid rgba(239,68,68,0.35)",
  background: "rgba(239,68,68,0.10)",
},
  teamWinner: {
    color: THEME.green,
    fontWeight: 950,
    background: "rgba(21,128,61,0.10)",
    border: "1px solid rgba(21,128,61,0.20)",
    borderRadius: 10,
    padding: "4px 6px",
  },
  teamLoser: {
    textDecoration: "line-through",
    opacity: 0.65,
  },
pillYellow: {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 950,
  border: "1px solid rgba(234,179,8,0.45)",      // amber border
  background: "rgba(234,179,8,0.18)",            // amber bg
  color: "#92400e",                               // dark amber text
  whiteSpace: "nowrap",
},
  pill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid rgba(15,23,42,0.10)",
    background: "rgba(15,23,42,0.03)",
    color: "#0f172a",
    whiteSpace: "nowrap",
  },
  pillGreen: {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 950,
  border: "1px solid rgba(16,185,129,0.45)",
  background: "rgba(16,185,129,0.18)",
  color: "#22c55e",
  whiteSpace: "nowrap",
},
  pillRed: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.10)",
    color: "#7f1d1d",
    whiteSpace: "nowrap",
  },
  pillBlue: {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 950,
  border: "1px solid rgba(59,130,246,0.45)",
  background: "rgba(59,130,246,0.18)",
  color: "#60a5fa",
  whiteSpace: "nowrap",
},
  pillOnGreen: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.95)",
    whiteSpace: "nowrap",
  },
  pillGreenOnGreen: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    border: "1px solid rgba(34,197,94,0.32)",
    background: "rgba(34,197,94,0.14)",
    color: "rgba(240,253,244,0.98)",
    whiteSpace: "nowrap",
  },
  pillRedOnGreen: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    border: "1px solid rgba(239,68,68,0.30)",
    background: "rgba(239,68,68,0.16)",
    color: "rgba(254,242,242,0.98)",
    whiteSpace: "nowrap",
  },
  pillBlueOnGreen: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    border: "1px solid rgba(59,130,246,0.30)",
    background: "rgba(59,130,246,0.16)",
    color: "rgba(239,246,255,0.98)",
    whiteSpace: "nowrap",
  },

  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    outline: "none",
    fontSize: 14,
    marginTop: 8,
    background: "white",
    boxSizing: "border-box",
  },
  inputTight: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    outline: "none",
    fontSize: 13,
    background: "white",
    fontWeight: 800,
    boxSizing: "border-box",
  },
  select: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "white",
    fontWeight: 800,
    cursor: "pointer",
  },
  btnDark: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#0f172a",
    color: "white",
    fontWeight: 950,
    cursor: "pointer",
  },
  btnGhost: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.14)",
    background: "rgba(15,23,42,0.03)",
    color: "#0f172a",
    fontWeight: 950,
    cursor: "pointer",
  },

  helpText: { fontSize: 12, color: "rgba(15,23,42,0.7)", marginTop: 6, lineHeight: "16px", fontWeight: 700 },
  notice: {
    background: "rgba(15,23,42,0.03)",
    border: "1px solid rgba(15,23,42,0.10)",
    padding: "8px 10px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 900,
  },

  adminGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },

  adminPanel: {
    background: "rgba(15,23,42,0.02)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 14,
    padding: 12,
  },
  fieldLabel: { fontWeight: 950, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "#0f172a" },

  seedRegion: {
    border: "1px solid rgba(15,23,42,0.10)",
    borderRadius: 16,
    background: "rgba(15,23,42,0.02)",
    padding: 12,
  },
  seedRegionTitle: { fontWeight: 950, fontSize: 14, marginBottom: 10 },
  seedGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 },
  seedCell: { display: "grid", gridTemplateColumns: "46px 1fr", gap: 8, alignItems: "center" },
  seedLabel: {
    fontWeight: 950,
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.10)",
    borderRadius: 12,
    padding: "8px 8px",
    textAlign: "center",
  },

twoCol: {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "1fr",
},

twoColDesktop: {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "1fr 360px",
},

  sectionTitle: {
  fontWeight: 950,
  fontSize: 18,
  marginTop: 0,
  color: "#0f172a",                 // ✅ dark readable
  letterSpacing: 0.2,
},

sectionSub: {
  color: "rgba(15,23,42,0.70)",      // ✅ dark muted
  fontSize: 12,
  marginTop: 6,
  fontWeight: 800,
},

  betCard: {
    background: "#FFFFFF",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.06)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
    overflow: "hidden",
    color: "#0f172a",
  },

  betCardHot: {
    boxShadow: "0 14px 34px rgba(21,128,61,0.12), 0 12px 26px rgba(2,6,23,0.08)",
    border: "1px solid rgba(21,128,61,0.25)",
  },
  betCardTop: {
  position: "relative",     // ✅ anchors the sheen
  overflow: "hidden",       // ✅ keeps sheen inside the card
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 12px",
  cursor: "pointer",
  userSelect: "none",
},
  betCardTopSheen: {
  position: "absolute",
  inset: 0,
  background:
    "linear-gradient(110deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 38%, rgba(255,255,255,0.00) 70%)",
  pointerEvents: "none",
},
  betTitle: { fontWeight: 950, color: "#0f172a", fontSize: 14 },
  betMeta: { marginTop: 4, fontSize: 12, color: "rgba(15,23,42,0.75)", fontWeight: 700 },

  collapse: {
    overflow: "hidden",
    transition: "max-height 300ms ease, opacity 240ms ease, transform 240ms ease, padding 240ms ease, border-width 240ms ease",
    borderTopStyle: "solid",
    borderTopColor: "rgba(15,23,42,0.08)",
    paddingLeft: 12,
    paddingRight: 12,
    willChange: "max-height, opacity, transform",
  },

  betBodyInner: { paddingBottom: 4 },

  expandHeader: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 10 },
  expandWinnersTitle: { fontWeight: 950, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  expandWinnersText: { marginTop: 4, fontWeight: 800, color: "#0f172a" },
  expandWinnersTextMuted: { marginTop: 4, fontWeight: 800, color: "rgba(15,23,42,0.55)" },

  callout: {
    background: "linear-gradient(180deg, rgba(21,128,61,0.10) 0%, rgba(21,128,61,0.06) 100%)",
    border: "1px solid rgba(21,128,61,0.18)",
    padding: "10px 12px",
    borderRadius: 14,
    marginBottom: 10,
    color: "#0f172a",
  },

  gameRow: {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 10px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.03)",
},
gameDividerPremium: {
  height: 1,
  margin: "12px 0",
  background: "linear-gradient(to right, transparent, rgba(15,23,42,0.18), transparent)",
},

upsetTag: {
  marginLeft: 10,
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: 0.6,
  color: "#C72B32",
},

pickersLabel: {
  fontSize: 11,
  fontWeight: 950,
  opacity: 0.7,
  textTransform: "uppercase",
  letterSpacing: 0.6,
},

pickersValue: {
  marginTop: 4,
  fontSize: 12,
  fontWeight: 900,
},
  gameLeft: { minWidth: 0 },
  gameId: { fontWeight: 950, fontSize: 12, color: "#0f172a" },
  gameMatchup: { marginTop: 2, fontSize: 13, color: "rgba(15,23,42,0.80)", fontWeight: 700 },
  gameRight: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" },

  rankRow: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 10px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.03)",
},
  rankLeft: { display: "flex", alignItems: "center", gap: 10 },
  rankNum: {
    width: 28,
    height: 28,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    fontWeight: 950,
    background: "rgba(15,23,42,0.06)",
  },
  rankName: { fontWeight: 900 },
  rankAmt: { fontWeight: 950 },

  pointsHeaderRow: {
    display: "grid",
    gridTemplateColumns: "44px 1fr 110px 120px 1.3fr",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.03)",
    fontSize: 12,
    fontWeight: 950,
    color: "rgba(15,23,42,0.85)",
  },
  leaderGrid: {
  display: "grid",
  gap: 10,
  marginTop: 10,
},

leaderHeader: {
  display: "grid",
  gridTemplateColumns: "52px 1fr 120px 130px 1.4fr",
  gap: 10,
  padding: "12px 12px",
  borderRadius: 16,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.70)",
  fontSize: 12,
  fontWeight: 950,
  color: "rgba(15,23,42,0.80)",
},

leaderRow: {
  display: "grid",
  gridTemplateColumns: "52px 1fr 120px 130px 1.4fr",
  gap: 10,
  padding: "12px 12px",
  borderRadius: 16,
  border: "1px solid rgba(15,23,42,0.10)",
  background: "rgba(255,255,255,0.92)",
  alignItems: "center",
  boxShadow: "0 10px 22px rgba(2,6,23,0.06)",
},

leaderRankBadge: {
  width: 34,
  height: 34,
  borderRadius: 12,
  display: "grid",
  placeItems: "center",
  fontWeight: 950,
  background: "rgba(32,90,40,0.10)",     // theme green tint
  border: "1px solid rgba(32,90,40,0.18)",
  color: "#205A28",
},

leaderName: {
  fontWeight: 950,
  fontSize: 14,
  color: "#0f172a",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
},

leaderSub: {
  marginTop: 2,
  fontSize: 12,
  fontWeight: 800,
  color: "rgba(15,23,42,0.62)",
},

leaderValueBig: {
  fontWeight: 950,
  fontSize: 18,
  textAlign: "right",
  color: "#0f172a",
},

leaderRight: {
  display: "flex",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 8,
},
  pointsRow: {
    display: "grid",
    gridTemplateColumns: "44px 1fr 110px 120px 1.3fr",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
    alignItems: "center",
  },
  pointsColRank: { display: "flex", alignItems: "center", justifyContent: "center" },
  pointsColName: { minWidth: 0 },
  pointsColNow: { textAlign: "right" },
  pointsColRemain: { textAlign: "right" },
  pointsColBoost: { display: "flex", justifyContent: "flex-start" },
  pointsBig: { fontWeight: 950, fontSize: 16 },

  moneyRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
  },
  moneyLeft: { display: "flex", alignItems: "center", gap: 10 },
  moneyName: { fontWeight: 950, fontSize: 14 },
  moneyRight: { textAlign: "right" },
  moneyTotal: { fontWeight: 950, fontSize: 16 },
  moneySub: { fontSize: 12, color: "rgba(15,23,42,0.72)", marginTop: 2, fontWeight: 800 },

  bracketGameHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
  },
  bracketGameTitle: { fontWeight: 950, fontSize: 13 },
  bracketGameMatchup: { marginTop: 4, fontWeight: 800, color: "rgba(15,23,42,0.78)" },

  pickTableHeader: {
    display: "grid",
    gridTemplateColumns: "1.1fr 1.3fr 160px",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.03)",
    fontSize: 12,
    fontWeight: 950,
    color: "rgba(15,23,42,0.85)",
    marginTop: 10,
  },
  pickRow: {
    display: "grid",
    gridTemplateColumns: "1.1fr 1.3fr 160px",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(15,23,42,0.08)",
    background: "rgba(15,23,42,0.02)",
    alignItems: "center",
  },
  pickColName: { minWidth: 0 },
  pickColPick: { minWidth: 0 },
  pickColStatus: { display: "flex", justifyContent: "flex-end" },

  teamSection: {
    border: "1px solid rgba(15,23,42,0.10)",
    borderRadius: 16,
    background: "rgba(15,23,42,0.02)",
    padding: 12,
  },
  teamSectionTitle: { fontWeight: 950, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.85 },
};

/* =========================
   UI HELPERS
========================= */
function tabPill(active) {
  return {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: active ? "rgba(16,185,129,0.14)" : "rgba(15,23,42,0.03)",
    fontWeight: 950,
    fontSize: 12,
    cursor: "pointer",
  };
}

function topTab(active) {
  return {
    padding: "10px 12px",
    borderRadius: 999,
    border: active ? "1px solid rgba(20,83,45,0.30)" : "1px solid rgba(15,23,42,0.14)",
    background: active ? "rgba(20,83,45,0.10)" : "rgba(15,23,42,0.03)",
    color: active ? "#14532d" : "rgba(15,23,42,0.88)",
    cursor: "pointer",
    fontWeight: 950,
    fontSize: 12,
    letterSpacing: 0.2,
    boxShadow: active ? "0 8px 14px rgba(20,83,45,0.10)" : "none",
    transition: "transform 120ms ease, background 120ms ease, box-shadow 120ms ease",
  };
}