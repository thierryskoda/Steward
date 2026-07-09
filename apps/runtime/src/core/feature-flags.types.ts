/**
 * Minimal feature-flag shape used by core runtime services.
 * Source of truth for flags lives in features/context; main injects that shape here.
 */
export type ICoreFeatureFlags = {
  genericFindingEnabled: boolean;
  rulesWorkflowEnabled: boolean;
  continualLearningEnabled: boolean;
  optionHintsEnabled: boolean;
};
