import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import {
  BATCH_SIZE,
  commitPressList,
  countsOf,
  planClaim,
  toPersonPayload,
  type PressPerson,
} from "../lib/press-list.js";

export default defineTool({
  description: prompt`
    Take the next journalists to research. Returns at most 8 people.
    While 8 are already in progress, this returns that same batch and does not start more.
    Pass personIds only to recheck specific people, at most 8.
    Research everyone in research, and save_verdict for each, before claiming again.
  `,
  effect: "write",
  inputSchema: z.object({
    personIds: z.array(z.string().min(1)).max(BATCH_SIZE).optional(),
  }),
  dryRunResult: () => ({
    ok: true,
    dryRun: true,
    batchSize: BATCH_SIZE,
    research: [],
    message: "Dry run does not claim a batch.",
  }),
  async execute(input, ctx) {
    let research: PressPerson[] = [];
    let added = 0;
    let alreadyInFlight = false;
    let message = "";
    const outcome = await commitPressList(ctx.host.kv, (list) => {
      const planned = planClaim(list, ctx.now().toISOString(), input.personIds);
      if (!planned.ok) return planned;
      research = planned.research;
      added = planned.added;
      alreadyInFlight = planned.alreadyInFlight;
      message = planned.message;
      return { ok: true, list: planned.list, write: planned.added > 0 };
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return {
      ok: true,
      batchSize: BATCH_SIZE,
      added,
      alreadyInFlight,
      message,
      research: research.map(toPersonPayload),
      ...countsOf(outcome.list),
    };
  },
});
