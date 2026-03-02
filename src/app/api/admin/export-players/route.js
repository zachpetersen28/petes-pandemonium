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

function numOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
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

    if (!brackets.length) {
      return NextResponse.json({ ok: false, error: "No brackets/players found in /api/state." }, { status: 400 });
    }

    const header = `-- Pete's Pandemonium
-- Exported from /api/admin/export-players (via /api/state)
-- Paste into Supabase SQL Editor and Run
--
-- Populates: public.pp_players
-- Safe to re-run (UPSERT by unique name)
-- Rows: ${brackets.length}
`;

    const rows = brackets
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((b) => {
        const name = sqlEscape(String(b.name || "").trim());
        const tb = numOrNull(b.tiebreaker);
        const tbSql = tb === null ? "NULL" : `${tb}`;
        return `('${name}', ${tbSql})`;
      });

    const sql =
      header +
      `insert into public.pp_players (name, tiebreaker_total_points)
values
  ${rows.join(",\n  ")}
on conflict (name) do update set
  tiebreaker_total_points = excluded.tiebreaker_total_points;
`;

    return new NextResponse(sql, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="pp_players_seed.sql"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
