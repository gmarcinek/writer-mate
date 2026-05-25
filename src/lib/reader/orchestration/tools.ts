import "server-only";

import { tool } from "ai";
import { z } from "zod";
import {
  finish as finishReaderSession,
  saveNotes as persistReaderNotes,
  type SaveNotesInput,
} from "@/lib/reader/checkpoint-tools";
import {
  inspectSlice,
  jumpToLine,
  readLines,
  skipLines,
} from "@/lib/reader/navigation-tools";
import {
  getReaderSession,
  getReaderSessionArtifacts,
  insertCoverageRange,
  saveReaderHandoff,
  updateReaderSession,
} from "@/lib/reader/persistence";
import {
  createReaderSessionEvent,
  type ReaderSessionEventSink,
} from "@/lib/reader/events";
import {
  ReaderCoverageDisposition,
  ReaderCoverageReason,
  ReaderSessionStatus,
  type ReaderLineRange,
  type ReaderSession,
} from "@/lib/reader/types";
import type { runReaderReconnaissance } from "@/lib/reader/reconnaissance";
import {
  jumpToGapToolSchema,
  jumpToLineToolSchema,
  searchPhrasesToolSchema,
  skipLinesToolSchema,
  finishToolSchema,
  toolNoteToolSchema,
  noteToolSchema,
} from "./schemas";
import {
  getCursorFromReadResult,
  getCursorFromSkipResult,
  isTerminalStatus,
  isUuid,
  normalizeEvidence,
  persistableCursor,
  searchSourcePhrases,
  findUnvisitedRanges,
  stripNulls,
  summarizeCoverageLedger,
} from "./utils";
import { synthesizeHandoff } from "./synthesis";
import { updateMasterHandoff } from "./synthesis";

export async function createReaderTools(args: {
  session: ReaderSession;
  recon: Awaited<ReturnType<typeof runReaderReconnaissance>>;
  model: string;
  noteCount: number;
  startedNewSession: boolean;
  onEvent?: ReaderSessionEventSink;
}) {
  let currentCursor = persistableCursor(args.session.cursor) ?? null;
  let currentNoteCount = args.noteCount;
  const emit = args.onEvent;

  const persistCursor = async (cursor: ReaderLineRange) => {
    currentCursor = cursor;
    await updateReaderSession({
      sessionId: args.session.id,
      cursor,
    });
  };

  const doSynthesisAndFinish = async (cursorArg?: ReaderLineRange | null) => {
    const artifactsForSynthesis = await getReaderSessionArtifacts(args.session.id);
    const finalCursor = cursorArg ?? currentCursor ?? undefined;

    if (artifactsForSynthesis.notes.length === 0) {
      await updateReaderSession({
        sessionId: args.session.id,
        status: ReaderSessionStatus.Partial,
        cursor: finalCursor ?? null,
      });
      await emit?.(
        createReaderSessionEvent("status", args.session.id, {
          status: ReaderSessionStatus.Partial,
          phase: "terminal",
          message: "Session closed — no notes were saved.",
          startedNewSession: args.startedNewSession,
        })
      );
      return {
        sessionId: args.session.id,
        status: ReaderSessionStatus.Partial as "complete" | "partial",
        handoffId: "",
        savedAt: new Date().toISOString(),
        uncoveredRanges: [] as ReaderLineRange[],
      };
    }

    await updateReaderSession({
      sessionId: args.session.id,
      status: ReaderSessionStatus.Synthesizing,
      cursor: finalCursor ?? null,
    });

    await emit?.(
      createReaderSessionEvent("thinking", args.session.id, {
        stage: "synthesis",
        message: "Reading complete; synthesizing the persisted notes into a handoff.",
      })
    );
    await emit?.(
      createReaderSessionEvent("status", args.session.id, {
        status: ReaderSessionStatus.Synthesizing,
        phase: "synthesis",
        message: "Reader session is synthesizing the final handoff.",
        startedNewSession: args.startedNewSession,
      })
    );

    const coverageSummary = summarizeCoverageLedger(
      args.recon.stats.totalLines,
      artifactsForSynthesis.coverage
    );
    const normalizedEvidence = normalizeEvidence(artifactsForSynthesis.notes);
    const synthesis = await synthesizeHandoff({
      session: args.session,
      recon: args.recon,
      notes: artifactsForSynthesis.notes,
      coverageSummary,
      model: args.model,
    });
    const handoff = await saveReaderHandoff({
      sessionId: args.session.id,
      status: synthesis.draft.status,
      executiveSummary: synthesis.draft.executiveSummary,
      conclusions: synthesis.draft.conclusions.map((item) => ({
        ...item,
        statementKind: item.statementKind,
      })),
      gaps: synthesis.draft.gaps,
      caveats: synthesis.draft.caveats,
      limitations: synthesis.draft.limitations,
      nextQuestions: synthesis.draft.nextQuestions,
      evidence: normalizedEvidence,
      coverageSummary,
    });

    await emit?.(
      createReaderSessionEvent("handoff_ready", args.session.id, {
        handoffId: handoff.id,
        status: handoff.status,
        executiveSummary: handoff.executiveSummary,
        coverageSummary: handoff.coverageSummary,
      })
    );

    return await finishReaderSession({
      sessionId: args.session.id,
      cursor: finalCursor,
    });
  };

  const doSynthesisAndFinishWithMaster = async (cursorArg?: ReaderLineRange | null) => {
    const finishResult = await doSynthesisAndFinish(cursorArg);

    const masterBookId = args.session.source.bookId;
    if (masterBookId) {
      try {
        await updateMasterHandoff(masterBookId, args.model);
      } catch {
        // non-fatal
      }
    }

    return finishResult;
  };

  const tools = {
    readLines: tool({
      description: "Read an inclusive line range from the current reader source.",
      parameters: z.object({
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
      }),
      execute: async ({ startLine, endLine }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "readLines",
            input: { startLine, endLine },
          })
        );
        try {
          const result = await readLines({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            startLine,
            endLine,
          });
          await persistCursor(getCursorFromReadResult(result));
          await insertCoverageRange({
            sessionId: args.session.id,
            source: args.session.source,
            startLine: result.startLine,
            endLine: result.endLine,
            disposition: ReaderCoverageDisposition.Read,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "readLines",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "readLines",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
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
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "jumpToLine",
            input: { requestedLine, windowLines, placement },
          })
        );
        try {
          const result = await jumpToLine({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            requestedLine,
            windowLines: windowLines ?? undefined,
            placement: placement ?? undefined,
          });
          await persistCursor(getCursorFromReadResult(result));
          await insertCoverageRange({
            sessionId: args.session.id,
            source: args.session.source,
            startLine: result.startLine,
            endLine: result.endLine,
            disposition: ReaderCoverageDisposition.Read,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "jumpToLine",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "jumpToLine",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
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
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "skipLines",
            input: { count, fromLine },
          })
        );
        try {
          const result = await skipLines({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            count,
            fromLine: fromLine ?? undefined,
          });
          await persistCursor(getCursorFromSkipResult(result));
          await insertCoverageRange({
            sessionId: args.session.id,
            source: args.session.source,
            startLine: result.fromLine,
            endLine: result.toLine,
            disposition: ReaderCoverageDisposition.Skipped,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "skipLines",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "skipLines",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
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
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "inspectSlice",
            input: { startOffset, endOffset },
          })
        );
        try {
          const result = await inspectSlice({
            session: {
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
            },
            startOffset,
            endOffset,
          });
          await persistCursor(getCursorFromReadResult(result));
          await insertCoverageRange({
            sessionId: args.session.id,
            source: args.session.source,
            startLine: result.startLine,
            endLine: result.endLine,
            startOffset: result.startOffset,
            endOffset: result.endOffset,
            disposition: ReaderCoverageDisposition.Sampled,
            reason: ReaderCoverageReason.SequentialRead,
            toolName: "inspectSlice",
          });
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "inspectSlice",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "inspectSlice",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),
    searchPhrases: tool({
      description:
        "Find lexical phrase matches in the current source and return local line context around each hit.",
      parameters: searchPhrasesToolSchema,
      execute: async ({ query, maxHits, contextLines }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "searchPhrases",
            input: { query, maxHits, contextLines },
          })
        );
        try {
          const result = await searchSourcePhrases({
            source: args.session.source,
            query,
            maxHits: maxHits ?? undefined,
            contextLines: contextLines ?? undefined,
          });
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "searchPhrases",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "searchPhrases",
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
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "jumpToGap",
            input: { gapIndex, windowLines },
          })
        );
        try {
          const gapState = await findUnvisitedRanges({
            sessionId: args.session.id,
            source: args.session.source,
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
              id: args.session.id,
              source: args.session.source,
              cursor: currentCursor ?? undefined,
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
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "jumpToGap",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "jumpToGap",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),
    saveNotes: tool({
      description:
        "Persist a compact structured reader note with evidence, coverage ranges, and an optional checkpoint. Keep payloads small: concise summary, short bullets, at most 4 evidence items, and avoid long quotations.",
      parameters: toolNoteToolSchema,
      execute: async (input) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
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
          ? (await getReaderSessionArtifacts(args.session.id)).notes.find(
              (note) => note.id === normalizedInput.noteId
            )?.ordinal
          : undefined;
        const ordinal = existingOrdinal ?? currentNoteCount;
        const payload: SaveNotesInput = {
          ...normalizedInput,
          sessionId: args.session.id,
          ordinal,
        };
        try {
          const result = await persistReaderNotes(payload);
          if (!normalizedInput.noteId) {
            currentNoteCount += 1;
          }
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "saveNotes",
              ok: true,
              result,
            })
          );
          await emit?.(
            createReaderSessionEvent("note_saved", args.session.id, {
              noteId: result.noteId,
              ordinal,
              status: normalizedInput.status,
              coverageRangeCount: 0,
            })
          );
          // Auto-finish: if the reading head is at or past the end of the source,
          // synthesize and close the session immediately without waiting for the model.
          const atEof =
            currentCursor != null &&
            currentCursor.endLine >= args.recon.stats.totalLines;
          if (atEof) {
            try {
              await doSynthesisAndFinishWithMaster(currentCursor);
            } catch {
              // Auto-finish failure is non-fatal for the note save; the model can still call finish() manually.
            }
          }
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "saveNotes",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),
    finish: tool({
      description:
        "Signal that reading is complete. The server will synthesize a final handoff and close the session.",
      parameters: finishToolSchema,
      execute: async ({ cursor }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", args.session.id, {
            toolName: "finish",
            input: { cursor },
          })
        );
        // Guard against double-finish (e.g. auto-finish already ran inside saveNotes)
        const currentSession = await getReaderSession(args.session.id);
        if (currentSession && isTerminalStatus(currentSession.status)) {
          const earlyResult = {
            sessionId: args.session.id,
            status: currentSession.status,
            alreadyFinished: true,
          };
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "finish",
              ok: true,
              result: earlyResult,
            })
          );
          return earlyResult;
        }
        try {
          const result = await doSynthesisAndFinishWithMaster(cursor);
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "finish",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", args.session.id, {
              toolName: "finish",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown tool error",
            })
          );
          throw error;
        }
      },
    }),
  };

  return {
    tools,
    getCursor() {
      return currentCursor;
    },
  };
}
