import { getTranslations } from "next-intl/server";

export default async function StatusBar() {
  const t = await getTranslations("StatusBar");
  return (
    <div className="flex items-center justify-between w-full h-full">
      <span className="text-[10px] text-[--color-text-muted]">{t("ready")}</span>
      <span className="text-[10px] text-[--color-text-muted]">v0.1.0</span>
    </div>
  );
}
