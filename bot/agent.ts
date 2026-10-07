import { defineAgent } from "@cursor/bdk";

export default defineAgent({
  name: "press-list-checker",
  description:
    "Stores a pasted press list and checks each journalist against public bylines, staff pages, LinkedIn, and X.",
  model: {
    id: "grok-4.5",
    params: [
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  tools: ["webSearch", "webFetch", "read", "grep", "glob", "ls"],
});
