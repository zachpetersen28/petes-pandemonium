import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import crypto from "crypto";

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

function sqlEscape(str) {
  return String(str ?? "").replace(/'/g, "''");
}

export async function GET() {
  try {
    const okAdmin = await isAdminRequest();
    if (!okAdmin) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";
    const origin = host ? `${proto}://${host}` : "http://localhost:3000";

    const res = await fetch(`${origin}/api/state`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return NextResponse.json(
        { ok: false, error: data?.error || `Failed to read /api/state (${res.status})` },
        { status: 500 }
      );
    }

    const state = data.state || {};
    const brackets = Array.isArray(state.brackets) ? state.brackets : [];
    const games = Array.isArray(state.games) ? state.games : [];

    if (!brackets.length) {
      return NextResponse.json({ ok: false, error: "No players found in /api/state (state.brackets empty)." }, { status: 400 });
    }
    if (!games.length) {
      return NextResponse.json({ ok: false, error: "No games found in /api/state (state.games empty)." }, { status: 400 });
    }

    // Picks rows: (player_name, game_id, pick_name)
    const pickTuples = [];
    for (const b of brackets) {
      const playerName = String(b.name || "").trim();
      if (!playerName) continue;

      const picks = b.picks || {};
      for (const [gidStr, pickNameRaw] of Object.entries(picks)) {
        const gameId = Number(gidStr);
        const pickName = String(pickNameRaw || "").trim();
        if (!Number.isFinite(gameId) || !pickName) continue;
        pickTuples.push({
          playerName,
          gameId,
          pickName,
        });
      }
    }

    // Results rows: (game_id, winner_name)
    const resultTuples = games
      .filter((g) => String(g.winnerName || "").trim())
      .map((g) => ({
        gameId: Number(g.id),
        winnerName: String(g.winnerName || "").trim(),
      }))
      .filter((r) => Number.isFinite(r.gameId) && r.winnerName);

    const header = `-- Pete's Pandemonium
-- Exported from /api/admin/export-picks-results (via /api/state)
-- Paste into Supabase SQL Editor and Run
--
-- Populates:
--   public.pp_picks   (via player name lookup)
--   public.pp_results (only games with a winnerName)
--
-- Safe to re-run (UPSERT)
-- Picks rows: ${pickTuples.length}
-- Results rows: ${resultTuples.length}
`;

    // Build SQL using player name -> id lookup
    const picksSQL =
      pickTuples.length === 0
        ? `-- No picks to insert\n`
        : `with incoming as (
  select * from (values
    ${pickTuples
      .map((r) => `('${sqlEscape(r.playerName)}', ${r.gameId}, '${sqlEscape(r.pickName)}')`)
      .join(",\n    ")}
  ) as v(player_name, game_id, pick_name)
),
resolved as (
  select p.id as player_id, i.game_id, i.pick_name
  from incoming i
  join public.pp_players p on p.name = i.player_name
)
insert into public.pp_picks (player_id, game_id, pick_name)
select player_id, game_id, pick_name
from resolved
on conflict (player_id, game_id) do update set
  pick_name = excluded.pick_name;
`;

    const resultsSQL =
      resultTuples.length === 0
        ? `-- No results to insert\n`
        : `insert into public.pp_results (game_id, winner_name)
values
  ${resultTuples
    .map((r) => `(${r.gameId}, '${sqlEscape(r.winnerName)}')`)
    .join(",\n  ")}
on conflict (game_id) do update set
  winner_name = excluded.winner_name,
  updated_at = now();
`;

    const sql = header + "\n" + picksSQL + "\n" + resultsSQL;

    return new NextResponse(sql, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="pp_picks_results_seed.sql"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
