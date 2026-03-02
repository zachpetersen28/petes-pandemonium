import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_SECRET = process.env.ADMIN_COOKIE_SECRET || "dev_secret";

function sign(value) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(value).digest("hex");
}

function verify(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [val, sig] = parts;
  return sign(val) === sig;
}

export async function GET() {
  try {
    const store = await cookies();
    const token = store.get("pp_admin")?.value || "";
    const isAdmin = verify(token);

    return NextResponse.json({ ok: true, isAdmin });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || "me failed" }, { status: 500 });
  }
}
