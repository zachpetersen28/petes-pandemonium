import { NextResponse } from "next/server";
import crypto from "crypto";

function sign(value) {
  const secret = process.env.ADMIN_COOKIE_SECRET || "dev_secret";
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const passcode = String(body?.passcode ?? "").trim();

    const adminPass = process.env.ADMIN_PASSCODE || "";
    if (!adminPass) {
      return NextResponse.json(
        { ok: false, error: "Server missing ADMIN_PASSCODE" },
        { status: 500 }
      );
    }

    if (!passcode || passcode !== adminPass) {
      return NextResponse.json(
        { ok: false, error: "Invalid admin passcode" },
        { status: 401 }
      );
    }

    const val = "admin";
    const token = `${val}.${sign(val)}`;

    const res = NextResponse.json({ ok: true });

    res.cookies.set("pp_admin", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14, // 14 days
    });

    return res;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
