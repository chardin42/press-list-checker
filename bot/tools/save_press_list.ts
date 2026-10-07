import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { commitPressList, countsOf, mergePeople, toPersonPayload } from "../lib/press-list.js";

const personInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  outlet: z.string().trim().min(1).max(160),
});

export default defineTool({
  description: prompt`
    Store journalists from a pasted press list.
    Each person needs a first name, last name, and outlet.
    Omit mode only when no list is stored yet. If a list exists, pass mode
    "replace" to make this paste the list, or "append" to add people.
    Replace keeps saved verdicts for people who are still on the list.
    Pass resetVerdicts only with replace, and only when the user wants every remaining person checked again.
  `,
  effect: "write",
  inputSchema: z.object({
    people: z.array(personInput).min(1).max(500),
    mode: z.enum(["replace", "append"]).optional(),
    resetVerdicts: z.boolean().optional(),
  }),
  dryRunResult: ({ people, mode }) => ({
    ok: true,
    dryRun: true,
    mode: mode ?? "replace",
    received: people.length,
  }),
  async execute(input, ctx) {
    let added = 0;
    let updated = 0;
    let removed = 0;
    let duplicates = 0;
    let mode: "replace" | "append" = "replace";
    const outcome = await commitPressList(ctx.host.kv, (list) => {
      if (list.people.length > 0 && input.mode === undefined) {
        return {
          ok: false,
          error: `A press list of ${list.people.length} people is already stored. Call again with mode "replace" to make this paste the list, or mode "append" to add people.`,
        };
      }
      mode = input.mode ?? "replace";
      if (input.resetVerdicts === true && mode === "append") {
        return {
          ok: false,
          error: 'resetVerdicts only works with mode "replace". To recheck people already stored, call claim_check_batch with their ids.',
        };
      }
      const merged = mergePeople(
        list,
        input.people,
        mode,
        ctx.now().toISOString(),
        input.resetVerdicts === true,
      );
      added = merged.added;
      updated = merged.updated;
      removed = merged.removed;
      duplicates = merged.duplicates;
      return { ok: true, list: merged.list, write: true };
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    const counts = countsOf(outcome.list);
    return {
      ok: true,
      mode,
      added,
      updated,
      removed,
      duplicates,
      ...counts,
      people: outcome.list.people.map(toPersonPayload),
    };
  },
});
