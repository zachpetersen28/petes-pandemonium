// src/app/api/state/route.js
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Admin cookie auth (signed token)
 */
function sign(value) {
  const secret = process.env.ADMIN_COOKIE_SECRET || "dev_secret";
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

async function isAdminRequest() {
  const jar = await cookies();
  const token = jar.get("pp_admin")?.value;
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [val, sig] = parts;
  return sig === sign(val);
}

/**
 * Helpers
 */
function safeStr(x) {
  return String(x ?? "").trim();
}

function gameRowToStateGame(row, winnerName) {
  const sources =
    row.source_game_a != null && row.source_game_b != null
      ? [Number(row.source_game_a), Number(row.source_game_b)]
      : null;

  const teamAName = row.team_a_name ? String(row.team_a_name) : "TBD";
  const teamBName = row.team_b_name ? String(row.team_b_name) : "TBD";

  return {
    id: Number(row.id),
    day: Number(row.day),

    // ✅ NEW: played order (per-day chronological order)
    playedOrder: row.played_order == null ? null : Number(row.played_order),

    round: String(row.round),
    slot: { region: String(row.region), label: String(row.label) },
    sources,
    // UI compatibility (not stored in DB)
    espnGameId: "",
    teams: [
      { name: teamAName, seed: row.team_a_seed == null ? null : Number(row.team_a_seed) },
      { name: teamBName, seed: row.team_b_seed == null ? null : Number(row.team_b_seed) },
    ],
    winnerName: winnerName ? String(winnerName) : "",
  };
}

async function loadDbState(supabase) {
  // 1) Load pp_state (seedTeamsByRegion + finalGameTotalPoints)
  const { data: stateRow, error: stateErr } = await supabase
    .from("pp_state")
    .select("id,state")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (stateErr) throw new Error(`pp_state read failed: ${stateErr.message}`);

  const rawState = stateRow?.state || {};
  const seedTeamsByRegion = rawState.seedTeamsByRegion || {
    East: {},
    West: {},
    South: {},
    Midwest: {},
  };
  const finalGameTotalPoints = rawState.finalGameTotalPoints ?? "";

  // 2) Load games + results
  const { data: gameRows, error: gamesErr } = await supabase
    .from("pp_games")
    .select(
      // ✅ NEW: include played_order
      "id,day,round,region,label,source_game_a,source_game_b,team_a_name,team_a_seed,team_b_name,team_b_seed,played_order"
    )
    .order("id", { ascending: true });

  if (gamesErr) throw new Error(`pp_games read failed: ${gamesErr.message}`);

  const { data: resultRows, error: resultsErr } = await supabase
    .from("pp_results")
    .select("game_id,winner_name");

  if (resultsErr) throw new Error(`pp_results read failed: ${resultsErr.message}`);

  const winnerByGameId = new Map((resultRows || []).map((r) => [Number(r.game_id), r.winner_name]));
  const games =
    (gameRows || []).map((row) => gameRowToStateGame(row, winnerByGameId.get(Number(row.id)))) || [];

  // 3) Load players + picks
  const { data: playerRows, error: playersErr } = await supabase
    .from("pp_players")
    .select("id,name,tiebreaker_total_points")
    .order("name", { ascending: true });

  if (playersErr) throw new Error(`pp_players read failed: ${playersErr.message}`);

  const { data: pickRows, error: picksErr } = await supabase
    .from("pp_picks")
    .select("player_id,game_id,pick_name");

  if (picksErr) throw new Error(`pp_picks read failed: ${picksErr.message}`);

  const picksByPlayerId = new Map();
  for (const r of pickRows || []) {
    const pid = Number(r.player_id);
    if (!picksByPlayerId.has(pid)) picksByPlayerId.set(pid, {});
    picksByPlayerId.get(pid)[Number(r.game_id)] = String(r.pick_name);
  }

  const brackets = (playerRows || []).map((p) => ({
    name: String(p.name),
    picks: picksByPlayerId.get(Number(p.id)) || {},
    tiebreaker: p.tiebreaker_total_points == null ? null : Number(p.tiebreaker_total_points),
  }));

  return {
    games,
    brackets,
    seedTeamsByRegion,
    finalGameTotalPoints: String(finalGameTotalPoints ?? ""),
  };
}

async function saveDbStateFromPayload(supabase, payloadState) {
  const seedTeamsByRegion = payloadState.seedTeamsByRegion || {
    East: {},
    West: {},
    South: {},
    Midwest: {},
  };
  const finalGameTotalPoints = payloadState.finalGameTotalPoints ?? "";

  // 1) Upsert pp_state row (id=1)
  {
    const { error } = await supabase.from("pp_state").upsert(
      {
        id: 1,
        state: { seedTeamsByRegion, finalGameTotalPoints },
      },
      { onConflict: "id" }
    );
    if (error) throw new Error(`pp_state upsert failed: ${error.message}`);
  }

  // 2) Upsert pp_games from payload
  const incomingGames = Array.isArray(payloadState.games) ? payloadState.games : [];
  if (incomingGames.length) {
    const rows = incomingGames.map((g) => ({
      id: Number(g.id),
      day: Number(g.day),

      // ✅ NEW: persist played order
      played_order: g.playedOrder == null || g.playedOrder === "" ? null : Number(g.playedOrder),

      round: String(g.round || ""),
      region: String(g?.slot?.region || ""),
      label: String(g?.slot?.label || ""),
      source_game_a: Array.isArray(g.sources) ? Number(g.sources[0]) : null,
      source_game_b: Array.isArray(g.sources) ? Number(g.sources[1]) : null,
      team_a_name: g?.teams?.[0]?.name && g.teams[0].name !== "TBD" ? String(g.teams[0].name) : null,
      team_a_seed: g?.teams?.[0]?.seed == null ? null : Number(g.teams[0].seed),
      team_b_name: g?.teams?.[1]?.name && g.teams[1].name !== "TBD" ? String(g.teams[1].name) : null,
      team_b_seed: g?.teams?.[1]?.seed == null ? null : Number(g.teams[1].seed),
    }));

    const { error } = await supabase.from("pp_games").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`pp_games upsert failed: ${error.message}`);
  }

  // 3) Sync results from payload winners
  if (incomingGames.length) {
    const toUpsert = [];
    const toClear = [];

    for (const g of incomingGames) {
      const id = Number(g.id);
      const w = safeStr(g.winnerName);
      if (w) toUpsert.push({ game_id: id, winner_name: w });
      else toClear.push(id);
    }

    if (toUpsert.length) {
      const { error } = await supabase.from("pp_results").upsert(toUpsert, { onConflict: "game_id" });
      if (error) throw new Error(`pp_results upsert failed: ${error.message}`);
    }

    if (toClear.length) {
      const { error } = await supabase.from("pp_results").delete().in("game_id", toClear);
      if (error) throw new Error(`pp_results delete failed: ${error.message}`);
    }
  }

// 4) Sync players + picks from payload brackets
const incomingBrackets = Array.isArray(payloadState.brackets) ? payloadState.brackets : [];

/**
 * ✅ If admin sends brackets: [] (Reset All Brackets),
 * we must clear DB tables or they'll come back on refresh.
 */
if (incomingBrackets.length === 0) {
  // Clear picks first (FK safety), then players
  {
    const { error } = await supabase.from("pp_picks").delete().neq("game_id", -1);
    if (error) throw new Error(`pp_picks clear failed: ${error.message}`);
  }
  {
    const { error } = await supabase.from("pp_players").delete().neq("name", "__never__");
    if (error) throw new Error(`pp_players clear failed: ${error.message}`);
  }

  return true;
}

// Otherwise we are syncing a real brackets payload:

// Upsert players by name
const playerUpserts = incomingBrackets
  .map((b) => ({
    name: safeStr(b.name),
    tiebreaker_total_points: b.tiebreaker == null || b.tiebreaker === "" ? null : Number(b.tiebreaker),
  }))
  .filter((p) => p.name);

if (playerUpserts.length) {
  const { error } = await supabase.from("pp_players").upsert(playerUpserts, { onConflict: "name" });
  if (error) throw new Error(`pp_players upsert failed: ${error.message}`);
}

// Lookup player UUIDs (IMPORTANT: keep them as strings)
const names = playerUpserts.map((p) => p.name);
const { data: idRows, error: idErr } = await supabase
  .from("pp_players")
  .select("id,name")
  .in("name", names);

if (idErr) throw new Error(`pp_players id lookup failed: ${idErr.message}`);

const idByName = new Map((idRows || []).map((r) => [String(r.name), String(r.id)]));

// Build list of player UUIDs we are syncing
const playerIds = [];
for (const b of incomingBrackets) {
  const name = safeStr(b.name);
  if (!name) continue;
  const playerId = idByName.get(name);
  if (playerId) playerIds.push(playerId);
}

// ✅ Delete existing picks for these players first (so removals actually persist)
if (playerIds.length) {
  const { error } = await supabase.from("pp_picks").delete().in("player_id", playerIds);
  if (error) throw new Error(`pp_picks delete failed: ${error.message}`);
}

// Insert fresh picks (player_id is UUID string, game_id is number)
const pickUpserts = [];
for (const b of incomingBrackets) {
  const name = safeStr(b.name);
  if (!name) continue;

  const playerId = idByName.get(name);
  if (!playerId) continue;

  const picksObj = b.picks || {};
  for (const [gid, pickName] of Object.entries(picksObj)) {
    const gameId = Number(gid);
    const pick = safeStr(pickName);
    if (!Number.isFinite(gameId) || !pick) continue;
    pickUpserts.push({ player_id: playerId, game_id: gameId, pick_name: pick });
  }
}

if (pickUpserts.length) {
  const { error } = await supabase.from("pp_picks").upsert(pickUpserts, {
    onConflict: "player_id,game_id",
  });
  if (error) throw new Error(`pp_picks upsert failed: ${error.message}`);
}
}

/**
 * GET: DB -> state (+ isAdmin)
 */
export async function GET() {
  try {
    const supabase = supabaseServer();
    const state = await loadDbState(supabase);
    const isAdmin = await isAdminRequest();

    return NextResponse.json({ ok: true, isAdmin, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

/**
 * POST: Admin-only writeback -> DB (+ isAdmin)
 */
export async function POST(req) {
  try {
    const isAdmin = await isAdminRequest();
    if (!isAdmin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const payloadState = body?.state;
    if (!payloadState) return NextResponse.json({ ok: false, error: "Missing body.state" }, { status: 400 });

    const supabase = supabaseServer();
    await saveDbStateFromPayload(supabase, payloadState);

    const state = await loadDbState(supabase);
    return NextResponse.json({ ok: true, isAdmin: true, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
