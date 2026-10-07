import { defineEval, includes } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "Store a pasted press list and export CSV without researching anyone.",
  async test(t) {
    await t.send(
      [
        "Save this as a new press list and export a CSV. Do not research or check anyone.",
        "",
        "Ada Lovelace, The Analytical Engine",
        "Grace Hopper, Navy Computing",
      ].join("\n"),
    );
    t.succeeded();
    t.calledTool("save_press_list", {
      status: "completed",
      input: {
        people: (people) => Array.isArray(people) && people.length === 2,
      },
    });
    t.calledTool("export_press_list", {
      status: "completed",
      output: (value) => JSON.stringify(value).includes("first_name,last_name,outlet"),
    });
    t.notCalledTool("claim_check_batch");
    t.notCalledTool("save_verdict");
    t.check(t.reply, includes(/csv/i));
  },
});
