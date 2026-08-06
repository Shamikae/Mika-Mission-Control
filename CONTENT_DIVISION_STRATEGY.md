# Mika — Content Division Strategy

**From production infrastructure to a Content Operating System**

Version 1.0 · 2026-08-05 · Audit basis: `main` @ `537d96b`

---

## Executive Summary

The production infrastructure milestone is real. Five providers, an execution engine with queueing, locking, retry, and reconciliation, a cost governor, an artifact store, and a publishing router all exist as working code. That was hard, and it is done.

The audit found something else, and it is the finding that should drive the next phase:

| Store | Records |
|---|---|
| `data/hyperframes-runs/` | **190** |
| `data/production-jobs/` | **10** |
| `data/content-packages/` | **8** |
| `data/content-requests/` | **0** |
| `data/content-workforce-runs/` | **0** |
| `data/research-runs/` | **0** |
| `data/publish-jobs/` | **0** |

A seven-stage Content Workforce exists and is well built — research → script → storyboard → prompts → thumbnail → caption → review, with schema validation, editable overrides, explicit downstream invalidation, and a budget gate. **It has never been run. Not once.**

Every one of the eight content packages that reached production was hand-assembled as a smoke test. Their filenames say so: `pack-heygen-live-approved-test`, `pack-higgsfield-test1`, `pack-openart-video-test1`, `pack-hyperframes-smoketest`. Their `brand` fields say so: `"OpenArt Video Smoke Test"`. Their scripts say so: `"Not used by OpenArt Video generation."`

And nothing has ever been published. Zero publish jobs.

**Mika is currently a factory with a fully commissioned assembly line, no design department in operation, and no loading dock in use.** It can manufacture video. It has never originated an idea, and it has never shipped a post.

This document argues that the next phase is not to build more. It is to make what exists reachable, prove the loop once end to end, and then attach the three things that convert media into money: an idea supply, an offer binding, and an attribution trail.

**The single highest-value action available right now costs zero lines of new architecture: run the Content Workforce once, on a real brand, and publish the result.** Everything else in this roadmap is downstream of what that reveals.

---

# Phase 1 — Product Audit

## 1.1 How an operator actually reaches content

The sidebar (`lib/navigation/workspaceRegistry.js`) exposes five groups and 27 destinations. The Content group has six:

`Pipeline` · `Studio` · `Video` · `Thumbnails` · `SEO` · `Kanban`

Two of those six (`Thumbnails`, `SEO`) are marked `state: 'staged'` — placeholders.

The remaining content surface is almost entirely inside **one** of those six items. `components/content/StudioWorkspace.jsx` renders a flat, unordered bar of **fifteen peer tabs**:

```
Create Brief · Platform Studio · Viral Workflow · Asset Gallery · Detailed Library
Analytics · Mika Twin · Content Factory · Content Pack · Package Pipeline
Production Router · HyperFrames Studio · Publishing Router
Content Orchestrator · Creative Director
```

This is the central usability failure of the product. The entire Content OS — intake, generation, packaging, routing, rendering, publishing, and review — is fifteen equal-weight tabs behind a single sidebar word, presented in no causal order, with no indication of which comes first, which is current, or which are alternatives to each other.

An operator opening Studio for the first time has a 1-in-15 chance of starting in the right place, and no signal telling them they guessed wrong.

## 1.2 Page-by-page findings

| Surface | Purpose | Obvious? | Belongs? | Finding |
|---|---|---|---|---|
| **Mission Control** | Agent/gateway/queue status | Yes | Yes | Shows *system* health, never *content* state. An operator cannot learn "what should I work on" here. |
| **Diamond Control** | Command intake + routing; hosts costs, activation, agent control, dispatch, engineering as subviews | Partly | Yes | Reasonable catch-all. Absorbs 7 legacy routes cleanly. |
| **Pipeline** (`ContentPipelineBoard`) | 5-column board: Inbox → Brief → Script → Review → Published | Yes | **Overlaps** | Duplicates `Kanban`. Also duplicates the workforce's own stage model with *different* stage names. |
| **Kanban** (`ContentKanban`) | Content production board | Yes | **Duplicate** | Second board over the same domain. Two boards, one truth. |
| **Studio** | Everything else | **No** | Needs split | 15 peer tabs. See 1.1. |
| **Studio › Create Brief** | Content request intake | Yes | Yes | **This is the real front door and it is buried at tab 1 of 15 inside a generic word.** |
| **Studio › Creative Director** | Request list → hosts `ContentWorkforcePanel` | No | Yes | The seven-stage engine lives *here*, two levels deep, behind a name that sounds like a role, not a workflow. |
| **Studio › Content Factory** | Package creation | No | **Redundant** | One of three ways to make a content package. |
| **Studio › Content Pack** | Package generation via OpenRouter | No | **Redundant** | Second way. |
| **Studio › Package Pipeline** | Package stage management | No | **Redundant** | Manages the same object the Pipeline board manages. |
| **Studio › Content Orchestrator** | Cross-object health graph | No | Yes | Genuinely useful. Buried at tab 14. |
| **Studio › Production Router** | Provider routing + execution | Yes | Yes | Strong. Correctly out of scope for this phase. |
| **Studio › Publishing Router** | Publish jobs, validation, export | Yes | Yes | Well built. Never used (0 jobs). |
| **Studio › Analytics** (`AnalyticsRoom`) | Performance metrics | Yes | Yes | **Renders a literal `MOCK DATA` badge.** Hardcoded `STUDIOS` and `METRICS` arrays. |
| **Studio › Platform Studio** | Per-platform sub-tabs | Yes | Yes | 8 sub-tabs (TikTok, Instagram, LinkedIn, YouTube, Pinterest, X, Blog, Podcast). |
| **Video** | Video factory + router architecture | Partly | **Overlaps** | Overlaps Production Router and HyperFrames Studio. Third route to video. |
| **Thumbnails / SEO** | — | — | — | `state: 'staged'`. Placeholder render. Dead ends. |
| **Business group** | Leads / Offers / Clients / Revenue / Projects | Yes | Yes | Real CRUD + JSON stores. **Zero linkage to content.** |

## 1.3 Duplicated functionality — confirmed

**Three independent paths create a content package:**

1. `POST /api/content/pack/create` → `savePackage()` — direct, from the Content Pack tab
2. `POST /api/creative-director/requests/[id]/create-package` → `packageFromRequest.js` → `savePackage()`
3. `POST /api/creative-director/workforce/[id]/create-package` → `packageFromWorkforceRun.js` → `savePackage()`

Only path 3 produces real creative work. **Path 2 is actively dangerous.** `lib/creative-director/creativeDirectorRules.js:158-176` emits a package containing:

```js
hooks: [{ text: `[Placeholder — Script Writer agent to draft] Hook for: ${request.topic}` }],
script: { opening: '[Reserved for Script Writer agent]', body: '[Reserved for Script Writer agent]' },
caption: `[Draft caption placeholder for "${request.topic}" — Caption Writer agent to finalize]`,
scenes: [],
```

That package is structurally valid. It can be approved, routed, and **sent to a paid provider**, where it will spend real money rendering the literal string `[Reserved for Script Writer agent]`. This is a live money-burning trap, one button away from the Creative Director workspace.

**Other duplication:**
- Two kanban boards (`ContentPipelineBoard`, `ContentKanban`) over one domain
- Three video entry points (Video workspace, Production Router, HyperFrames Studio)
- Two stage vocabularies: the pipeline board's `inbox|brief|script|review|published` vs the workforce's `research|script|storyboard|prompts|thumbnail|caption|review`

## 1.4 Dead ends

**Eight orphaned components** — built, styled, never imported anywhere:

```
components/sections/  BlogStudio · InstagramStudio · LinkedInStudio · PinterestStudio
                      PodcastStudio · TikTokStudio · TwitterStudio · YouTubeStudio
```

**Staged placeholders that render nothing operational:** Claude, Gemini, Codex, Antigravity, Free Claude Code, Paperclip, Thumbnails, SEO.

**Mock-data surface presented as a workspace:** Analytics.

## 1.5 What prevents someone from creating content

Six blockers, in order of severity:

1. **The front door is unfindable.** Real intake is Studio → tab 1 of 15 → "Create Brief". Nothing in Mission Control or the sidebar points there.
2. **Brand, platform, and goal are unconstrained free text.** `creativeDirectorRules.js:100-119` validates only non-empty and clamps length — `brand` to 200 chars, `goal` to 300. Eight brands are configured in `config/openclaw.config.js`, and none of them are offered as choices. Every typo silently forks the dataset.
3. **The idea must already exist.** `topic` is required at intake. Mika cannot tell you what to make — it can only execute a topic you bring.
4. **Approval fatigue.** A single video can pass through up to six approval surfaces: per-stage workforce approval, run-level approval, package pipeline gates, production job review, production job approve, and publish validate→ready→publish. For a solo operator, this is the difference between shipping daily and shipping never.
5. **The placeholder trap** (1.3) makes the wrong path cheap and the right path long.
6. **No next-action signal anywhere.** Nothing in the product says "you have 3 packages awaiting review and 1 render finished."

---

# Phase 2 — Business Goal Review

The objective is revenue through content, not media generation. Scored against that bar.

| # | Category | Maturity | Evidence | Missing | Priority | Business impact |
|---|---|---:|---|---|---|---|
| 1 | **Research** | **65%** | Real engine (`lib/research/`): Exa + Tavily adapters, evidence model, source quality, URL safety, query planning, run store, budget gate. Wired to the workforce via `prepareContext`. | 0 runs executed. No standalone workspace. No reusable research corpus — findings die with the package. | **High** | Foundation for everything upstream. Already paid for; not switched on. |
| 2 | **Trend discovery** | **5%** | Nothing. "Trend" appears only as prompt vocabulary. | Every part: signal sources, social listening, keyword volume, competitor monitoring, scheduled scanning. Research is *pull*; there is no *push*. | **High** | Determines whether content is timely. Timeliness is most of organic reach. |
| 3 | **Idea generation** | **10%** | None. Pipeline begins at a request that requires `topic`. | Idea object, idea bank, scoring, dedup, idea→request promotion. | **Critical** | **The #1 throughput ceiling.** Mika's output is currently capped by how many ideas a human types in. |
| 4 | **Content planning** | **15%** | Two kanban boards over individual items. | Calendar, cadence, series, batching, per-brand plan object, capacity view. | High | Turns sporadic output into a publishing schedule. Schedule drives compounding. |
| 5 | **Hook generation** | **70%** | `scriptStage` produces `hooks[]` with `angle`; `selectedHook` is an editable override. | Hook bank, cross-content reuse, performance feedback, systematic variants. | Medium | High leverage once analytics exists — hooks are the highest-ROI thing to learn from. |
| 6 | **Script writing** | **80%** | `scriptStage`: schema-validated, repair retry, editable `selectedHook`/`fullText`/`cta`. Strongest creative stage. | Brand voice model (`style` is free text), no memory of past scripts, no runtime calibration. | Medium | Quality is adequate. Consistency is not. |
| 7 | **Storyboarding** | **75%** | `storyboardStage` → `scenes[]` (order, duration, visual, voiceover, onScreenText) feeding `promptsStage`. | Visual continuity references, shot-level asset binding, cheap preview before paid render. | Medium | Preview-before-spend directly reduces provider cost. |
| 8 | **Production** | **90%** | Execution engine, queue, locks, retry, reconciliation, per-provider cost preview, artifact store, 5 providers, 190 runs. | Nothing material. | **Freeze** | Done. Out of scope by instruction, and correctly so. |
| 9 | **Publishing** | **35%** | Router, job store, validation, per-platform checklist, ZIP export — all real and well built. | **All 7 platforms are `status: 'manual-export'`.** No automated posting. 0 jobs ever created. | Medium | Manual export is a workable v1. Not the current bottleneck. |
| 10 | **Lead generation** | **20%** | `LeadsWorkspace`, `leads.json`, full CRUD. | No content↔lead link. No capture, no UTM, no CTA→destination binding, no attribution. | **Critical** | **Content currently cannot generate a lead, because it carries no destination.** |
| 11 | **Affiliate monetization** | **0%** | Nothing. Word appears only in mock copy. | Link management, offer registry, disclosure handling, click tracking, commission reconciliation. | High | Fastest revenue path from existing content volume. Low build cost. |
| 12 | **TikTok Shop** | **0%** | Nothing. | Product catalog, shoppable video fields, creator/product binding, commission tracking. | Low | High ceiling, high integration cost. Sequence after 11. |
| 13 | **Digital products** | **5%** | `OfferLibrary` exists as a catalog concept, disconnected from content. | Product object, checkout, delivery, fulfilment, entitlement. | Medium | Best margin, but needs 10 and 11 first to drive traffic. |
| 14 | **Client content creation** | **25%** | `ClientsWorkspace`, `clients.json`, delivery, proposals — all real. | No client↔brand binding (brand is free text), no client approval lane, no white-label export, no deliverable↔production-job link. | High | **Nearest-term real revenue.** Clients already exist; the pipeline just can't be pointed at them. |

### The pattern

Scores are high in the middle (script 80, storyboard 75, production 90) and near zero at both ends — idea 10, trend 5, affiliate 0, TikTok Shop 0, lead-gen 20.

**Mika has built the part that is fun to build and skipped both parts that touch money.** The head of the pipeline (what should we make?) and the tail (what did it earn?) are the gap. The middle is finished.

---

# Phase 3 — Content Division Architecture

## 3.1 Governing principle: extend, do not rebuild

The Content Workforce already implements six of the thirteen requested stages, on a clean contract. `lib/creative-director/workforce/workforceContract.js` exposes exactly one factory:

```js
createStageWorker({
  id, displayName, systemPrompt, buildUserMessage, summarizeInput,
  parseOutput, validateContext, temperature, prepareContext,
})
```

Every stage is **plain data**: a prompt, a schema parser, a context builder. There is one `execute()` implementation for all of them. Adding a stage means adding a definition file and three map entries — not building an engine.

`prepareContext` is the critical extension point. It lets a stage do non-model async work *before* the model call and hand it enriched context. The Research stage uses it for live search. **Trend ingestion, idea scoring, and offer binding all fit this same hook.**

> **Architectural recommendation:** every new Content Division stage is authored as a `createStageWorker` definition. No new orchestration engine is built. This converts most of the Content Division from an engineering project into a prompt-and-schema exercise.

## 3.2 Target pipeline

Existing stages in **bold**. New stages marked `NEW`.

```
  ┌─ SUPPLY (new — the missing head) ─────────────────────┐
  │  Signal Ingest   NEW   scheduled, non-model
  │       ↓
  │  Idea Bank       NEW   scored, deduped, persistent
  │       ↓
  │  Content Plan    NEW   calendar + cadence + capacity
  └───────────────────────────────────────────────────────┘
                     ↓  (plan slot → content request)
  ┌─ CREATIVE (mostly exists) ────────────────────────────┐
  │  Creative Director   NEW   brand voice + strategy gate
  │       ↓
  │  RESEARCH        ✅ exists  (65%, never run)
  │       ↓
  │  Content Strategist  NEW   angle, offer binding, KPI
  │       ↓
  │  SCRIPT          ✅ exists  (hooks + full script)
  │       ↓
  │  STORYBOARD      ✅ exists
  │       ↓
  │  PROMPTS         ✅ exists
  │       ↓
  │  THUMBNAIL       ✅ exists   CAPTION ✅ exists
  │       ↓
  │  REVIEW          ✅ exists
  └───────────────────────────────────────────────────────┘
                     ↓
  ┌─ DELIVERY (exists — frozen) ──────────────────────────┐
  │  Production Package → Production Router → Execution
  │       → Universal Output Viewer → Publishing
  └───────────────────────────────────────────────────────┘
                     ↓
  ┌─ FEEDBACK (new — the missing tail) ───────────────────┐
  │  Attribution     NEW   link/UTM → lead/sale
  │       ↓
  │  Analytics       NEW   replaces the MOCK surface
  │       ↓  feeds back into → Idea Bank + Hook Bank
  └───────────────────────────────────────────────────────┘
```

Note the loop. Analytics is not a reporting dead end — it writes back into Idea Bank (what topics earned) and the Hook Bank (what openings held attention). **That feedback edge is what makes this an operating system rather than a pipeline.**

## 3.3 Stage contracts

Each stage emits structured JSON consumed by the next. Shapes below are contract sketches, not final schemas.

**`Signal` — NEW, non-model (`prepareContext` only)**
```json
{ "signalId": "sig_...", "source": "exa|tavily|manual", "capturedAt": "ISO",
  "topic": "string", "momentum": { "score": 0.0, "direction": "rising|flat|decaying" },
  "evidence": [{ "url": "...", "title": "...", "quality": 0.0 }],
  "brandRelevance": [{ "brandId": "cannaops", "score": 0.0 }], "expiresAt": "ISO" }
```

**`Idea` — NEW**
```json
{ "ideaId": "idea_...", "brandId": "enum", "title": "string", "angle": "string",
  "sourceSignalIds": ["sig_..."],
  "score": { "momentum": 0.0, "brandFit": 0.0, "monetizability": 0.0, "effort": 0.0, "composite": 0.0 },
  "monetization": { "type": "lead|affiliate|product|client|awareness", "offerId": "string|null" },
  "status": "new|shortlisted|scheduled|used|rejected", "dedupHash": "string" }
```

**`Plan` — NEW**
```json
{ "planId": "plan_...", "brandId": "enum", "period": { "from": "ISO", "to": "ISO" },
  "cadence": { "platform": "enum", "perWeek": 3 },
  "slots": [{ "slotId": "...", "targetPublishAt": "ISO", "platform": "enum",
              "ideaId": "idea_...|null", "requestId": "req_...|null",
              "status": "empty|assigned|in_production|published" }] }
```

**`CreativeDirection` — NEW**
```json
{ "brandId": "enum", "voice": { "tone": [], "forbidden": [], "signaturePhrases": [] },
  "visualIdentity": { "palette": [], "typography": "", "motionDoctrine": "" },
  "approvedAngles": [], "guardrails": [] }
```
*Not a per-run model call — a persisted, versioned brand record injected into every downstream stage's context. This is what makes output consistent across 100 videos.*

**`Strategy` — NEW (Content Strategist)**
```json
{ "requestId": "req_...", "angle": "string", "audienceThesis": "string",
  "monetization": { "type": "enum", "offerId": "string|null",
                    "destinationUrl": "string|null", "utm": { "source": "", "medium": "", "campaign": "" } },
  "successKpi": { "metric": "leads|clicks|views|sales", "target": 0 },
  "platformFit": [{ "platform": "enum", "rationale": "" }] }
```
*This stage is the monetization spine. It sits between Research and Script so that **every downstream stage knows what the content is supposed to earn** — the script writes toward the CTA, the caption carries the tracked link, publishing validates the destination resolves.*

**Existing stages** (`Research`, `Script`, `Storyboard`, `Prompts`, `Thumbnail`, `Caption`, `Review`) keep their current schemas, with one addition: each gains `strategy` in `STAGE_CONTEXT_DEPENDENCIES`.

**`Attribution` — NEW, non-model**
```json
{ "contentId": "...", "productionJobId": "...", "publishJobId": "...",
  "trackedLinks": [{ "url": "", "shortId": "", "platform": "enum" }],
  "observed": { "clicks": 0, "leads": 0, "sales": 0, "revenueUsd": 0.0 },
  "costUsd": 0.0, "roi": 0.0 }
```

## 3.4 Two required engine changes

Both are small and additive.

**(a) Stage graph extension.** `WORKFORCE_STAGE_IDS`, `STAGE_CONTEXT_DEPENDENCIES`, and `DOWNSTREAM_INVALIDATION` in `workforceRules.js` are literal maps. New stages are three map entries plus a definition file. No engine change.

**(b) Pipeline profiles.** Today the stage list is one fixed linear array. A TikTok Shop product video and a lead-gen explainer need different stages. Introduce a profile that selects a stage *subset*:

```js
PIPELINE_PROFILES = {
  'short-form-awareness': ['research','strategy','script','storyboard','prompts','caption','review'],
  'lead-gen':             ['research','strategy','script','storyboard','prompts','thumbnail','caption','review'],
  'client-deliverable':   ['strategy','script','storyboard','prompts','review'],
}
```

The engine already iterates `WORKFORCE_STAGE_IDS`. Making that array a function of the run's profile is a contained change to `workforceEngine.js` sequencing and leaves `createStageWorker` untouched.

## 3.5 Explicitly out of scope

Per instruction and per audit agreement: Provider Execution Engine, Production Router, provider adapters, and Publishing are **frozen**. This design terminates at the Production Package handoff and resumes at Attribution.

---

# Phase 4 — Operator Experience

## 4.1 The target flow, mapped to reality

| Step | Today | Verdict |
|---|---|---|
| New Content | Studio → tab 1/15 → Create Brief | **Bury** — needs a top-level entry |
| Choose Brand | Free-text field (200 chars) | **Broken** — must be a picker over the 8 configured brands |
| Choose Goal | Free-text field (300 chars) | **Broken** — must be an enum tied to monetization type |
| Research | Workforce stage 1 | Exists, never run |
| Review Research | Per-stage panel | Exists |
| Approve Strategy | — | **Missing stage entirely** |
| Generate Script | Workforce stage 2 | Exists |
| Approve Script | Per-stage override + approve | Exists |
| Generate Storyboard | Workforce stage 3 | Exists |
| Approve Storyboard | Per-stage approve | **Redundant** — merge |
| Generate Assets | Prompts / Thumbnail / Caption | Exists |
| Production | Production Router | Strong |
| Review Output | Universal Output Viewer | Strong |
| Publish | Publishing Router | Built, unused, manual-only |
| Track Performance | Analytics | **Mock data** |

## 4.2 Unnecessary approvals — cut from six to two

Current approval surfaces for one video: per-stage workforce approve → run-level approve → package pipeline stage gates → production job review → production job approve → publish validate/ready/publish.

**Recommendation — two mandatory gates:**

1. **Creative Gate** — one review of the *complete* creative package (script + storyboard + thumbnail + caption + strategy) before any money is spent. Per-stage editing stays available and useful; per-stage *approval* becomes optional, not blocking.
2. **Spend Gate** — the existing production job approval. This is the only place real money moves, and it must stay.

Publishing validation should be an automatic precondition check, not a human click. Package pipeline stage gates should be derived from state, not separately approved.

Rationale: a solo operator producing daily cannot clear six gates per item. Every non-money gate is friction with no governance value, because the operator is the same person on both sides of it.

## 4.3 Duplicate screens to retire

| Retire | Into | Reason |
|---|---|---|
| `ContentKanban` | `ContentPipelineBoard` | Two boards, one domain |
| Content Factory tab | Unified content object | Redundant creation path |
| Content Pack tab | Unified content object | Redundant creation path |
| Package Pipeline tab | Pipeline board | Same object, second surface |
| Video workspace | Production Router | Third video entry point |
| 8 orphan `*Studio` components | Platform Studio tab | Unreachable code |
| `packageFromRequest.js` path | Delete | **Money-burning placeholder trap** |

## 4.4 Missing steps

- **Choose monetization** — the most important missing decision. Currently no step asks how this content makes money.
- **Preview before spend** — no cheap visualization between storyboard approval and paid render.
- **Next action surface** — nothing tells the operator what is waiting on them.
- **Batch mode** — every flow is single-item. Publishing cadence requires batching.

## 4.5 Recommended navigation

Replace the 15-tab Studio with a causal, four-item content group:

```
CONTENT
  ├─ Ideas       Signal feed · Idea Bank · Plan calendar
  ├─ Create      Request intake → Workforce stages → Creative Gate     ← the front door
  ├─ Produce     Production Router · Output Viewer · Publishing
  └─ Perform     Attribution · Analytics · Hook Bank
```

Four items, in the order work actually flows. An operator who reads them top to bottom has learned the product.

---

# Phase 5 — Implementation Roadmap

Ordered by **fastest path to monetizable content**, not architectural completeness.

---

### M0 — Proof of Loop
**Objective.** Run the existing Content Workforce once, end to end, on a real brand, and publish the output.
**Business value.** Validates seven stages, the research engine, package creation, routing, and publishing — all currently unproven. Every downstream estimate in this roadmap is a guess until this runs.
**Complexity.** Trivial — no new code.
**Dependencies.** None. `OPENROUTER_API_KEY` and one research provider key.
**Risk.** Low technically. **High informationally** — expect to find real bugs in code that has never executed. That is the entire point.
**Success criteria.** One `data/content-workforce-runs/` record, one non-test content package, one production job, one publish job. A real post, on a real account.

> Do this before anything else in this document. Do it this week.

---

### M1 — One Front Door
**Objective.** Collapse the 15-tab Studio into the four-item Content group (4.5). Retire the duplicate screens in 4.3. Delete `packageFromRequest.js`. Delete the 8 orphan components.
**Business value.** Removes the single largest barrier to using the product. Eliminates a live money-burning trap.
**Complexity.** Medium — routing and component surgery, no new domain logic.
**Dependencies.** M0 (know which paths matter before deleting).
**Risk.** Medium — touches `pages/index.js` `sectionMap` and the workspace registry, which has a runtime validator (`validateRouteRegistry`) that will catch desync. Existing legacy alias map makes deprecation safe.
**Success criteria.** Zero routes to a placeholder-package creation path. New-operator time-to-first-request under 60 seconds. Every sidebar item renders something real.

---

### M2 — Controlled Vocabulary
**Objective.** Convert `brand`, `platform`, and `goal` from free text to enums bound to `config.projects` and a defined goal taxonomy. Backfill the 8 existing packages.
**Business value.** Prerequisite for every form of grouping, attribution, and reporting. Without it, analytics can never aggregate.
**Complexity.** Low.
**Dependencies.** M1.
**Risk.** Low — 8 existing records to migrate, all smoke tests.
**Success criteria.** No free-text brand entry anywhere. Every content object joins cleanly to a configured brand.

---

### M3 — Monetization Spine
**Objective.** Add the `Strategy` stage (3.3) between Research and Script. Bind each content item to an offer, a destination URL, and a tracked link with UTM. Add the `Attribution` record.
**Business value.** **This is the milestone that converts media into revenue.** It closes the gap behind categories 10 (lead gen, 20%), 11 (affiliate, 0%), and 13 (digital products, 5%) simultaneously — all three fail today for the same reason: content carries no destination.
**Complexity.** Medium — one new stage definition, one new store, link-shortening or UTM convention.
**Dependencies.** M2 (needs stable brand/goal enums).
**Risk.** Medium — requires deciding the offer model. Keep v1 deliberately dumb: a URL and UTM parameters, no redirect service.
**Success criteria.** Every new content item has a tracked destination. One attributable click recorded. Affiliate revenue becomes *possible* for the first time.

---

### M4 — Idea Bank + Plan
**Objective.** Implement `Idea` and `Plan` objects (3.3). Ideas scored and promotable to requests; plan slots schedulable per brand and cadence.
**Business value.** Lifts the throughput ceiling. Today output is capped by how many topics a human types. This is the difference between sporadic content and a schedule.
**Complexity.** Medium-high — two new domain objects plus a calendar UI.
**Dependencies.** M2.
**Risk.** Medium — scoring rubric will need iteration; ship with a naive composite and tune from M7 data.
**Success criteria.** 20+ scored ideas in the bank. A two-week plan populated for one brand. First content item created from a plan slot rather than an ad-hoc request.

---

### M5 — Publish Automation (1–2 platforms)
**Objective.** Replace `manual-export` with real API posting for the two highest-volume platforms.
**Business value.** Removes the last manual step in the loop. Enables cadence without daily operator labor.
**Complexity.** High — OAuth, platform review processes, per-platform quirks.
**Dependencies.** M0 (must have published manually first), M3 (links must be correct before automating).
**Risk.** **High and mostly external** — platform API approval timelines are outside your control. Start applications early; they can run in parallel with M3/M4.
**Success criteria.** One post published with no human upload step.

---

### M6 — Signal / Trend Ingest
**Objective.** Scheduled trend ingestion via the existing `prepareContext` hook, feeding `Signal` records into the Idea Bank.
**Business value.** Improves idea *quality* and timeliness. Deliberately sequenced after the Idea Bank exists — trends with nowhere to land are noise.
**Complexity.** Medium — reuses the research adapter layer; adds scheduling.
**Dependencies.** M4.
**Risk.** Medium — real per-run cost. The existing budget gate applies; keep it strict.
**Success criteria.** Daily signal ingest running. 50%+ of shortlisted ideas signal-originated.

---

### M7 — Analytics Loop
**Objective.** Replace the mock `AnalyticsRoom` with real per-content metrics joined to attribution and cost. Write results back to the Idea Bank and a new Hook Bank.
**Business value.** Closes the feedback loop. Converts every published item into training signal for the next one. This is what compounds.
**Complexity.** High — platform metrics APIs plus join logic.
**Dependencies.** M3, M5, and 30+ published items (statistics need volume).
**Risk.** Medium — attribution is genuinely hard on social platforms. Accept directional accuracy; do not over-engineer.
**Success criteria.** Real ROI per content item. Hook performance ranked. One idea generated *from* an analytics finding.

---

### M8 — Client Mode
**Objective.** Bind content requests to clients, add a client approval lane and white-label export, link deliverables to production jobs.
**Business value.** Category 14 is the **nearest-term real revenue** — clients already exist in the system. Sequenced here only because it benefits enormously from M1–M3 being done first. If cash is needed sooner, this can move ahead of M4.
**Complexity.** Medium.
**Dependencies.** M2, M3.
**Risk.** Low.
**Success criteria.** One client deliverable produced end to end and invoiced.

---

## Sequencing rationale

```
M0  Proof of Loop      ← this week, zero new code
M1  One Front Door     ← makes the product usable
M2  Vocabulary         ← cheap, unblocks everything downstream
M3  Monetization Spine ← THE revenue milestone
M4  Idea Bank + Plan   ← throughput
M5  Publish Automation ← (start platform applications during M3)
M6  Signal / Trend     ← quality
M7  Analytics Loop     ← compounding
M8  Client Mode        ← promote earlier if cash is needed
```

M3 is deliberately early. It is tempting to build the Idea Bank first — it is the more interesting problem, and it is the more visible gap. But an idea bank feeding content that carries no destination produces more unmonetized media, which is precisely the state Mika is in today. **Attach the money first, then scale the volume.**

---

## Closing assessment

The instruction was to focus on everything before the Production Router, and the audit supports that instruction completely.

What the audit adds is a sharper diagnosis than "the Content Division needs building." Most of the Content Division is already built to a high standard and has simply never been switched on. Seven stages, a research engine with two live adapters, schema validation, invalidation logic, budget gating — sitting at zero executions.

So the risk facing the next phase is not that Mika lacks capability. It is that Mika will build a *second* unused creative pipeline on top of the first one, because building is more satisfying than operating.

The roadmap above resists that. M0 costs nothing and proves the loop. M1 makes the loop findable. M2 makes it consistent. M3 makes it pay. Only then does M4 make it bigger.

**Build less. Run what exists. Attach it to money.**
