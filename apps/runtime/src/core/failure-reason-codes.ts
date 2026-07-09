/**
 * Canonical failure reason codes and detail strings for parse/read/file-access failures.
 * Single source of truth; do not duplicate these literals across features.
 */

export const PARSE_FAILED = "parse_failed" as const;
export const PARSE_FAILED_DETAILS = "parse failed";

export const READ_FAILED = "read_failed" as const;
export const READ_FAILED_DETAILS = "read failed";
export const READ_FILE_DETAILS = "Could not read file";

export const OUTSIDE_REPO_OR_INVALID = "outside repo or invalid";
export const NOT_A_FILE = "not a file";

export type IFailureReasonCode = typeof PARSE_FAILED | typeof READ_FAILED;
