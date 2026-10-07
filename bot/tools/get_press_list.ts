import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { countsOf, readPressList, toPersonPayload } from "../lib/press-list.js";

export default defineTool({
  description: prompt`
    Read the stored press list, including verdicts already saved.
    Use this to answer status questions. It does not start a check.
  `,
  effect: "read",
  inputSchema: z.object({
    status: z.enum(["pending", "checking", "checked"]).optional(),
  }),
  async execute({ status }, ctx) {
    const list = await readPressList(ctx.host.kv);
    const counts = countsOf(list);
    const people = list.people.filter((person) => status === undefined || person.status === status);
    return {
      ok: true,
      updatedAt: list.updatedAt,
      ...counts,
      people: people.map(toPersonPayload),
    };
  },
});
