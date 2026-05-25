import "server-only";

import type { ReaderSessionEventSink } from "@/lib/reader/events";
import type { ReaderLineRange, ReaderSession } from "@/lib/reader/types";
import type { runReaderReconnaissance } from "@/lib/reader/reconnaissance";

export type ToolState = {
  currentCursor: ReaderLineRange | null;
  currentNoteCount: number;
};

export type ToolContext = {
  session: ReaderSession;
  recon: Awaited<ReturnType<typeof runReaderReconnaissance>>;
  model: string;
  emit: ReaderSessionEventSink | undefined;
  state: ToolState;
  persistCursor: (cursor: ReaderLineRange) => Promise<void>;
  startedNewSession: boolean;
};
