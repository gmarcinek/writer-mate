import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { createReaderHint } from "@/lib/reader/persistence";
import { createReaderSessionEvent } from "@/lib/reader/events";
import type { ToolContext } from "./context";

export function buildHintsTools(ctx: ToolContext) {
  const { session, emit } = ctx;

  return {
    createHint: tool({
      description:
        "Create a reading hint — flag a specific passage with an observation or suggestion. Use when you spot something worth noting: a potential issue, an interesting pattern, a factual claim worth verifying, or a concrete proposed improvement. Each hint is tied to a line range and a short verbatim fragment.",
      parameters: z.object({
        description: z
          .string()
          .min(1)
          .max(400)
          .describe("Short description of the observation (1-2 sentences)"),
        startLine: z
          .number()
          .int()
          .min(1)
          .describe("First line of the relevant passage"),
        endLine: z
          .number()
          .int()
          .min(1)
          .describe("Last line of the relevant passage"),
        fragment: z
          .string()
          .max(500)
          .describe("The exact verbatim text fragment from the source (keep short, 1-3 sentences)"),
        proposedChange: z
          .string()
          .min(1)
          .max(600)
          .describe("Concrete suggestion or proposed change for this passage"),
      }),
      execute: async (input) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "createHint",
            input,
          })
        );

        try {
          const hint = await createReaderHint({
            sessionId: session.id,
            bookId: session.bookId,
            description: input.description,
            startLine: input.startLine,
            endLine: input.endLine,
            fragment: input.fragment,
            proposedChange: input.proposedChange,
          });

          await emit?.(
            createReaderSessionEvent("hint_emitted", session.id, {
              hintId: hint.id,
              description: hint.description,
              startLine: hint.startLine,
              endLine: hint.endLine,
              fragment: hint.fragment ?? "",
              proposedChange: hint.proposedChange,
            })
          );

          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "createHint",
              ok: true,
              result: { hintId: hint.id },
            })
          );

          return { hintId: hint.id, ok: true };
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "createHint",
              ok: false,
              errorMessage: error instanceof Error ? error.message : "Unknown error",
            })
          );
          throw error;
        }
      },
    }),
  };
}
