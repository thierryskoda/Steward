const CATEGORY_LABELS: Record<string, string> = {
  rule: "Rule",
  dead_code: "Dead code",
  unfollowed_rules: "Unfollowed rules",
  bad_smell: "Bad smell",
  observability_gaps: "Observability gaps",
  error_handling_integrity: "Error handling integrity",
  security_hygiene: "Security hygiene",
  architecture_coupling: "Architecture coupling",
};

const STATUS_LABELS: Record<string, string> = {
  "needs-review": "Needs review",
  "learning-from-rejection": "Learning from rejection",
  approved: "Approved",
  claimed: "Claimed",
  "agent-running": "Agent running",
  implemented: "Implemented",
  failed: "Failed",
  rejected: "Rejected",
};

function slugToSentence(slug: string): string {
  const words = slug.replace(/-/g, "_").split("_");
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export function getCategoryLabel(type: string): string {
  return CATEGORY_LABELS[type] ?? slugToSentence(type);
}

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? slugToSentence(status);
}
