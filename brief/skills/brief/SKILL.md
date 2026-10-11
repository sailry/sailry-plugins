---
name: brief
description: Write an optional visual HTML brief for a complex design, PRD, technical review or incident report after the user requests or accepts HTML. The session document does not authorize executing a plan.
---

# HTML briefs

Keep the full ordinary plan in the conversation. Offer HTML only when diagrams,
tables or structured decisions improve understanding, and wait for the user's
choice. An explicit HTML request authorizes generation directly. Use `write_brief`
in the main session; delegated agents can contribute analysis to their parent,
but cannot create or revise a brief. Plan mode permits this session-owned
document, without permitting project writes or execution.

One template serves all document types. Write only the HTML fragment inside
`<main>`, without `<html>`, `<head>`, `<body>`, scripts, styles, event handlers,
external links or external images. The host supplies semantic theme colors,
fonts, local diagram libraries and interaction code. Do not generate JavaScript
or override the theme. Use a short title and card summary. After writing, report
the resulting document briefly; do not repeat its full HTML.

Before revising, call `read_brief` without a revision to inspect the current HTML,
then pass its exact `id` and latest `revision` as `expected_revision`. A conflict
requires another read; do not overwrite or retry with a guessed revision. Preserve
the user's previous decisions and content unless the requested change replaces them.

## Components

- Sections and contents: `<section data-title="Overview">...</section>`; use
  `h1` through `h4` for headings. Missing section headings are supplied from
  `data-title`. A lead paragraph uses `<p class="lead">`.
- Callouts: `<div class="callout info">`, `warn`, `risk` or `ok`.
- Tables: ordinary `table`, `thead`, `tbody`, `tr`, `th`, `td` and `caption`.
- Steps: `<ol class="steps">`; file changes: `<ul class="files">` with a
  `code` path and concise explanation in each `li`.
- Status: `<span class="badge new">`, `changed`, `removed` or `risk`.
- Alternatives: `<div class="compare"><div class="option" data-title="A">...
  </div><div class="option" data-title="B">...</div></div>`.
- Details: `<details><summary>Details</summary>...</details>`.
- Diagrams: `<pre class="mermaid">flowchart LR ...</pre>`. Use `flowchart LR`
  for pipelines, `flowchart TD` for hierarchy and decisions, `sequenceDiagram`
  for interactions, `stateDiagram-v2` for lifecycles, and `gantt` for schedules.
  Keep individual diagrams under 30 nodes, quote Unicode labels, and avoid
  experimental types, configuration directives, frontmatter, links and HTML labels.
- Charts: `<pre class="chart">` containing the same closed JSON shape as chat
  charts. Types are `line`, `bar`, `area`, `pie`, `radar`, `candlestick`, `sankey`.
  Data comes from the user's data or a cited source; do not fabricate measurements.
- Formulas: `<span class="math-inline">x^2</span>` for inline TeX and
  `<pre class="math">...</pre>` for an independent formula. Write the TeX source
  without dollar delimiters; the local renderer supplies mathematical layout.

```html
<pre class="chart">{"type":"bar","title":"Sales","data":[{"label":"Jan","value":120},{"label":"Feb","value":150}]}</pre>
```

For line, bar, area, pie and radar, points contain only `label` and numeric `value`.
Candlestick points contain only `label`, `open`, `high`, `low`, `close`, with
valid high/low bounds. Sankey uses `nodes:[{"id":"a","label":"A"}]` and
`links:[{"source":"a","target":"b","value":1}]`, and must be acyclic.
Optional `title` is a string. Do not pass arbitrary ECharts options, callbacks,
colors or fields. Each chart or diagram is limited to 64 KiB. A document body
is limited to 512 KiB after cleaning.

## Questions

When a brief contains unresolved decisions or information the user must confirm,
end it with a `brief-form` covering those items. Use radio choices for one answer,
checkboxes for multiple answers, and a textarea for additional context. Include
only decisions that remain open; preserve confirmed choices when revising.

Use a bounded declaration rather than executable controls. Form and field names
must start with a Latin letter and contain only letters, digits, `_`, `.` or `-`,
up to 64 characters. Use unique form and field names. Each form has at most
32 fieldsets and at most 64 controls per fieldset. Each control's `name` must
match its containing fieldset's `data-name`. A fieldset may carry `data-required`.
Radio and checkbox values and labels are at most 512 bytes; free text is at most
4,096 bytes. Total submitted answers are limited to 16 KiB.

```html
<form class="brief-form" data-name="decisions">
  <fieldset data-name="approach" data-required>
    <legend>Preferred approach</legend>
    <label><input type="radio" name="approach" value="a"> Approach A</label>
    <label><input type="radio" name="approach" value="b"> Approach B</label>
  </fieldset>
  <fieldset data-name="note">
    <legend>Additional context</legend><textarea name="note"></textarea>
  </fieldset>
  <button type="submit">Submit</button>
</form>
```

Answers are ordinary user messages referencing the document and version. While
a turn is active, they enter the normal message queue. They do not approve or
start execution, answer another pending question, or change the work mode.
Use `ask_user` separately when the actual plan review requires it.

## Suggested structure

Choose sections according to the user's needs; these are recommendations.

- Development design: goals and conclusion, current state, architecture,
  detailed flow/data design, changes, implementation steps, validation, risks
  and rollback, unresolved decisions.
- PRD: background and goals, users and scenarios, prioritized requirements,
  user flow, nonfunctional requirements, milestones, unresolved decisions.
- Technical review: conclusion, architecture and boundaries, decisions and
  alternatives, risks, remaining questions.
- Incident report: impact, timeline, root cause, response and recovery,
  improvements with owners and dates.
