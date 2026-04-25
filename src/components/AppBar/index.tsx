import { getTranslations } from "next-intl/server";
import ThemeToggle from "@/components/ThemeToggle";

export default async function AppBar() {
  const t = await getTranslations("AppBar");
  return (
    <div className="flex items-center justify-between w-full h-full">
      <span className="text-sm font-semibold text-[--color-foreground]">
        {t("title")}
      </span>
      <ThemeToggle />
    </div>
  );
}
