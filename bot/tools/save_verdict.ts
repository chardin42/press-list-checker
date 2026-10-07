import { prompt } from "@cursor/bdk";
import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import {
  commitPressList,
  findPerson,
  toPersonPayload,
  verdictError,
  type PressPerson,
  type PressVerdict,
  SOURCE_KINDS,
  VERDICT_LABELS,
} from "../lib/press-list.js";

const sourceInput = z.object({
  url: z.string().trim().min(1).max(500),
  kind: z.enum(SOURCE_KINDS),
  title: z.string().trim().max(200).optional(),
});

export default defineTool({
  description: prompt`
    Save one journalist's verdict after you have checked public sources.
    The person must be in the current claimed batch.
    Verdict is exactly one of: Still there, Moved, Left journalism, Uncertain.
    confidence is a number from 0 to 1.
    sources are the public pages you used: byline, staff_page, linkedin, x, or other.
    Still there, Moved, and Left journalism each need at least one http(s) source.
  `,
  effect: "write",
  inputSchema: z
    .object({
      id: z.string().min(1).optional(),
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
      outlet: z.string().trim().min(1).max(160).optional(),
      verdict: z.enum(VERDICT_LABELS),
      confidence: z.number().min(0).max(1),
      sources: z.array(sourceInput).max(8),
      note: z.string().trim().max(800).optional(),
    })
    .superRefine((value, issue) => {
      const hasId = value.id !== undefined;
      const hasName =
        value.firstName !== undefined && value.lastName !== undefined && value.outlet !== undefined;
      if (!hasId && !hasName) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Pass id, or firstName, lastName, and outlet.",
        });
      }
    }),
  dryRunResult: ({ verdict }) => ({
    ok: true,
    dryRun: true,
    verdict,
  }),
  async execute(input, ctx) {
    const problem = verdictError({
      label: input.verdict,
      sources: input.sources,
      note: input.note,
    });
    if (problem !== undefined) return { ok: false, error: problem };

    const checkedAt = ctx.now().toISOString();
    const verdict: PressVerdict = {
      label: input.verdict,
      confidence: Math.round(input.confidence * 100) / 100,
      sources: input.sources.map((source) => ({
        url: source.url,
        kind: source.kind,
        title: source.title !== undefined && source.title !== "" ? source.title : undefined,
      })),
      note: input.note !== undefined && input.note !== "" ? input.note : undefined,
      checkedAt,
    };

    let saved: PressPerson | undefined;
    const outcome = await commitPressList(ctx.host.kv, (list) => {
      const found = findPerson(list, {
        id: input.id,
        firstName: input.firstName,
        lastName: input.lastName,
        outlet: input.outlet,
      });
      if ("error" in found) return { ok: false, error: found.error };
      if (found.person.status !== "checking") {
        return {
          ok: false,
          error: `${found.person.firstName} ${found.person.lastName} is ${found.person.status}. Call claim_check_batch before saving a verdict. At most 8 people stay in progress.`,
        };
      }
      const people = list.people.map((person) =>
        person.id === found.person.id
          ? { ...person, status: "checked" as const, claimedAt: undefined, verdict }
          : person,
      );
      saved = people.find((person) => person.id === found.person.id);
      return { ok: true, list: { people, updatedAt: checkedAt }, write: true };
    });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    if (saved === undefined) return { ok: false, error: "The verdict did not save." };

    let artifactId = "";
    let artifactError = "";
    try {
      const record = await ctx.artifacts.tag({
        kind: "journalist-verdict",
        key: saved.id,
        title: `${saved.firstName} ${saved.lastName} — ${verdict.label}`,
        data: JSON.parse(JSON.stringify({
          id: saved.id,
          firstName: saved.firstName,
          lastName: saved.lastName,
          outlet: saved.outlet,
          verdict: verdict.label,
          confidence: verdict.confidence,
          sources: verdict.sources,
          note: verdict.note ?? "",
          checkedAt: verdict.checkedAt,
        })),
      });
      artifactId = record.id;
    } catch (error) {
      artifactError = error instanceof Error ? error.message : String(error);
    }

    return {
      ok: true,
      artifactId,
      artifactError,
      person: toPersonPayload(saved),
    };
  },
});
