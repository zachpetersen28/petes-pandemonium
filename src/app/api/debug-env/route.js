import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    urlPreview: (process.env.NEXT_PUBLIC_SUPABASE_URL || "").slice(0, 30),
    keyPreview: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").slice(0, 10),
  });
}
