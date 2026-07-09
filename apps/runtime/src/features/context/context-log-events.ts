/**
 * Log events for context feature (project-context snapshot).
 */
export const PROJECT_CONTEXT_SNAPSHOT_SOURCES_EMPTY =
  "No projectContext entries in config; project-context snapshot will be empty.";
export const PROJECT_CONTEXT_SNAPSHOT_REUSED =
  "Project context snapshot cache was reused; source docs have not changed.";
export const PROJECT_CONTEXT_SNAPSHOT_REGENERATING =
  "Project context snapshot cache miss; running extract-project-context agent.";
export const PROJECT_CONTEXT_SNAPSHOT_REGENERATED =
  "Project context snapshot was regenerated from source docs.";
export const PROJECT_CONTEXT_SNAPSHOT_EXTRACTION_FAILED =
  "Project context snapshot extraction failed; check logs for details.";
export const PROJECT_CONTEXT_SNAPSHOT_SOURCE_PATH_INVALID =
  "A projectContext path was skipped because it is outside the repo or not a file.";
