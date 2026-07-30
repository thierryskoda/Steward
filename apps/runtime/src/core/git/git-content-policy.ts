/**
 * Defines which working-tree files may be read when computing Git evidence.
 * Generated/dependency trees and likely binary files contribute metadata only.
 */
const BINARY_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
] as const;

const GENERATED_OR_DEPENDENCY_SEGMENTS = new Set([
  ".git",
  ".steward",
  "node_modules",
  "dist",
  ".next",
  "build",
  "out",
  "coverage",
  ".expo",
  ".turbo",
  ".cache",
  "target",
  ".vite",
]);

export function isLikelyBinaryGitPath(path: string): boolean {
  const lower = path.toLowerCase();
  return BINARY_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isGeneratedOrDependencyGitPath(path: string): boolean {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .some((segment) => GENERATED_OR_DEPENDENCY_SEGMENTS.has(segment.toLowerCase()));
}
