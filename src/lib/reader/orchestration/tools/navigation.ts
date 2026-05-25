import "server-only";

import { tool } from "ai";
import { z } from "zod";
import {
  inspectSlice,
  jumpToLine,
  readLines,
  skipLines,
} from "@/lib/reader/navigation-tools";
import { insertCoverageRange } from "@/lib/reader/persistence";
import { createReaderSessionEvent } from "@/lib/reader/events";
import { ReaderCoverageDisposition, ReaderCoverageReason } from "@/lib/reader/types";
import {
  jumpToGapToolSchema,
  jumpToLineToolSchema,
  skipLinesToolSchema,
} from "../schemas";
import {
  getCursorFromReadResult,
  getCursorFromSkipResult,
  findUnvisitedRanges,
} from "../utils";
import type { ToolContext } from "./context";

export function buildNavigationTools(ctx: ToolContext) {
  const { session, emit, state, persistCursor } = ctx;

  return {
    readLines: tool({
      description: "Read an inclusive line range from the current reader source.",
      parameters: z.object({
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
      }),
      execute: async ({ startLine, endLine }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "readLines",
            input: { startLine, endLine },
          })
        );
        try {
          const result = await readLines({
            session: {
              id: session.id,
              source: session.source,
              cursor: state.currentCursor ?? undefined,
            },
            startLine,
            endLine,
          });
          await persistCursor(getCursorFromReadResult(result));
          await insertCoverageRange({
            sessionId: session.id,
            source: session.source,
            startLine: result.startLine,
            endLine: result.endLine,
            disposition: ReaderCoverageDisposition.Read,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "readLines",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "readLines",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "readLines",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),

    jumpToLine: tool({
      description: "Read a bounded window starting from or centered on a target line.",
      parameters: jumpToLineToolSchema,
      execute: async ({ requestedLine, windowLines, placement }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "jumpToLine",
            input: { requestedLine, windowLines, placement },
          })
        );
        try {
          const result = await jumpToLine({
            session: {
              id: session.id,
              source: session.source,
              cursor: state.currentCursor ?? undefined,
            },
            requestedLine,
            windowLines: windowLines ?? undefined,
            placement: placement ?? undefined,
          });
          await persistCursor(getCursorFromReadResult(result));
          await insertCoverageRange({
            sessionId: session.id,
            source: session.source,
            startLine: result.startLine,
            endLine: result.endLine,
            disposition: ReaderCoverageDisposition.Read,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "jumpToLine",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "jumpToLine",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "jumpToLine",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),

    skipLines: tool({
      description: "Advance coverage without reading the skipped lines.",
      parameters: skipLinesToolSchema,
      execute: async ({ count, fromLine }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "skipLines",
            input: { count, fromLine },
          })
        );
        try {
          const result = await skipLines({
            session: {
              id: session.id,
              source: session.source,
              cursor: state.currentCursor ?? undefined,
            },
            count,
            fromLine: fromLine ?? undefined,
          });
          await persistCursor(getCursorFromSkipResult(result));
          await insertCoverageRange({
            sessionId: session.id,
            source: session.source,
            startLine: result.fromLine,
            endLine: result.toLine,
            disposition: ReaderCoverageDisposition.Skipped,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "skipLines",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "skipLines",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "skipLines",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),

    inspectSlice: tool({
      description: "Inspect a bounded character slice with line metadata.",
      parameters: z.object({
        startOffset: z.number().int().min(0),
        endOffset: z.number().int().min(0),
      }),
      execute: async ({ startOffset, endOffset }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "inspectSlice",
            input: { startOffset, endOffset },
          })
        );
        try {
          const result = await inspectSlice({
            session: {
              id: session.id,
              source: session.source,
              cursor: state.currentCursor ?? undefined,
            },
            startOffset,
            endOffset,
          });
          await persistCursor(getCursorFromReadResult(result));
          await insertCoverageRange({
            sessionId: session.id,
            source: session.source,
            startLine: result.startLine,
            endLine: result.endLine,
            startOffset: result.startOffset,
            endOffset: result.endOffset,
            disposition: ReaderCoverageDisposition.Sampled,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "inspectSlice",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "inspectSlice",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "inspectSlice",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),

    jumpToGap: tool({
      description:
        "Jump to one of the currently unvisited ranges derived from the persisted session coverage ledger.",
      parameters: jumpToGapToolSchema,
      execute: async ({ gapIndex, windowLines }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "jumpToGap",
            input: { gapIndex, windowLines },
          })
        );
        try {
          const gapState = await findUnvisitedRanges({
            sessionId: session.id,
            source: session.source,
          });
          if (gapState.gapRanges.length === 0) {
            throw new Error("No unvisited ranges remain for this session.");
          }
          const selectedGapIndex = Math.min(
            Math.max(gapIndex ?? 0, 0),
            gapState.gapRanges.length - 1
          );
          const selectedGap = gapState.gapRanges[selectedGapIndex];
          const jumpResult = await jumpToLine({
            session: {
              id: session.id,
              source: session.source,
              cursor: state.currentCursor ?? undefined,
            },
            requestedLine: selectedGap.startLine,
            windowLines: windowLines ?? undefined,
            placement: "start",
          });
          await persistCursor(getCursorFromReadResult(jumpResult));
          const result = {
            toolName: "jumpToGap" as const,
            selectedGapIndex,
            selectedGap,
            remainingGapCount: gapState.gapRanges.length,
            visitedPercent: gapState.visitedPercent,
            jump: jumpResult,
          };
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "jumpToGap",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "jumpToGap",
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
