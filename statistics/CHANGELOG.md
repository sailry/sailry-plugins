## 0.1.46

- Show end-to-end TPS in the composer footer and Usage report, including time to first token. Show `—` when throughput is unavailable.

## 0.1.45

- Distinguish unreported cache reads from zero hits and show cache write counts in request tooltips.

## 0.1.44

- Show available cache token counts and response coverage when the overall hit rate is unknown.

## 0.1.43

- Distinguish known token subtotals from complete totals when a response omits token counts.

## 0.1.42

- Remove the stale-host notice from the Usage page.

## 0.1.41

- Clarify the regression test name for generation speed and first-token latency.

## 0.1.40

- Update the Chinese label for subagents in session statistics.

## 0.1.39

- Clarify how generation speed is measured in the usage report and session statistics.

## 0.1.38

- Fill the activity heatmap with history beyond the selected range, keep its filters, and space its title from the grid

## 0.1.37

- Fill the activity heatmap with square days sized to the card, ending at the latest date.

## 0.1.36

- Show the activity calendar in a separate card with square day cells.

## 0.1.35

- Show the activity heatmap for 30-day and 90-day ranges as well as one year, as a weekly calendar
- Wait for the matching report when the date range changes

## 0.1.34

- List projects from all execution hosts, including projects without usage, and route project and provider filters to their owning host
- Combine all-project usage across hosts, retain model filtering and show partial host failures

## 0.1.33

- Leave the context ring and its panel to the application, which now shows them in the composer

## 0.1.32

- Shorten test labels without changing assertions

## 0.1.31

- Show the Usage tables as compact bordered tables with plain model and session names, the cache rate as a percentage and the share beside its bar

## 0.1.30

- Restore outline icons in navigation and tools

## 0.1.29

- Use a new plugin icon

## 0.1.28

- Label time to first token as TTFT

## 0.1.27

- Require Sailry 0.1.3 for first-token timing data

## 0.1.26

- Show time to first token (TTFT) measured at the first streamed reasoning, text or tool call

## 0.1.25

- Show tooltips on context step bars, markers and notes, including the step's model

## 0.1.24

- Show step bars from the first step and fill the connection row with session speed when API response time is unavailable
- Group tool calls by tool name instead of internal plugin and MCP aliases

## 0.1.23

- Narrow the context panel and show only measured values, with fixed-width step bars and a cache hit bar

## 0.1.22

- Show measured session composition when some categories are unknown and separate bar segments

## 0.1.21

- Align context metric values and units using shaped text baselines

## 0.1.20

- Show session connection averages and toggle context step details

## 0.1.19

- Use the same session average speed in the footer and context details

## 0.1.18

- Keep slow connection observations visible using the semantic error color

## 0.1.17

- Keep the normal page visible while its initial data loads

## 0.1.15

- Show one context history step per conversation round, keep metric units and capacity subordinate, and align context and elapsed-time bars

## 0.1.16

- Align context charts, metric units and section order with the shared statistics layout.

## 0.1.14

- Show per-request API response timing and latency colors, restore connection icons, and align context figures and expandable rows, with session composition directly below usage

## 0.1.13

- Match the approved context panel spacing, metric baselines and connection layout; expand details below their controls and restore saved session metrics before message pages load

## 0.1.12

- Keep compaction budgets in the meter and explain partial source attribution on hover

## 0.1.11

- Show scoped context, session usage, active time, connection observations and composition in the session header
- Keep unknown measurements distinct from zero and history selection separate from current occupancy

# Changes

## 0.1.10

Keep the composer ring passive and show compact context details from the statistics row on hover. Hide unavailable measurements.

## 0.1.9

Show context usage, effective compaction budgets and the latest maintenance record in the composer popover. Preserve unknown measurements and the model capacity attached to each observation.


## 0.1.8

- Show an estimated current context after compaction without changing recorded usage or cost

## 0.1.7

- Pair context usage with the model limit captured for that response

## 0.1.6

- Add marketplace category and icon color
