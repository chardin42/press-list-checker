import { defineArtifacts } from "@cursor/bdk/artifacts";
import { z } from "zod";
import { SOURCE_KINDS, VERDICT_LABELS } from "./lib/press-list.js";

export default defineArtifacts({
  kinds: {
    "journalist-verdict": {
      description: "Employment verdict saved for one journalist on the press list.",
      schema: z.object({
        id: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        outlet: z.string(),
        verdict: z.enum(VERDICT_LABELS),
        confidence: z.number(),
        sources: z.array(
          z.object({
            url: z.string(),
            kind: z.enum(SOURCE_KINDS),
            title: z.string().optional(),
          }),
        ),
        note: z.string(),
        checkedAt: z.string(),
      }),
    },
    "press-list-csv": {
      description: "CSV export of the stored press list and verdicts.",
      schema: z.object({
        rowCount: z.number(),
        exportedAt: z.string(),
      }),
    },
  },
});
