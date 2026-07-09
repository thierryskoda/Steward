import { writeFileSync } from "fs";
import { RESTRICTIVE_FILE_MODE } from "./app-data-permissions.js";
import { ensureProjectDir } from "./project-key.js";
import { join } from "path";

type IRuntimeConfig = {
  nodePath: string;
  projectRoot: string;
  mainJs: string;
};

const RUNTIME_FILENAME = "runtime.json";

export function writeRuntimeConfig(args: {
  projectRoot: string;
  nodePath: string;
  mainJs: string;
}): void {
  const dir = ensureProjectDir(args.projectRoot);
  const path = join(dir, RUNTIME_FILENAME);
  const config: IRuntimeConfig = {
    nodePath: args.nodePath,
    projectRoot: args.projectRoot,
    mainJs: args.mainJs,
  };
  writeFileSync(path, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: RESTRICTIVE_FILE_MODE,
  });
}
