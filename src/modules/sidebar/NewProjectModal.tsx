"use client";

import { useTransition, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { uploadBook } from "@/app/actions/books";

export default function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = params.locale ?? "pl";

  function processFile(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const result = await uploadBook(formData);
      onClose();
      router.push(`/${locale}/books/${result.id}`);
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface)] rounded-lg p-6 w-96 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-[var(--color-foreground)]">Nowy projekt</h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-foreground)] transition-colors"
          >
            ✕
          </button>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={[
            "border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors select-none",
            isDragging
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
              : "border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)]",
            isPending ? "opacity-50 pointer-events-none" : "",
          ].join(" ")}
        >
          <span className="text-4xl">{isPending ? "⏳" : "📄"}</span>
          <p className="text-sm font-medium text-[var(--color-foreground)]">
            {isPending ? "Wgrywanie…" : "Przeciągnij plik lub kliknij"}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">.txt .md .epub .pdf .docx</p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".txt,.md,.epub,.pdf,.docx"
            onChange={handleFileChange}
          />
        </div>
      </div>
    </div>
  );
}
