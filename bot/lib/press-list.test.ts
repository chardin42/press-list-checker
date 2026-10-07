import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_SIZE,
  CLAIM_STALE_MS,
  mergePeople,
  personId,
  planClaim,
  renderCsv,
  verdictError,
  type PressList,
} from "./press-list.js";

const NOW = "2026-10-07T12:00:00.000Z";

function row(firstName: string, lastName: string, outlet: string) {
  return { firstName, lastName, outlet };
}

function listOf(count: number): PressList {
  const incoming = Array.from({ length: count }, (_, index) =>
    row(`First${index}`, `Last${index}`, "Daily"),
  );
  return mergePeople({ people: [], updatedAt: "" }, incoming, "replace", NOW, false).list;
}

test("stores a pasted list and keeps verdicts for people who remain on replace", () => {
  const first = mergePeople(
    { people: [], updatedAt: "" },
    [row("Ada", "Lovelace", "Engine"), row("Grace", "Hopper", "Navy")],
    "replace",
    NOW,
    false,
  );
  assert.equal(first.added, 2);
  const withVerdict: PressList = {
    ...first.list,
    people: first.list.people.map((person) =>
      person.lastName === "Lovelace"
        ? {
            ...person,
            status: "checked",
            verdict: {
              label: "Still there",
              confidence: 0.9,
              sources: [{ url: "https://example.com/ada", kind: "byline" }],
              checkedAt: NOW,
            },
          }
        : person,
    ),
  };
  const replaced = mergePeople(
    withVerdict,
    [row("Ada", "Lovelace", "Engine"), row("Katherine", "Johnson", "NASA")],
    "replace",
    NOW,
    false,
  );
  assert.equal(replaced.removed, 1);
  assert.equal(replaced.added, 1);
  assert.equal(replaced.list.people.length, 2);
  assert.equal(replaced.list.people[0]?.verdict?.label, "Still there");
  assert.equal(replaced.list.people[1]?.status, "pending");
});

test("append does not duplicate the same journalist", () => {
  const first = mergePeople(
    { people: [], updatedAt: "" },
    [row("Ada", "Lovelace", "Engine")],
    "replace",
    NOW,
    false,
  );
  const second = mergePeople(
    first.list,
    [row("Ada", "Lovelace", "Engine"), row("Ada", "Lovelace", "Engine")],
    "append",
    NOW,
    false,
  );
  assert.equal(second.list.people.length, 1);
  assert.equal(second.duplicates, 1);
  assert.equal(second.updated, 1);
});

test("claims at most eight people and will not start a second batch", () => {
  const stored = listOf(10);
  const first = planClaim(stored, NOW, undefined);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.added, BATCH_SIZE);
  assert.equal(first.research.length, BATCH_SIZE);
  assert.equal(first.list.people.filter((person) => person.status === "checking").length, 8);
  assert.equal(first.list.people.filter((person) => person.status === "pending").length, 2);

  const second = planClaim(first.list, NOW, undefined);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.added, 0);
  assert.equal(second.alreadyInFlight, true);
  assert.equal(second.research.length, BATCH_SIZE);
  assert.equal(second.list, first.list);
});

test("fills a free slot after one verdict, still capping the batch at eight", () => {
  const stored = listOf(10);
  const claimed = planClaim(stored, NOW, undefined);
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  const finished = claimed.research[0];
  assert.ok(finished);
  const afterSave: PressList = {
    ...claimed.list,
    people: claimed.list.people.map((person) =>
      person.id === finished.id ? { ...person, status: "checked", claimedAt: undefined } : person,
    ),
  };
  const next = planClaim(afterSave, NOW, undefined);
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.added, 1);
  assert.equal(next.research.length, BATCH_SIZE);
});

test("refuses a ninth specific id", () => {
  const stored = listOf(9);
  const ids = stored.people.map((person) => person.id);
  const claimed = planClaim(stored, NOW, ids);
  assert.equal(claimed.ok, false);
});

test("reclaims a stale batch", () => {
  const stored = listOf(3);
  const claimed = planClaim(stored, NOW, undefined);
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  const later = new Date(Date.parse(NOW) + CLAIM_STALE_MS + 1000).toISOString();
  const again = planClaim(claimed.list, later, undefined);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.added, 3);
  assert.equal(again.alreadyInFlight, false);
});

test("folds accented names onto the same id", () => {
  assert.equal(personId("José", "García", "El País"), personId("Jose", "Garcia", "El Pais"));
});

test("csv quotes commas and neutralizes formula cells", () => {
  const merged = mergePeople(
    { people: [], updatedAt: "" },
    [row("=Ada", "Love, lace", "Engine")],
    "replace",
    NOW,
    false,
  );
  const csv = renderCsv(merged.list);
  assert.ok(csv.startsWith("first_name,last_name,outlet,verdict,confidence,status,sources,note,checked_at\n"));
  assert.match(csv, /'=Ada/);
  assert.match(csv, /"Love, lace"/);
});

test("requires a source unless the verdict is uncertain and explained", () => {
  assert.equal(
    verdictError({ label: "Still there", sources: [] }),
    "Still there, Moved, and Left journalism each need at least one http(s) source.",
  );
  assert.equal(
    verdictError({
      label: "Uncertain",
      sources: [],
      note: "No public staff page or byline.",
    }),
    undefined,
  );
  assert.equal(
    verdictError({
      label: "Moved",
      sources: [{ url: "javascript:alert(1)" }],
    }),
    "Source URLs must be http or https: javascript:alert(1)",
  );
});
