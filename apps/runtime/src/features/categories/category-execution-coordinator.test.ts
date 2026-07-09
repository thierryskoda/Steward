import { describe, it } from "vitest";
import assert from "node:assert";
import { runOnceIfNotInFlight } from "./category-execution-coordinator.js";

describe("runOnceIfNotInFlight", () => {
  it("runs callback when not in flight", async () => {
    let ran = false;
    await runOnceIfNotInFlight({
      categoryId: "test-cat",
      itemId: "id-1",
      run: async () => {
        ran = true;
      },
    });
    assert.strictEqual(ran, true);
  });

  it("skips second run when same item already in flight", async () => {
    const order: string[] = [];
    const slowRun = runOnceIfNotInFlight({
      categoryId: "cat",
      itemId: "id",
      run: async () => {
        order.push("start");
        await new Promise((r) => setTimeout(r, 50));
        order.push("end");
      },
    });
    const duplicateRun = runOnceIfNotInFlight({
      categoryId: "cat",
      itemId: "id",
      run: async () => {
        order.push("duplicate");
      },
    });
    await Promise.all([slowRun, duplicateRun]);
    assert.deepStrictEqual(order, ["start", "end"]);
    assert.ok(!order.includes("duplicate"));
  });

  it("releases lock after run completes so same item can run again", async () => {
    let runCount = 0;
    await runOnceIfNotInFlight({
      categoryId: "cat",
      itemId: "id",
      run: async () => {
        runCount++;
      },
    });
    await runOnceIfNotInFlight({
      categoryId: "cat",
      itemId: "id",
      run: async () => {
        runCount++;
      },
    });
    assert.strictEqual(runCount, 2);
  });

  it("releases lock when run throws", async () => {
    await assert.rejects(
      () =>
        runOnceIfNotInFlight({
          categoryId: "cat",
          itemId: "id",
          run: async () => {
            throw new Error("fail");
          },
        }),
      /fail/
    );
    let ran = false;
    await runOnceIfNotInFlight({
      categoryId: "cat",
      itemId: "id",
      run: async () => {
        ran = true;
      },
    });
    assert.strictEqual(ran, true);
  });
});
