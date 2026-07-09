# Review Workflow Transcript

Use this command to evaluate one workflow item JSON and return a concise summary of what to improve in the flow (prompts, context, agent behavior).

Argument: path to a workflow item JSON under `.steward/` (e.g. `.steward/categories/context-freshness/implemented/<id>.json`).

## Mission

- Read the item JSON (finding, options, selectedOptionId, etc.).
- Use transcript from `lastImplementationTranscript.entries` if present; else resolve `workflowChatId` and read `agent-transcripts/<workflowChatId>.jsonl`.
- Evaluate the **whole run**: what context was passed in each user message, whether the assistant followed instructions, and whether the flow is aligned with “same chat, minimal repeated context.”
- Produce only a **short improvement summary**: what to change (e.g. too much context, wrong context, assistant confused, repetition).

## What to evaluate

- **Context per user message**
  - Repeated static context (AGENTS.md, README.md, full rules) after first message → noise.
  - Rule text repeated when only questions/task change needed.
  - In-flight findings: should be same-category only (pending/ready-to-implement/queued/processing).
  - Finding/locations/constraints re-sent every message vs. light anchor (e.g. title/findingKey).
- **Task relevance**
  - Implementation step: should receive selected option’s `technicalPlan`, not a regenerated “fixPlan.”
  - Coding rules block in options step → unnecessary.
- **Assistant behavior**
  - Confusion, wrong output format, ignored constraints, rushed or repetitive replies.

## Required output format

- **Transcript**: `[<short title ≤6 words>](<workflowChatId>)`
- **Improvements** (bullets only, most important first):
  - Max 5–7 bullets.
  - Each: what’s wrong + what to do (e.g. “Msg 2: drop rule block; questions only.” “Msg 5: pass selected option technicalPlan, not fixPlan.”).
  - Extremely concise. Sacrifice grammar for density.
- No other sections. No long prose.

## Guardrails

- Don’t invent content; if something is ambiguous, say so in one short phrase.
- Prefer fewer, high-impact bullets over long weak lists.
- Total response under 200 words.
- If argument missing or file not found, ask for the JSON path.
