# Analyze Logs

Goal: analyze logs and surface real issues fast.

Input: `$ARGUMENTS`

- Can be pasted raw logs.
- Can be a file path to logs.
- If missing, ask for logs or file path.

## Mission

- Find bugs, risks, and high-value improvements.
- Prioritize concrete, actionable signal.
- Be very concise. No fluff.

## Workflow

1. If `$ARGUMENTS` is a path, read file content first.
2. Parse logs by severity/time/context.
3. Identify:
   - clear bug indicators (errors, crashes, invariant breaks, bad state transitions)
   - reliability issues (retries looping, timeouts, noisy failures, missing guards)
   - observability gaps (missing IDs/context, unclear failure cause)
4. Keep only highest-impact findings.

## Required output format

Use only repeated blocks below. No extra sections.

`bug:`
`<one-line bug statement>`
`fix:`
`<one-line fix>`

If no clear bug exists, use:

`bug:`
`no confirmed bug from provided logs`
`suggestion:`
`<one-line logging or investigation improvement>`

## Constraints

- Each line short and plain.
- No speculation without saying uncertainty.
- Don’t restate raw logs unless needed for clarity.
