import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const { theme } = body;

  if (theme !== "light" && theme !== "dark") {
    return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set("theme", theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
    sameSite: "lax",
  });

  return NextResponse.json({ ok: true });
}
