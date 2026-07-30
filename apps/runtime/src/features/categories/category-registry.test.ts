import { describe, expect, it, vi } from "vitest";
import { DOCUMENTATION_REFRESH_CATEGORY_ID } from "@steward/contracts/schemas";
import { getActionableCategories, setCategoryRegistryDeps } from "./category-registry.js";

vi.mock("../../core/project-root.js", () => ({
  getProjectRoot: (): string => "/tmp/category-registry-test",
}));

vi.mock("./rules-snapshot.js", () => ({
  loadSnapshot: vi.fn(() => ({
    categories: [
      {
        categoryId: DOCUMENTATION_REFRESH_CATEGORY_ID,
        rulePath: "rules/documentation.md",
        ruleContent: "A colliding dynamic rule.",
      },
      {
        categoryId: "generic-quality",
        rulePath: "rules/quality.md",
        ruleContent: "A generic code-quality rule.",
      },
    ],
  })),
}));

describe("category registry static category isolation", () => {
  it("never exposes the report-only documentation category to implementation workers", () => {
    setCategoryRegistryDeps({
      readRepoScopeConfigFromDisk: () => ({ ruleSources: ["rules/*.md"] }),
    });

    expect(getActionableCategories().map((entry) => entry.categoryId)).toEqual(["generic-quality"]);
  });
});
