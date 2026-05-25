"use client";

import { useTransition, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { uploadBook } from "@/app/actions/books";

export default function UploadBook() {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = params.locale ?? "pl";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await uploadBook(formData);
      formRef.current?.reset();
      router.push(`/${locale}/books/${result.id}`);
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label
        className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-[var(--color-border)] rounded-md p-4 text-sm text-[var(--color-text-muted)] cursor-pointer hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
      >
        <span className="text-lg">📄</span>
        <span>Wybierz plik</span>
        <span className="text-xs opacity-60">.txt .md .epub .pdf .docx</span>
        <input
          type="file"
          name="file"
          accept=".txt,.md,.epub,.pdf,.docx"
          className="hidden"
          disabled={isPending}
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="w-full py-1.5 px-3 rounded-md text-sm font-medium bg-[var(--color-accent)] text-white disabled:opacity-50 hover:bg-[var(--color-accent-dim)] transition-colors"
      >
        {isPending ? "Wysyłanie…" : "Wgraj książkę"}
      </button>
    </form>
  );
}
