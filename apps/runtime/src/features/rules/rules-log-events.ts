/**
 * Canonical log messages for rules feature (rule apply, rule capture, learning-from-rejection, transcript).
 */

export const RULE_APPLY_WORKER_STARTED =
  "The rule-application worker has started and is looking for new rules to apply to your project.";
export const RULE_PROPOSAL_CREATED =
  "A new rule has been proposed based on your recent chat conversations.";
export const RULE_CAPTURE_FAILED_AGENT =
  "The system failed to extract a new rule from your chat conversation.";
export const RULE_APPLY_FAILED_AGENT =
  "The system failed to figure out how to apply a proposed rule to your files.";
export const RULE_APPLIED =
  "A new rule has been successfully added to your project's Cursor rules.";
export const RULE_CAPTURE_SKIPPED_DISABLED = "Rule capture is turned off in your settings.";
export const RULE_CAPTURE_SKIPPED_EMPTY_CONTENT =
  "Rule capture was skipped because the message was empty.";
export const RULE_CAPTURE_SKIPPED_ALREADY_SEEN =
  "This message has already been processed for rule capture.";
export const RULE_CAPTURE_SKIPPED_DUPLICATE_CORPUS =
  "The rule extracted from this message is already in your list of rules.";
export const RULE_CAPTURE_SKIPPED_AGENT_NO_RULE =
  "The AI decided that no new rule was needed from this message.";
export const RULE_CAPTURE_SKIPPED_DUPLICATE_RULE_TEXT =
  "This rule is exactly the same as one you already have.";
export const RULE_CAPTURE_SKIPPED_ALREADY_SEEN_RULE =
  "This specific rule has already been processed.";
export const RULES_STORE_PARSE_FAILED =
  "The system couldn't read one of your rule files, so it was skipped.";
export const LEARNING_FROM_REJECTION_WATCHER_STARTED =
  "The rejected-finding learning processor has started.";
export const LEARNING_FROM_REJECTION_STARTUP_SCAN_COMPLETED =
  "The initial scan for learning-from-rejection findings has finished.";
export const REJECTED_FILE_EVENT_RECEIVED =
  "The system found a rejected suggestion and is looking at your reason why.";
export const REJECTED_EVALUATION_RULE_CREATED =
  "Based on why you rejected a suggestion, the system has proposed a new rule to avoid making similar suggestions in the future.";
export const REJECTED_EVALUATION_SKIPPED =
  "The system looked at why you rejected a suggestion but decided not to create a new rule.";
export const LEARNING_FROM_REJECTION_FINALIZE_SKIPPED =
  "The system couldn't finalize a learning-from-rejection item because of a technical error.";
export const LEARNING_FROM_REJECTION_WATCHER_SKIPPED_NO_PATHS =
  "The learning-from-rejection processor was skipped because no categories are active.";
export const LEARNING_FROM_REJECTION_FINALIZED_TO_REJECTED =
  "A learning-from-rejection item has been finalized and moved to the rejected state.";
export const REJECTED_AGENT_RUNNING_SKIPPED_MISSING_CATEGORY =
  "Processing of a rejected item was skipped because its category could not be determined.";
export const REJECTED_AGENT_RUNNING_SKIPPED_TECHNICAL_ERROR =
  "Processing of a rejected item was skipped due to a technical error.";
export const CURSOR_MESSAGE_RECEIVED = "A new message was detected in a Cursor chat transcript.";
export const RULES_STARTUP_RECOVERY_MOVED_TO_READY =
  "A rule stuck in claimed or agent-running was recovered on runtime startup.";
export const RULES_STARTUP_RECOVERY_MOVE_FAILED =
  "The system failed to move a stuck rule to approved on startup.";
export const RULES_STALE_RECOVERY_MOVED_TO_READY =
  "A stale implementing rule was recovered to approved.";
export const RULES_STALE_RECOVERY_MOVED_TO_FAILED =
  "A stale implementing rule was recovered to failed.";
export const RULES_STALE_RECOVERY_MOVE_FAILED =
  "The system failed to move a stale rule to ready or failed.";
