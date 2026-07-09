/**
 * Process-scoped project root for the runtime. Set once from main.ts; all runtime code reads via getProjectRoot().
 */

let projectRoot: string | undefined;

export function setProjectRoot(root: string): void {
  projectRoot = root;
}

export function getProjectRoot(): string {
  if (projectRoot === undefined) {
    throw new Error(
      "Project root not set; ensure setProjectRoot() is called from composition root before any code that needs it."
    );
  }
  return projectRoot;
}
