import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { countsOf, EXPORT_PATH, readPressList, renderCsv } from "../lib/press-list.js";

export default defineTool({
  description: prompt`
    Export the stored press list as CSV, including verdict, confidence, and sources.
    Call this when the user asks for a CSV or a download.
    Put the returned csv in a fenced csv block in your reply.
  `,
  effect: "write",
  inputSchema: z.object({}),
  dryRunResult: () => ({
    ok: true,
    dryRun: true,
    rowCount: 0,
    csv: "",
  }),
  async execute(_input, ctx) {
    const list = await readPressList(ctx.host.kv);
    const csv = renderCsv(list);
    const exportedAt = ctx.now().toISOString();
    let fileSaved = true;
    let fileError = "";
    try {
      await ctx.host.files.write(EXPORT_PATH, csv, { scope: "deployment" });
    } catch (error) {
      fileSaved = false;
      fileError = error instanceof Error ? error.message : String(error);
    }

    let artifactId = "";
    let artifactError = "";
    try {
      const record = await ctx.artifacts.tag({
        kind: "press-list-csv",
        key: "press-list.csv",
        title: "Press list CSV",
        contentType: "text/csv",
        contents: csv,
        data: { rowCount: list.people.length, exportedAt },
      });
      artifactId = record.id;
    } catch (error) {
      artifactError = error instanceof Error ? error.message : String(error);
    }

    return {
      ok: true,
      ...countsOf(list),
      rowCount: list.people.length,
      filePath: EXPORT_PATH,
      fileSaved,
      fileError,
      artifactId,
      artifactError,
      csv,
    };
  },
});
