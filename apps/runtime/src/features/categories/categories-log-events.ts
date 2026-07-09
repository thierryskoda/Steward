/**
 * Canonical log messages for categories feature (generic category, approved, stale-context revalidation).
 */

export const CATEGORY_FILE_PARSE_FAILED =
  "A finding record could not be read because the data inside is invalid.";
export const CATEGORY_IMPLEMENTING_FILE_EVENT_RECEIVED =
  "The system claimed an approved finding for implementation.";
export const CATEGORY_IMPLEMENTING_WATCHER_STARTED =
  "The finding implementation worker has started.";
export const APPROVED_WATCHER_STARTED =
  "The finding implementation worker is polling approved findings.";
export const APPROVED_FILE_EVENT_RECEIVED =
  "The system detected an approved finding ready to be claimed.";
export const APPROVED_STARTUP_SCAN_COMPLETED =
  "The initial scan for approved findings has finished.";
export const APPROVED_FILE_SKIPPED_INVALID =
  "An item was skipped because its data was invalid or broken.";
export const APPROVED_CLAIMED_TO_IMPLEMENTING =
  "An item has been picked up and is now being implemented.";
export const APPROVED_CLAIM_MOVE_FAILED =
  "The system failed to mark an item as 'currently being implemented'.";
export const CATEGORY_GENERATION_STARTED =
  "The system is starting to look for potential issues in a specific category.";
export const CATEGORY_GENERATION_PERSISTING =
  "A potential issue has been found and is being saved for your review.";
export const CATEGORY_GENERATION_AUTO_APPROVED_SINGLE_OPTION =
  "An issue was automatically approved because there was only one clear way to fix it.";
export const CATEGORY_GENERATION_AUTO_APPROVE_FAILED =
  "The system tried to automatically approve a fix but failed to update its status.";
export const CATEGORY_GENERATION_DEDUPE_SKIPPED =
  "A potential issue was skipped because it was already found and is currently being handled.";
export const CATEGORY_GENERATION_COMPLETED =
  "The search for issues in this category has finished and all findings have been saved.";
export const CATEGORY_GENERATION_FAILED = "The system failed to look for issues in this category.";
export const CATEGORY_GENERATION_QUESTIONS_STARTED =
  "The AI is generating search questions for this category rule.";
export const CATEGORY_GENERATION_TECHNICAL_DETECT_STARTED =
  "The AI is starting its technical scan to detect potential issues.";
export const CATEGORY_GENERATION_CONSTRAINTS_STARTED =
  "The AI is generating implementation constraints for the finding.";
export const CATEGORY_CONSTRAINTS_COUNT_DEVIATION =
  "Constraints array length is not 3-12; accepted but prefer 3-12.";
export const CATEGORY_GENERATION_TECHNICAL_OPTIONS_STARTED =
  "The AI is starting to generate technical options for how to fix the detected issues.";
export const CATEGORY_HUMANIZATION_STARTED =
  "The AI is rewriting the technical findings into a decision-readable approval card.";
export const CATEGORY_HUMANIZATION_SKIPPED =
  "The AI skipped rewriting the findings because there was only one simple option.";
export const CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION =
  "Humanize output field below preferred length; accepted but prefer 8+ chars.";
export const CATEGORY_FINDING_TITLE_WORD_COUNT_DEVIATION =
  "Finding title is not 3-5 words; accepted but prefer 3-5 for consistency.";
export const CATEGORY_OPTION_NAME_WORD_COUNT_DEVIATION =
  "Option name is not 3-5 words; accepted but prefer 3-5 for consistency.";
export const CATEGORY_OPTION_TECHNICAL_PLAN_MIN_LENGTH_DEVIATION =
  "Option technicalPlan is shorter than 50 chars; accepted but prefer min 50.";
export const CATEGORY_GENERATION_FINDING_DROPPED_EXCLUDED_LOCATIONS =
  "A finding was dropped because one or more of its locations are in excluded paths (e.g. .steward); the finding was not persisted.";
export const CATEGORY_GENERATION_QUALITY_GATE_STARTED =
  "The AI is challenging the generated finding before it is saved.";
export const CATEGORY_GENERATION_QUALITY_GATE_ACCEPTED =
  "The generated finding passed the quality gate.";
export const CATEGORY_GENERATION_QUALITY_GATE_REPAIR_STARTED =
  "The generated finding needs repair before it can be saved.";
export const CATEGORY_GENERATION_QUALITY_GATE_DROPPED =
  "The generated finding did not pass the quality gate and was not saved.";
export const CATEGORY_GENERATION_SKIPPED_IN_FLIGHT =
  "The system skipped looking for issues in this category because it's already busy with an existing one.";
export const CATEGORY_ALL_BUSY =
  "All categories already have findings or are busy; skipping this cycle.";
export const CATEGORY_IMPLEMENT_SUCCEEDED =
  "The changes for this category were successfully applied.";
export const CATEGORY_IMPLEMENT_SKIPPED_INVALID =
  "The changes were skipped because the item describing them was invalid.";
export const CATEGORY_IMPLEMENT_SKIPPED_IN_FLIGHT =
  "The changes were skipped because they are already being applied.";
export const CATEGORY_IMPLEMENT_SKIPPED_STALE_CONTEXT_FAILED =
  "The item was stale (rules/context changed) and revalidation decided fail; moved to FAILED.";
export const CATEGORY_IMPLEMENT_FAILED =
  "The system failed to apply the changes for this category.";
export const CATEGORY_IMPLEMENT_MOVE_FAILED =
  "The changes were applied successfully, but the system failed to update the item's status.";
export const CATEGORY_IMPLEMENT_RESULT_PARSE_FAILED =
  "The implement agent run succeeded but its JSON output could not be parsed; lastImplementationResult will be missing.";
export const CATEGORY_IMPLEMENTED =
  "The item has been successfully implemented and marked as finished.";
export const CATEGORY_UNDO_SUCCEEDED =
  "The implementation for this item was successfully reverted.";
export const CATEGORY_UNDO_FAILED = "The system failed to revert the implementation for this item.";
export const CATEGORY_UNDO_RESULT_PARSE_FAILED =
  "The undo agent run succeeded but its JSON output could not be parsed; lastUndoResult will be missing.";
export const NEEDS_REVIEW_REVALIDATION_READ_FAILED =
  "The system couldn't read a review item, so it was skipped.";
export const RULES_SNAPSHOT_SOURCES_EMPTY =
  "No rule sources are configured; categories and rules will be empty until ruleSources is set.";
export const RULES_SNAPSHOT_REUSED =
  "Rules snapshot cache was reused; source docs have not changed.";
export const RULES_SNAPSHOT_REGENERATING =
  "Rules snapshot cache miss; running extract-rules-categories agent to regenerate from source docs.";
export const RULES_SNAPSHOT_REGENERATED =
  "Rules snapshot was regenerated from source docs (content or extractor version changed).";
export const RULES_SNAPSHOT_EXTRACTION_FAILED =
  "Rules snapshot extraction failed; check logs for details.";
export const RULES_SNAPSHOT_SOURCE_PATH_INVALID =
  "A rule source path was skipped because it is outside the repo or not a file.";
export const STALE_CONTEXT_SCAN_STARTED =
  "Stale-context scan started after rules or project-context snapshot refresh.";
export const STALE_CONTEXT_SCAN_COMPLETED =
  "Stale-context scan completed; keep/patch/fail counts reported.";
export const STALE_CONTEXT_SCAN_DECISION =
  "Stale-context revalidation decision for one item (keep, patch, or fail).";
export const STALE_CONTEXT_SCAN_REVALIDATION_FAILED =
  "Stale-context revalidation agent failed for one item.";
export const SNAPSHOT_REFRESH_FAILED_ON_GIT_POLL =
  "Rules or project-context snapshot refresh failed on git poll; check logs for details.";
export const STALE_CONTEXT_SCAN_FAILED_AFTER_REFRESH =
  "Stale-context scan failed after snapshot refresh; check logs for details.";
export const OPTION_HINT_CANDIDATE_CREATED =
  "A new option-hint candidate was created from user feedback.";
export const OPTION_HINT_CANDIDATE_SKIPPED =
  "Option-hint candidate creation was skipped due to low-signal or duplicate input.";
export const OPTION_HINTS_LOADED = "Option hints were loaded for option generation.";
export const OPTION_HINT_APPLIED = "An option hint was applied to the option-generation prompt.";
export const OPTION_HINT_SKIPPED_LOW_SIMILARITY =
  "An option hint was skipped because it did not match the current finding strongly enough.";
export const OPTION_HINT_SUPPRESSED_BY_RULE =
  "An option hint was suppressed because stronger rule/context guidance takes precedence.";
export const OPTION_HINTS_DISABLED_BY_CONFIG =
  "Option hints are disabled in config for this project.";
