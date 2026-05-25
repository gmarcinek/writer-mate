import "server-only";

import { tool } from "ai";
import { createReaderSessionEvent } from "@/lib/reader/events";
import { searchPhrasesToolSchema } from "../schemas";
import { searchSourcePhrases } from "../utils";
import type { ToolContext } from "./context";

export function buildSearchTools(ctx: ToolContext) {
  const { session, emit } = ctx;

  return {
    searchPhrases: tool({
      description:
        "Find lexical phrase matches in the current source and return local line context around each hit.",
      parameters: searchPhrasesToolSchema,
      execute: async ({ query, maxHits, contextLines }) => {
        await emit?.(
          createReaderSessionEvent("tool_call", session.id, {
            toolName: "searchPhrases",
            input: { query, maxHits, contextLines },
          })
        );
        try {
          const result = await searchSourcePhrases({
            source: session.source,
            query,
            maxHits: maxHits ?? undefined,
            contextLines: contextLines ?? undefined,
          });
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "searchPhrases",
              ok: true,
              result,
            })
          );
          return result;
        } catch (error) {
          await emit?.(
            createReaderSessionEvent("tool_result", session.id, {
              toolName: "searchPhrases",
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
