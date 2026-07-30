/** Stable, content-free operational events for the documentation refresh loop. */
export const DOCUMENTATION_REFRESH_RUN_QUEUED = "Documentation refresh run queued.";
export const DOCUMENTATION_REFRESH_RUN_STARTED = "Documentation refresh run started.";
export const DOCUMENTATION_REFRESH_RUN_COMPLETED = "Documentation refresh run completed.";
export const DOCUMENTATION_REFRESH_RUN_RETRYING = "Documentation refresh run retrying.";
export const DOCUMENTATION_REFRESH_RUN_FAILED = "Documentation refresh run failed.";
export const DOCUMENTATION_REFRESH_RUN_SUPERSEDED = "Documentation refresh run superseded.";
export const DOCUMENTATION_REFRESH_LEASE_BUSY =
  "Documentation refresh run remains queued because the global worker is busy.";
export const DOCUMENTATION_REFRESH_INTAKE_FAILED =
  "Documentation refresh intake failed before a terminal run outcome.";
export const DOCUMENTATION_REFRESH_RECOVERY_COMPLETED =
  "Documentation refresh startup recovery completed.";
