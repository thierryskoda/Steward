export type RuntimeClientError =
  | { kind: "offline"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "api"; code: string; message: string }
  | { kind: "parse"; message: string };

export function isRuntimeClientError(e: unknown): e is RuntimeClientError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as RuntimeClientError).kind === "string"
  );
}
