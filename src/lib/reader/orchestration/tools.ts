import "server-only";

import { updateReaderSession } from "@/lib/reader/persistence";
import type { ReaderSessionEventSink } from "@/lib/reader/events";
import type { ReaderLineRange, ReaderSession } from "@/lib/reader/types";
import type { runReaderReconnaissance } from "@/lib/reader/reconnaissance";
import { persistableCursor } from "./utils";
import type { ToolContext, ToolState } from "./tools/context";
import { buildFinishModule } from "./tools/finish";
import { buildNavigationTools } from "./tools/navigation";
import { buildSearchTools } from "./tools/search";
import { buildNotesTools } from "./tools/notes";
import { buildHintsTools } from "./tools/hints";

export async function createReaderTools(args: {
  session: ReaderSession;
  recon: Awaited<ReturnType<typeof runReaderReconnaissance>>;
  model: string;
  noteCount: number;
  startedNewSession: boolean;
  onEvent?: ReaderSessionEventSink;
}) {
  const state: ToolState = {
    currentCursor: persistableCursor(args.session.cursor) ?? null,
    currentNoteCount: args.noteCount,
  };

  const persistCursor = async (cursor: ReaderLineRange) => {
    state.currentCursor = cursor;
    await updateReaderSession({ sessionId: args.session.id, cursor });
  };

  const ctx: ToolContext = {
    session: args.session,
    recon: args.recon,
    model: args.model,
    emit: args.onEvent,
    state,
    persistCursor,
    startedNewSession: args.startedNewSession,
  };

  const { doSynthesisAndFinishWithMaster, finishTool } = buildFinishModule(ctx);
  const navigationTools = buildNavigationTools(ctx);
  const searchTools = buildSearchTools(ctx);
  const notesTools = buildNotesTools(ctx, doSynthesisAndFinishWithMaster);
  const hintsTools = buildHintsTools(ctx);

  return {
    tools: {
      ...navigationTools,
      ...searchTools,
      ...notesTools,
      ...hintsTools,
      finish: finishTool,
    },
    getCursor() {
      return state.currentCursor;
    },
  };
}
