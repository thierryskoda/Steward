# Product Ideas

This document collects active directions and unresolved product questions for Steward. These are backlog signals and areas for exploration, not committed roadmap promises.

## Active Ideas

- Let users choose which finding categories are enabled and which ones can be auto-implemented.
- Support multiple rule sources for category generation and make rule source selection explicit.
- Allow provider/model choice by stage: finding detection, option generation/planning, and implementation.
- Show agent transcripts in the UI with the reason for each change and the specific rules/project context the agent followed.
- Keep human gates where product or business direction is ambiguous, while allowing higher-autonomy flows for obvious fixes.
- Track current project goals, focus, and the main limiting factor blocking progress.
- Make "implemented" defensible with visible evidence such as tests, typecheck, smoke checks, and changed files.
- Add configurable autonomy levels for detection sensitivity, option count, rule-capture strictness, and auto-implementation behavior.
- Support undo/revert for automatically implemented changes, especially when verification fails.
- Keep the inbox high-signal by summarizing the problem, options, and expected change in a few bullets.
- Control generated project context and rules from the app instead of only ingesting existing repo docs.
- Revisit hosted execution later only if the security, privacy, and operations tradeoffs become worth it.
- Explore how reusable agent skills can improve implementation quality and user guidance.

## Open Questions

- What should the default auto-implement behavior be, and where must hard human gates remain?
- What minimum evidence should mark work as truly done?
- How should findings be prioritized as inbox volume grows?
- How much transcript and decision transparency do users need to approve changes confidently?
- When does hosted execution justify the added security, privacy, and operational complexity?
