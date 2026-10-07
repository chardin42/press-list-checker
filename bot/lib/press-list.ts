import { supportsKvCas, type HostKvApi, type JsonValue } from "@cursor/bdk";

export const BATCH_SIZE = 8;
export const LIST_KEY = "press-list";
export const EXPORT_PATH = "exports/press-list.csv";
/** A claim older than this can be handed out again. */
export const CLAIM_STALE_MS = 2 * 60 * 60 * 1000;

export const VERDICT_LABELS = [
  "Still there",
  "Moved",
  "Left journalism",
  "Uncertain",
] as const;

export const SOURCE_KINDS = [
  "byline",
  "staff_page",
  "linkedin",
  "x",
  "other",
] as const;

export type VerdictLabel = (typeof VERDICT_LABELS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type PersonStatus = "pending" | "checking" | "checked";

export type PressSource = {
  url: string;
  kind: SourceKind;
  title?: string;
};

export type PressVerdict = {
  label: VerdictLabel;
  confidence: number;
  sources: PressSource[];
  note?: string;
  checkedAt: string;
};

export type PressPerson = {
  id: string;
  firstName: string;
  lastName: string;
  outlet: string;
  status: PersonStatus;
  claimedAt?: string;
  verdict?: PressVerdict;
};

export type PressList = {
  people: PressPerson[];
  updatedAt: string;
};

export type IncomingPerson = {
  firstName: string;
  lastName: string;
  outlet: string;
};

export type PersonPayload = {
  id: string;
  firstName: string;
  lastName: string;
  outlet: string;
  status: PersonStatus;
  claimedAt: string;
  verdict: {
    label: VerdictLabel;
    confidence: number;
    sources: Array<{ url: string; kind: SourceKind; title: string }>;
    note: string;
    checkedAt: string;
  } | null;
};

export type ListCounts = {
  total: number;
  pending: number;
  checking: number;
  checked: number;
};

type CommitResult =
  | { ok: true; list: PressList; write: boolean }
  | { ok: false; error: string };

const MAX_ATTEMPTS = 5;

export function emptyPressList(): PressList {
  return { people: [], updatedAt: "" };
}

export function personId(firstName: string, lastName: string, outlet: string): string {
  return [slug(firstName), slug(lastName), slug(outlet)].join("-");
}

export function countsOf(list: PressList): ListCounts {
  let pending = 0;
  let checking = 0;
  let checked = 0;
  for (const person of list.people) {
    if (person.status === "pending") pending += 1;
    else if (person.status === "checking") checking += 1;
    else checked += 1;
  }
  return { total: list.people.length, pending, checking, checked };
}

export function toPersonPayload(person: PressPerson): PersonPayload {
  const verdict = person.verdict;
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    outlet: person.outlet,
    status: person.status,
    claimedAt: person.claimedAt ?? "",
    verdict:
      verdict === undefined
        ? null
        : {
            label: verdict.label,
            confidence: verdict.confidence,
            sources: verdict.sources.map((source) => ({
              url: source.url,
              kind: source.kind,
              title: source.title ?? "",
            })),
            note: verdict.note ?? "",
            checkedAt: verdict.checkedAt,
          },
  };
}

export function mergePeople(
  existing: PressList,
  incoming: IncomingPerson[],
  mode: "replace" | "append",
  nowIso: string,
  resetVerdicts: boolean,
): {
  list: PressList;
  added: number;
  updated: number;
  removed: number;
  duplicates: number;
} {
  const kept = new Map<string, PressPerson>();
  if (mode === "append" || !resetVerdicts) {
    for (const person of existing.people) {
      kept.set(person.id, { ...person, verdict: person.verdict ? { ...person.verdict, sources: person.verdict.sources.map((source) => ({ ...source })) } : undefined });
    }
  }

  const order: string[] = mode === "append" ? existing.people.map((person) => person.id) : [];
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  let duplicates = 0;

  for (const row of incoming) {
    const id = personId(row.firstName, row.lastName, row.outlet);
    if (seen.has(id)) {
      duplicates += 1;
      const current = kept.get(id);
      if (current !== undefined) {
        kept.set(id, {
          ...current,
          firstName: row.firstName,
          lastName: row.lastName,
          outlet: row.outlet,
        });
      }
      continue;
    }
    seen.add(id);
    const current = kept.get(id);
    if (current === undefined) {
      added += 1;
      kept.set(id, {
        id,
        firstName: row.firstName,
        lastName: row.lastName,
        outlet: row.outlet,
        status: "pending",
      });
      order.push(id);
      continue;
    }
    updated += 1;
    const reset = mode === "replace" && resetVerdicts;
    kept.set(id, {
      id,
      firstName: row.firstName,
      lastName: row.lastName,
      outlet: row.outlet,
      status: reset ? "pending" : current.status,
      claimedAt: reset ? undefined : current.claimedAt,
      verdict: reset ? undefined : current.verdict,
    });
    if (!order.includes(id)) order.push(id);
  }

  const people: PressPerson[] = [];
  if (mode === "replace") {
    for (const row of incoming) {
      const id = personId(row.firstName, row.lastName, row.outlet);
      const person = kept.get(id);
      if (person !== undefined && !people.some((item) => item.id === id)) {
        people.push(person);
      }
    }
  } else {
    for (const id of order) {
      const person = kept.get(id);
      if (person !== undefined) people.push(person);
    }
  }

  const removed =
    mode === "replace"
      ? existing.people.filter((person) => !seen.has(person.id)).length
      : 0;

  return {
    list: { people, updatedAt: nowIso },
    added,
    updated,
    removed,
    duplicates,
  };
}

export function planClaim(
  list: PressList,
  nowIso: string,
  personIds: string[] | undefined,
):
  | {
      ok: true;
      list: PressList;
      added: number;
      alreadyInFlight: boolean;
      research: PressPerson[];
      message: string;
    }
  | { ok: false; error: string } {
  const nowMs = Date.parse(nowIso);
  const people = list.people.map(copyPerson);

  if (personIds !== undefined) {
    if (personIds.length === 0) {
      return { ok: false, error: "Pass at least one id, or omit personIds to take the next batch." };
    }
    if (personIds.length > BATCH_SIZE) {
      return {
        ok: false,
        error: `Check at most ${BATCH_SIZE} people at a time. Ask again with ${BATCH_SIZE} or fewer ids.`,
      };
    }
    const uniqueIds = [...new Set(personIds)];
    const missing = uniqueIds.filter((id) => !people.some((person) => person.id === id));
    if (missing.length > 0) {
      return { ok: false, error: `Not on the press list: ${missing.join(", ")}` };
    }
    const requested = new Set(uniqueIds);
    const freshOthers = people.filter(
      (person) => isFreshChecking(person, nowMs) && !requested.has(person.id),
    );
    if (freshOthers.length + uniqueIds.length > BATCH_SIZE) {
      return {
        ok: false,
        error: `${freshOthers.length} people are already being checked. Finish them before starting ${uniqueIds.length} more. At most ${BATCH_SIZE} can be in progress.`,
      };
    }
    let added = 0;
    for (const person of people) {
      if (!requested.has(person.id)) continue;
      if (isFreshChecking(person, nowMs)) continue;
      added += 1;
      if (person.status === "checked") person.verdict = undefined;
      person.status = "checking";
      person.claimedAt = nowIso;
    }
    if (added === 0) {
      return {
        ok: true,
        list,
        added: 0,
        alreadyInFlight: true,
        research: list.people.filter((person) => requested.has(person.id)),
        message: "Those people are already in the current batch. Research them, then save a verdict for each.",
      };
    }
    const research = people.filter((person) => requested.has(person.id));
    return {
      ok: true,
      list: { people, updatedAt: nowIso },
      added,
      alreadyInFlight: false,
      research,
      message: `Claimed ${added} people. Research this batch, then save a verdict for each before claiming more.`,
    };
  }

  const fresh = people.filter((person) => isFreshChecking(person, nowMs));
  if (fresh.length >= BATCH_SIZE) {
    return {
      ok: true,
      list,
      added: 0,
      alreadyInFlight: true,
      research: fresh,
      message: `${fresh.length} people are already being checked. Save a verdict for each of them before claiming another batch.`,
    };
  }

  const slots = BATCH_SIZE - fresh.length;
  const candidates = [
    ...people.filter((person) => person.status === "pending"),
    ...people.filter((person) => person.status === "checking" && !isFreshChecking(person, nowMs)),
  ];
  const picked = candidates.slice(0, slots);
  const pickedIds = new Set(picked.map((person) => person.id));
  for (const person of people) {
    if (!pickedIds.has(person.id)) continue;
    person.status = "checking";
    person.claimedAt = nowIso;
  }
  const research = people.filter(
    (person) => isFreshChecking(person, nowMs) || pickedIds.has(person.id),
  );
  if (picked.length === 0) {
    return {
      ok: true,
      list,
      added: 0,
      alreadyInFlight: research.length > 0,
      research,
      message:
        research.length === 0
          ? "Nobody is waiting to be checked."
          : "These people are already in progress. Finish them before claiming another batch.",
    };
  }
  const pendingLeft = people.filter((person) => person.status === "pending").length;
  return {
    ok: true,
    list: { people, updatedAt: nowIso },
    added: picked.length,
    alreadyInFlight: false,
    research,
    message: `Claimed ${picked.length} people (${research.length} in this batch of ${BATCH_SIZE}). Research everyone listed, save each verdict, then claim the next batch. ${pendingLeft} still waiting after this batch.`,
  };
}

export function verdictError(input: {
  label: VerdictLabel;
  sources: Array<{ url: string }>;
  note?: string;
}): string | undefined {
  if (input.label !== "Uncertain" && input.sources.length === 0) {
    return "Still there, Moved, and Left journalism each need at least one http(s) source.";
  }
  if (input.label === "Uncertain" && input.sources.length === 0 && (input.note ?? "").trim().length < 20) {
    return "An Uncertain verdict with no sources needs a note of at least 20 characters explaining what you searched.";
  }
  for (const source of input.sources) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      return `Not a URL: ${source.url}`;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `Source URLs must be http or https: ${source.url}`;
    }
  }
  return undefined;
}

export function renderCsv(list: PressList): string {
  const header = [
    "first_name",
    "last_name",
    "outlet",
    "verdict",
    "confidence",
    "status",
    "sources",
    "note",
    "checked_at",
  ];
  const lines = [header.join(",")];
  for (const person of list.people) {
    const verdict = person.verdict;
    const sources =
      verdict?.sources
        .map((source) => `${source.kind} ${source.url}`)
        .join(" | ") ?? "";
    lines.push(
      [
        person.firstName,
        person.lastName,
        person.outlet,
        verdict?.label ?? "",
        verdict === undefined ? "" : String(verdict.confidence),
        person.status,
        sources,
        verdict?.note ?? "",
        verdict?.checkedAt ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function commitPressList(
  kv: HostKvApi,
  change: (list: PressList) => CommitResult,
): Promise<CommitResult> {
  if (supportsKvCas(kv)) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await kv.getWithVersion(LIST_KEY);
      const list = decodeList(current?.value);
      const next = change(list);
      if (!next.ok || !next.write) return next;
      const encoded = toJson(next.list);
      const written =
        current === undefined
          ? await kv.putIfAbsent(LIST_KEY, encoded)
          : await kv.putIfVersion(LIST_KEY, encoded, current.version);
      if (written.ok) return next;
    }
    return {
      ok: false,
      error: "The press list was updated at the same time. Retry the tool.",
    };
  }

  const next = change(decodeList(await kv.get(LIST_KEY)));
  if (!next.ok || !next.write) return next;
  await kv.put(LIST_KEY, toJson(next.list));
  return next;
}

export async function readPressList(kv: HostKvApi): Promise<PressList> {
  return decodeList(await kv.get(LIST_KEY));
}

export function findPerson(
  list: PressList,
  query: { id?: string; firstName?: string; lastName?: string; outlet?: string },
): { person: PressPerson } | { error: string } {
  if (query.id !== undefined && query.id !== "") {
    const person = list.people.find((item) => item.id === query.id);
    if (person === undefined) return { error: `No person with id ${query.id}.` };
    if (
      query.firstName !== undefined &&
      query.lastName !== undefined &&
      query.outlet !== undefined
    ) {
      const fromNames = personId(query.firstName, query.lastName, query.outlet);
      if (fromNames !== query.id) {
        return {
          error: `id ${query.id} does not match ${query.firstName} ${query.lastName} at ${query.outlet} (${fromNames}).`,
        };
      }
    }
    return { person };
  }
  if (
    query.firstName === undefined ||
    query.lastName === undefined ||
    query.outlet === undefined
  ) {
    return { error: "Pass id, or firstName, lastName, and outlet." };
  }
  const id = personId(query.firstName, query.lastName, query.outlet);
  const person = list.people.find((item) => item.id === id);
  if (person === undefined) {
    return {
      error: `${query.firstName} ${query.lastName} at ${query.outlet} is not on the press list. Save them first.`,
    };
  }
  return { person };
}

function decodeList(value: JsonValue | undefined): PressList {
  if (value === undefined) return emptyPressList();
  if (!isRecord(value) || !Array.isArray(value.people)) {
    throw new Error("The stored press list is unreadable. Save a new list with mode replace.");
  }
  const people: PressPerson[] = [];
  for (const item of value.people) {
    const person = parsePerson(item);
    if (person === undefined) {
      throw new Error("The stored press list is unreadable. Save a new list with mode replace.");
    }
    people.push(person);
  }
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
  return { people, updatedAt };
}

function parsePerson(value: JsonValue): PressPerson | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.firstName !== "string" ||
    typeof value.lastName !== "string" ||
    typeof value.outlet !== "string" ||
    (value.status !== "pending" && value.status !== "checking" && value.status !== "checked")
  ) {
    return undefined;
  }
  const person: PressPerson = {
    id: value.id,
    firstName: value.firstName,
    lastName: value.lastName,
    outlet: value.outlet,
    status: value.status,
  };
  if (typeof value.claimedAt === "string") person.claimedAt = value.claimedAt;
  if (value.verdict !== undefined && value.verdict !== null) {
    const verdict = parseVerdict(value.verdict);
    if (verdict === undefined) return undefined;
    person.verdict = verdict;
  }
  return person;
}

function parseVerdict(value: JsonValue): PressVerdict | undefined {
  if (!isRecord(value)) return undefined;
  if (!isVerdictLabel(value.label) || typeof value.confidence !== "number" || typeof value.checkedAt !== "string") {
    return undefined;
  }
  if (!Array.isArray(value.sources)) return undefined;
  const sources: PressSource[] = [];
  for (const source of value.sources) {
    if (!isRecord(source) || typeof source.url !== "string" || !isSourceKind(source.kind)) {
      return undefined;
    }
    const parsed: PressSource = { url: source.url, kind: source.kind };
    if (typeof source.title === "string" && source.title !== "") parsed.title = source.title;
    sources.push(parsed);
  }
  const verdict: PressVerdict = {
    label: value.label,
    confidence: value.confidence,
    sources,
    checkedAt: value.checkedAt,
  };
  if (typeof value.note === "string" && value.note !== "") verdict.note = value.note;
  return verdict;
}

function isVerdictLabel(value: JsonValue | undefined): value is VerdictLabel {
  return typeof value === "string" && (VERDICT_LABELS as readonly string[]).includes(value);
}

function isSourceKind(value: JsonValue | undefined): value is SourceKind {
  return typeof value === "string" && (SOURCE_KINDS as readonly string[]).includes(value);
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJson(list: PressList): JsonValue {
  return JSON.parse(JSON.stringify(list)) as JsonValue;
}

function copyPerson(person: PressPerson): PressPerson {
  return {
    ...person,
    verdict:
      person.verdict === undefined
        ? undefined
        : {
            ...person.verdict,
            sources: person.verdict.sources.map((source) => ({ ...source })),
          },
  };
}

function isFreshChecking(person: PressPerson, nowMs: number): boolean {
  if (person.status !== "checking" || person.claimedAt === undefined) return false;
  const claimed = Date.parse(person.claimedAt);
  if (Number.isNaN(claimed)) return false;
  return nowMs - claimed < CLAIM_STALE_MS;
}

function slug(value: string): string {
  const folded = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const slugged = folded.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (slugged !== "") return slugged.slice(0, 40);
  return `u${Buffer.from(value.trim().toLowerCase()).toString("hex").slice(0, 12)}`;
}

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}
