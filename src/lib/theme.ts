import { cookies } from "next/headers";

export type Theme = "light" | "dark";

export async function getTheme(): Promise<Theme> {
  const cookieStore = await cookies();
  const value = cookieStore.get("theme")?.value;
  return value === "light" || value === "dark" ? value : "light";
}
