import { describe, it } from "node:test";
import assert from "node:assert";
import { queryKeys } from "./query-keys.js";

describe("queryKeys", () => {
  it("builds project-scoped keys for host data", () => {
    assert.deepStrictEqual(queryKeys.inbox.findings("/repo-a"), ["inbox", "findings", "/repo-a"]);
    assert.deepStrictEqual(queryKeys.inbox.rules("/repo-a"), ["inbox", "rules", "/repo-a"]);
    assert.deepStrictEqual(queryKeys.cto.items("/repo-a"), ["cto", "items", "/repo-a"]);
    assert.deepStrictEqual(queryKeys.settings.connectionConfig("/repo-a"), [
      "settings",
      "connection",
      "/repo-a",
    ]);
    assert.deepStrictEqual(queryKeys.settings.runtimeStatus("/repo-a"), [
      "settings",
      "runtime-status",
      "/repo-a",
    ]);
    assert.deepStrictEqual(queryKeys.settings.rulesSnapshot("/repo-a"), [
      "settings",
      "rules-snapshot",
      "/repo-a",
    ]);
  });

  it("provides stable hierarchical root keys for broad invalidation", () => {
    assert.deepStrictEqual(queryKeys.inbox.all(), ["inbox"]);
    assert.deepStrictEqual(queryKeys.cto.all(), ["cto"]);
    assert.deepStrictEqual(queryKeys.settings.all(), ["settings"]);
    assert.deepStrictEqual(queryKeys.projects.all(), ["projects"]);
    assert.deepStrictEqual(queryKeys.projects.list(), ["projects", "list"]);
    assert.deepStrictEqual(queryKeys.projects.selected(), ["projects", "selected"]);
  });
});
