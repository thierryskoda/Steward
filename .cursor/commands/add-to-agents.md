# Add Rule

Use this when I want to add a new rule to `AGENTS.md`. Ensures the rule fits the existing content and avoids duplicates or contradictions.

## Input

- `$ARGUMENTS`: the rule (or rule intent) to add. May be full rule text, a bullet list, or a short description of the behavior to enforce.

## Mandatory behavior

1. **Review AGENTS.md**
   - Read `AGENTS.md` in full.
   - Summarize each top-level section (`## …`) and relevant subsections (`### …`) so you can compare with the new rule.

2. **Contradiction check**
   - If the new rule **contradicts** any existing rule (same topic, opposite or incompatible guidance): **stop**. Do not add. Report: which rule(s) conflict, how, and that the user should resolve before adding.

3. **Overlap / duplicate check**
   - If the new rule is **already covered** by existing content (same intent, same or stricter constraints): **stop**. Tell the user it’s already present and cite section.
   - If the new rule **overlaps** but adds nuance: **do not add a second rule**. Propose a single reformatted version of the **existing** bullet/paragraph that encompasses both. Show diff or proposed text; apply only after user approval.

4. **Placement decision**
   - If the new rule is distinct and non-contradictory:
     - Prefer **adding to an existing section** when the new rule clearly belongs there (e.g. same theme: Coding Standards, Product Constraints, etc.). Use the same format: `## Section` or `### Subsection`, bullet list, concise imperative.
     - **Add a new section or subsection** only when the rule does not fit any existing one. Match AGENTS.md style (no frontmatter; `##` / `###` and bullets).

5. **Write**
   - Apply the add or the reformat in one edit. Keep wording consistent (concise, imperative, no fluff).

## Output format (before editing)

- **Rule to add:** (restate or quote `$ARGUMENTS`).
- **Sections reviewed:** (short theme per section).
- **Contradiction?** Yes → stop and report. No → continue.
- **Overlap/duplicate?** Already covered → stop and cite. Overlap → propose reformat of existing content only. Neither → continue.
- **Placement:** (existing section/subsection, or new section name + rationale).
- **Proposed change:** (exact text or diff). If reformat, show before/after.
- **Applied:** (only after user confirms, or if no contradiction/duplicate and placement is obvious).

## Constraints

- Never add a rule that contradicts existing content; always stop and inform the user.
- Never duplicate; either stop and cite or merge into one reformatted rule.
- Follow AGENTS.md format: `## Section`, `### Subsection`, bullet list; no frontmatter.
- One command run = one add or one reformat; do not add multiple new sections unless the user explicitly asks for multiple distinct rules.
