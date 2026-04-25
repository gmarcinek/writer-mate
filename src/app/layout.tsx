import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Writer Mate",
  description: "Narzędzie edytorskie dla pisarzy wspomagane przez LLM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
