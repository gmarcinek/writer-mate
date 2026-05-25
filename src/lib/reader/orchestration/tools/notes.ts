import "server-only";

import { tool } from "ai";
import {
  saveNotes as persistReaderNotes,
  type SaveNotesInput,
} from "@/lib/reader/checkpoint-tools";
import { getReaderSessionArtifacts } from "@/lib/reader/persistence";
import { createReaderSessionEvent } from "@/lib/reader/events";
import { toolNoteToolSchema, noteToolSchema } from "../schemas";
import { isUuid, stripNulls } from "../utils";
import type { ToolContext } from "./context";
import type { ReaderLineRange } from "@/lib/reader/types";

export function buildNotesTools(
  ctx: ToolContext,
  doSynthesisAndFinishWithMaster: (cursor?: ReaderLineRange | null) => Promise<unknown>
) {
  const { session, recon, emit, state } = ctx;

  return {
    saveNotes: tool({
      description:
        "Persist a compact structured reader note with evidence, coverage ranges, and an optional checkpoint. Keep payloads small: concise summary, short bullets, at most 4 evidence items, and avoid long quotations.",
      parameters: toolNoteToolSchema,
      execute: async (input) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "saveNotes",
            input,
          })
        );
        const normalizedToolInput = {
          ...input,
          noteId: isUuid(input.noteId) ? input.noteId : null,
        };
        const normalizedInput = noteToolSchema.parse(stripNulls(normalizedToolInput));
        const existingOrdinal = normalizedInput.noteId
          ? (await getReaderSessionArtifacts(session.id)).notes.find(
              (note) => note.id === normalizedInput.noteId
            )?.ordinal
          : undefined;
        const ordinal = existingOrdinal ?? state.currentNoteCount;
        const payload: SaveNotesInput = {
          ...normalizedInput,
          sessionId: session.id,
          ordinal,
        };
        try {
          const result = await persistReaderNotes(payload);
          if (!normalizedInput.noteId) {
            state.currentNoteCount += 1;
          }
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "saveNotes",
              ok: true,
              result,
            })
          );
          await emit?.(
            createReaderSessionEvent("note_saved", session.id, {
              noteId: result.noteId,
              ordinal,
              status: normalizedInput.status,
              coverageRangeCount: 0,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "saveNotes",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),
  };
}
