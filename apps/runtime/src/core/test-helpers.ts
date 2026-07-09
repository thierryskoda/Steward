/**
 * Shared test helpers for runtime tests. Temp project roots are tracked per
 * helper instance and cleaned up via cleanup() so each test file can call
 * afterEach(cleanup).
 */
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createTempRootHelper(prefix: string): {
  createTempProjectRoot: () => string;
  cleanup: () => void;
} {
  const roots: string[] = [];
  return {
    createTempProjectRoot: (): string => {
      const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
      roots.push(root);
      return root;
    },
    cleanup: (): void => {
      for (const root of roots.splice(0, roots.length)) {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

export { createTempRootHelper };
