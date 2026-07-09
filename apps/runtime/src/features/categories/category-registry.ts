import { AppError } from "../../core/app-error.js";
import { ERR_DEPS_NOT_SET } from "../../core/error-codes.js";
import { getProjectRoot } from "../../core/project-root.js";
import { loadSnapshot } from "./rules-snapshot.js";

export type ICategoryRegistryEntry = {
  categoryId: string;
  rulePath: string;
  ruleContent: string;
};

export type ICategoryRegistryDeps = {
  readRepoScopeConfigFromDisk: (projectRoot: string) => { ruleSources?: string[] } | null;
};

let categoryRegistryDeps: ICategoryRegistryDeps | null = null;

export function setCategoryRegistryDeps(deps: ICategoryRegistryDeps): void {
  categoryRegistryDeps = deps;
}

function getCategoryRegistryDeps(): ICategoryRegistryDeps {
  if (categoryRegistryDeps === null) {
    throw new AppError(
      "Category registry deps not set; call setCategoryRegistryDeps from composition root.",
      ERR_DEPS_NOT_SET,
      { component: "category-registry" }
    );
  }
  return categoryRegistryDeps;
}

/** Loads categories from the DB-backed rules snapshot. */
export function loadCategoryRegistry(): ICategoryRegistryEntry[] {
  const projectRoot = getProjectRoot();
  const config = getCategoryRegistryDeps().readRepoScopeConfigFromDisk(projectRoot);
  const sources = config?.ruleSources ?? [];
  if (sources.length === 0) {
    return [];
  }
  const snapshot = loadSnapshot(projectRoot);
  if (!snapshot || snapshot.categories.length === 0) {
    return [];
  }
  return [...snapshot.categories];
}

/** Categories for finding workflow. */
export function getActionableCategories(): ICategoryRegistryEntry[] {
  return loadCategoryRegistry();
}

/** Categories that use the generic detection pipeline. */
export function getGenericCategoriesForDetection(): ICategoryRegistryEntry[] {
  return getActionableCategories();
}
