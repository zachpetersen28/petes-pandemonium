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

function toIntOrNull(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  try {
    const okAdmin = await isAdminRequest();
    if (!okAdmin) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Build origin from request headers (works on localhost + deployments)
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";
    const origin = host ? `${proto}://${host}` : "http://localhost:3000";

    // Pull from /api/state (the same truth your UI is showing)
    const res = await fetch(`${origin}/api/state`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      return NextResponse.json(
        { ok: false, error: data?.error || `Failed to read /api/state (${res.status})` },
        { status: 500 }
      );
    }

    const state = data.state || {};
    const games = Array.isArray(state.games) ? state.games : [];

    if (!games.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "No games found in /api/state response (state.games is empty).",
          debug: { stateKeys: Object.keys(state || {}) },
        },
        { status: 400 }
      );
    }

    const header = `-- Pete's Pandemonium
-- Exported from /api/admin/export-games (via /api/state)
-- Paste into Supabase SQL Editor and Run
--
-- This populates: public.pp_games
-- Safe to re-run (uses ON CONFLICT DO UPDATE)
-- Rows: ${games.length}
`;

    const rows = games
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((g) => {
        const id = Number(g.id);
        const day = Number(g.day);
        const round = sqlEscape(g.round || "");
        const region = sqlEscape(g?.slot?.region || "");
        const label = sqlEscape(g?.slot?.label || "");

        const sourceA =
          Array.isArray(g.sources) && g.sources.length === 2 ? toIntOrNull(g.sources[0]) : null;
        const sourceB =
          Array.isArray(g.sources) && g.sources.length === 2 ? toIntOrNull(g.sources[1]) : null;

        const tA = g?.teams?.[0] || {};
        const tB = g?.teams?.[1] || {};

        const aName = tA?.name && tA.name !== "TBD" ? sqlEscape(tA.name) : "";
        const bName = tB?.name && tB.name !== "TBD" ? sqlEscape(tB.name) : "";

        const aSeed = toIntOrNull(tA?.seed);
        const bSeed = toIntOrNull(tB?.seed);

        const aNameSql = aName ? `'${aName}'` : "NULL";
        const bNameSql = bName ? `'${bName}'` : "NULL";
        const aSeedSql = aSeed !== null ? `${aSeed}` : "NULL";
        const bSeedSql = bSeed !== null ? `${bSeed}` : "NULL";
        const sourceASql = sourceA !== null ? `${sourceA}` : "NULL";
        const sourceBSql = sourceB !== null ? `${sourceB}` : "NULL";

        // Optional comment per row for readability
        const comment = `-- ${matchupLabel(g)}`;

        return `${comment}\n(${id}, ${day}, '${round}', '${region}', '${label}', ${sourceASql}, ${sourceBSql}, ${aNameSql}, ${aSeedSql}, ${bNameSql}, ${bSeedSql})`;
      });

    const sql =
      header +
      `insert into public.pp_games
  (id, day, round, region, label, source_game_a, source_game_b, team_a_name, team_a_seed, team_b_name, team_b_seed)
values
  ${rows.join(",\n  ")}
on conflict (id) do update set
  day = excluded.day,
  round = excluded.round,
  region = excluded.region,
  label = excluded.label,
  source_game_a = excluded.source_game_a,
  source_game_b = excluded.source_game_b,
  team_a_name = excluded.team_a_name,
  team_a_seed = excluded.team_a_seed,
  team_b_name = excluded.team_b_name,
  team_b_seed = excluded.team_b_seed;
`;

    return new NextResponse(sql, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="pp_games_seed.sql"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
