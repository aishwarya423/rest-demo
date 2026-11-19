# Writing the documents this repo produces

Five genres, each with an established shape. Match the genre first, then follow
its skeleton. Existing examples live in `Docs/Hive-docs/`.

## Contents

- [House rules for all genres](#house-rules-for-all-genres)
- [Genre 1: deep spike analysis](#genre-1-deep-spike-analysis)
- [Genre 2: spike closure](#genre-2-spike-closure)
- [Genre 3: decision / question page](#genre-3-decision--question-page)
- [Genre 4: lead brief](#genre-4-lead-brief)
- [Genre 5: speaker notes and demo walkthroughs](#genre-5-speaker-notes-and-demo-walkthroughs)
- [Slide decks](#slide-decks)

## House rules for all genres

**Label provenance.** Findings are `[Verified]` (executed here, or read from
shipped package source), `[Documented]` (stated in vendor docs, not exercised)
or `[Unverified]`. The deep analysis puts this in a blockquote near the top:
*"Nothing is asserted from memory. Versions are pinned throughout."* That rule
is what makes these documents worth reading, so hold to it — if you did not run
it, say which of the three it is.

**Pin versions.** `hive-router` 0.3.12, `hive@15.0.1`, Hive CLI 0.68.2,
`@theguild/federation-composition` 0.27.0, and so on. A finding without a
version has a short shelf life.

**Say what was not validated.** Every one of these documents has an explicit
gap section — "Not validated", "What this does not prove", "Outstanding, with
reasons". Readers trust the verified parts more when the unverified parts are
named. Never let a gap go unmentioned to make a conclusion look stronger.

**State confidence separately from direction.** The pattern used is
*"Confidence: High on direction, Medium on operational sizing."* Splitting it
is more useful than one blended number.

**Lead with the finding that reframes the question.** The capability analysis
opens by establishing that Grafbase is end-of-life and Hive is its
vendor-designated successor, because that changes what the spike is even asking.
If one finding dominates, put it in section 1, not section 6.

**Tables for anything comparative.** Decision matrices, capability
comparisons, before/after, cost. Prose for reasoning, tables for facts.

**Link related documents** by relative path in the metadata block.

**British spelling**, consistent with the existing corpus: *licence* (noun),
*behaviour*, *organisation* where it is prose rather than a product's own term.
Keep product and API spellings exact — `Organization Access Tokens` in Hive's UI
stays as Hive writes it.

## Genre 1: deep spike analysis

The long one. Example:
`Docs/Hive-docs/CONFLUENCE-WDCS-25885-Hive-Capability-Analysis.md` (~690 lines).

```markdown
# <JIRA-ID> — SPIKE: <Title>

**Jira:** <ID> · **Status:** <state>
**Date of investigation:** <YYYY-MM-DD>
**Repository:** `<repo>` · branch `<branch>`
**Related spike:** [<ID> — <title>](<relative path>)

> **Provenance.** Findings are labelled **[Verified]** ... **[Documented]** ...
> **[Unverified]**. Nothing is asserted from memory. Versions are pinned
> throughout.

---

## 1. Overview
## 2. Problem Statement
## 3. Objectives and Scope      ### In scope / ### Out of scope
## 4. Existing Implementation and Investigation
## 5. Approach Evaluated
## 6. Findings and Evidence     ### 6.1 … one subsection per acceptance criterion
## 7. MVP Implemented — and why one was necessary
## 8. Results and Validation    ### The finding that matters / ### Not validated
## 9. Comparison and Trade-offs ### decision matrix / ### versus status quo / ### trade-offs
## 10. Limitations and Risks
## 11. Recommendation           ### Recommendation / ### Rationale / ### Confidence / ### Next steps
## 12. Conclusion
## 13. Acceptance Criteria and Completion Status
## 14. References               ### Official documentation / ### Repositories and licences / ### Versions pinned
```

Map section 6 subsections onto the acceptance criteria one for one, and mark
each **CONFIRMED** / **PARTIAL** / **NOT MET** in the heading. Section 13 then
closes the loop as a table, plus "Additional findings beyond the stated
criteria" and "Outstanding, with reasons".

## Genre 2: spike closure

The shorter sibling, for the Jira ticket itself. Example:
`CONFLUENCE-WDCS-25885-Spike-Closure.md` (~230 lines). Same title and metadata
block, but trimmed to what a reviewer needs to close the ticket:

```markdown
## 1. Overview          (+ a component table if the subject has parts)
## 2. Background
## 3. Scope             ### 3.1 Proof of Concept & Demo
## 4. Evaluation Summary  ### one subsection per component, each with version + licence
## 5. Comparison Matrix
## 6. Risks
## 7. Recommendation
## 8. Next Steps
## 9. Spike Closure
```

Component headings carry version and licence inline:
`### 4.2 Hive Router (Rust) — v0.3.1, MIT`.

## Genre 3: decision / question page

For "should we do X?" rather than "what did we find?". Example:
`CONFLUENCE-REST-Integration-Options.md`.

```markdown
# <The question, as a question>

## TL;DR               — the answer, in a few lines, up front
## 1. The question     — why it is being asked now
## 2..N                — one section per option or product, with verdicts
### Side by side with <the incumbent>
### The one real difference from <the incumbent>
## N+1. Where the complexity actually is
## N+2. Options if we keep <X>
### Option A: … ✅ partly verified
### Option B: …
## N+3. The honest trade-off
## N+4. Recommendation
### Suggested next step
## Appendix: questions we should expect
```

Two habits worth copying: options are lettered and carry a verification marker
(`✅ partly verified`), and the document ends with **the questions the audience
will ask**, answered. That appendix is often the most-read part.

## Genre 4: lead brief

One screen, for someone with five minutes. Example:
`Hive-Self-Hosting-Lead-Brief.md` (~110 lines).

```markdown
# <Subject> — 5 minute brief

**Question:** …
**Answer:** **<one word>.** …
**Catch:** …

Full detail: [<link>](<path>)

## 1. What we asked vs what we found     — table, ✅/❌ per question
## 2. What stays inside our network      — table
## 3. What we give up                    — table, with "does it matter to us?"
## 4. Cost                               — table, cloud vs self-hosted
## 5. What we would run                  — table
## 6. The one real problem
## 7. Recommendation                     — phased table with effort estimates
## 8. Three questions to ask <vendor>

## Bottom line
> blockquote, 2–3 sentences
```

Tables carry ✅ / ❌ / ⚠️ in the answer column. Phase recommendations separate
"is this good?" from "can we run it?" and give each an effort size. The closing
blockquote is the sentence that gets pasted into chat — write it last and make
it standalone.

## Genre 5: speaker notes and demo walkthroughs

For presenting, not reading. Written for someone who will be talking over it.

- Per section: **what it is / why it matters / how it works / what to say.**
  The "what to say" line is the one that earns its place — give an actual
  sentence, not a topic.
- Explain packages and jargon in plain terms the first time. The audience is
  often new to the stack.
- Call out the moment that lands. For this repo it is the silent log pane on a
  cache hit, and the 2-not-5 REST calls after a targeted purge. Say explicitly
  where to pause.
- End with **likely questions and answers**. Anticipate the sceptical ones:
  why not just cache at the gateway, what happens if Redis dies, what does this
  cost to run, why Router over Gateway.
- Command sequences go in order, one per block, with the expected output
  described. A reader should be able to follow without the presenter.

For the live demo sequence specific to this stack, see the "Running a demo
live" section of `references/operations.md` rather than reinventing it.

## Slide decks

Two decks are checked in as `.pptx` under `Docs/Hive-docs/`
(`WebCoP-Hive-GraphQL.pptx`, `Intro-GraphQL-Federation-Hive.pptx`). **Their
build scripts are no longer in the repo** — only the outputs survive. So a
request to change a deck means either editing the `.pptx` directly or
regenerating from scratch; check with the user which they want before starting.

If regenerating, these lessons came out of building those decks and are worth
not rediscovering:

- **Generate from a script** (pptxgenjs), with every coordinate derived from one
  grid constant and every font size from one type scale. Alignment then holds
  by construction instead of being nudged per slide.
- **Define a body band** — a fixed top *and bottom* for content. Without a
  bottom, slides pack into the top two-thirds and leave a dead strip above the
  footer. Size panels to their contents, or stretch them to the bottom; a panel
  much taller than its text reads as an empty box.
- **pptxgenjs does not set `xml:space="preserve"`**, so PowerPoint is free to
  strip leading whitespace and flatten the indentation in every code block. A
  post-processing pass over the slide XML is required, not optional.
- **Visual QA needs real rendering.** This machine has no LibreOffice and no
  `pdftoppm`. A geometry audit that reads shape positions catches off-slide and
  overlap bugs but misses "this looks wrong"; rendering the deck to SVG and
  viewing it in a browser is what actually surfaced dead space, oversized
  panels and a box overflowing its container.
- Speaker notes belong in the notes field, never in a text box on the slide.
