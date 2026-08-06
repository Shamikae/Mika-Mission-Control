# M0 — Proof of Content Loop

**Validation report · 2026-08-05**

First genuine content cycle ever executed in Mika Mission Control.

---

## Verdict

The existing architecture **can** originate a real content idea, process it through the Content Workforce, and prepare it for production. It did — on a real Digital Diamond AI brief, with live research, at a total model cost of **$0.0355**.

It **cannot yet produce a video**. The loop terminates honestly at the publishing validator, which correctly refused to mark a JSON brief as a TikTok-ready asset.

Three blockers had to be cleared to get this far. Two were configuration. One was a genuine architectural deadlock that made the workforce **impossible to complete by any available operator action** — which is the real reason the run count was zero.

---

## 1. Workflow executed

| Stage | Artifact | Result |
|---|---|---|
| Content Request | `creq-1785960141612-deb2aa` | ✅ created, submitted |
| Research (live Exa) | `rsr-1785960180274-7d6a7f` + 1 rerun | ✅ real sources, real citations |
| Script | — | ✅ hooks + full script |
| Storyboard | — | ✅ 7 scenes, 45s |
| Prompt Generation | — | ✅ per-provider prompts |
| Thumbnail | — | ✅ concept + visual brief |
| Caption | — | ✅ primary + 3 alternates + variants |
| Creative Review | — | ✅ approved 8/10 (after fix) |
| Human approval | — | ✅ |
| Content Package | `pack-1785960819732-4ed2d0` | ✅ placeholder-clean |
| Pipeline → approved | — | ⚠️ required a **second** review track |
| Production Plan | `pr-1785960912597-d9e6b8` | ✅ `faceless_social` / readiness 78 |
| Budget / Approval | — | ✅ correctly waived (cost tier `free`) |
| Execution | — | ✅ completed, 1 attempt |
| Artifact | 2 files, 9.7 KB | ✅ `production-artifacts/DigitalDiamondAI/` |
| Output Review | — | ✅ approved |
| Publish Job | `pub-1785961269759-df2ce1` | ✅ created |
| Publish Validation | — | 🛑 **blocked, correctly** |

**Brand used:** Digital Diamond AI (`@digitaldiamondai`) — chosen because it is a configured project in `config/openclaw.config.js` with an existing ProjectRoom and brand section, so it exercises the real workflow rather than an ad-hoc string.

**Brief:** *"The 3 workflows every service business should automate first"* — TikTok, faceless, lead-gen, CTA "Comment AUDIT".

**Store counts, before → after:**

| Store | Before | After |
|---|---:|---:|
| content-requests | 0 | **1** |
| content-workforce-runs | 0 | **1** |
| research-runs | 0 | **2** |
| publish-jobs | 0 | **1** |
| content-packages | 8 (all smoke tests) | 9 |
| production-jobs | 10 | 11 |

---

## 2. Stages successfully completed

All seven workforce stages executed against real models (`openai/gpt-4o-mini`) with schema validation passing. **19 stage executions** total across reruns, **64 activity events** recorded, zero unhandled errors.

Notable successes:

- **Research ran live.** Exa returned real sources; claims carried real URLs (`klymo.net`, `runbyai.co`). The 46 KB research run is genuine evidence, not synthesis.
- **The placeholder-safety scan came back clean.** No `TODO`, `[Placeholder`, `[Reserved`, `TBD`, or empty required fields in either the run or the final package.
- **Scene mapping is correct.** `packageFromWorkforceRun.mapScenes()` properly translates the storyboard's `index`/`startSeconds`/`endSeconds`/`narration` into the package's `order`/`durationSeconds`/`voiceover`. Result: scenes 1–7, durations 6/6/8/6/8/8/3 = 45s, matching the requested "35-45 seconds".
- **Downstream invalidation works exactly as specified.** A script edit invalidated 5 stages; a research edit invalidated all 6. No silent staleness.
- **The Production Router reasoned correctly.** It detected `faceless_social` from the copy ("no avatar signal"), matching the request's `avatarPreference: faceless`, and produced a correct TikTok `outputSpec` (9:16, 1080×1920, 30fps, caption burn-in).
- **Cost governance behaved correctly.** `manual-export` is cost tier `free`, so the job moved straight to `ready` and the spend-approval gate was correctly *not* applied. Approval is reserved for real spend.
- **The publishing validator did its job.** It refused `application/json` for TikTok with a blocking warning naming the supported types. This is the system protecting you, not failing.

---

## 3. Stages requiring manual intervention

| Intervention | Why | Avoidable? |
|---|---|---|
| Cleared `.next` cache | Every API returned 500 | Yes — tooling |
| Flipped 2 env flags | Workforce and Research were switched off | Yes — should be default-on locally |
| Curated research claims | **Deadlock** — see Bug 3 | Only after the fix |
| Moved package `research → review → approved` | Package lands non-production-eligible despite full workforce approval | Yes — should inherit |
| Switched provider to `manual-export` | HyperFrames has no composition for this package | **No — real gap** |
| Approved output review | By design | No — correct gate |

---

## 4. Bugs discovered

### 🛑 BUG-1 — Corrupted `.next` cache broke every API *(fixed)*
Every endpoint returned HTTP 500: `Cannot find module './chunks/vendor-chunks/next.js'`. The app was wholly non-functional. Cleared `.next` and restarted; all routes returned 200.

**Impact:** Nothing could run. This alone may account for a large share of the project's zero-usage history.

---

### 🛑 BUG-2 — The Content Workforce was switched off *(fixed)*
```
CONTENT_WORKFORCE_ENABLED=false
CONTENT_RESEARCH_ENABLED=false
```
`getWorkforceConfig()` returns `{configured:false}` unless the flag is the literal string `true`. **This is the direct answer to "why has the workforce never run."** It was never broken. It was never enabled.

---

### 🛑 BUG-3 — Unbreakable Creative Review deadlock *(fixed, minimally)*

**The most important finding of M0.** The workforce could not reach approval by any operator action.

The chain:
1. Research emits claims it honestly self-flags `sourceNeeded: true, sourceIds: []`.
2. Creative Review scores `factualSafety` from those claims and returns `verdict: revisions_required`, `approvedForPackageCreation: false`.
3. `approveRun()` **hard-requires** `approvedForPackageCreation === true` — [workforceEngine.js:232](lib/creative-director/workforce/workforceEngine.js#L232).
4. Review is **not** in `OVERRIDE_FIELDS`, so its verdict cannot be edited.
5. Editing the *script* does not help — the claim lives in Research, which a script edit does not invalidate.
6. Re-running Research is **not** a remedy: it re-derives equally unsourced claims. Verified empirically — run 1 produced 1 unsourced claim, run 2 produced **2**.

There was no exit. Not a slow path — no path.

**Minimal fix applied** ([workforceRules.js](lib/creative-director/workforce/workforceRules.js)): added `research: ['claims']` to the existing `OVERRIDE_FIELDS` whitelist, with sanitization and an effective-output merge branch. This reuses the exact mechanism already serving script, storyboard, thumbnail, and caption. No new systems, no new engine, no redesign.

**Result:** curating 3 claims down to the 1 with a real source moved factualSafety **4 → 10** and the verdict to `approved` (8/10).

---

### ⚠️ BUG-4 — Review feedback cannot reach a rerun
`rerun-stage` accepts a `note`, but [`rerunStage()`](lib/creative-director/workforce/workforceEngine.js#L215) writes it **only to `activityHistory`**. It never enters the prompt.

Review produces a structured `revisionInstructions` array. **Nothing consumes it.** An operator following the UI's own advice — "address blocking issues and rerun Review" — reruns a stage that has no idea what was wrong and receives a statistically identical result. This is what turns BUG-3 from friction into a loop.

---

### ⚠️ BUG-5 — Stale overrides silently clobber regenerated output
`run.overrides` is never cleared on rerun. After re-running Research, my earlier script edit still merged over the *newly generated* script via `getEffectiveStageOutput()` — silently discarding the fresh generation. An operator would have no indication their old edit was overwriting new work.

---

### ⚠️ BUG-6 — Workforce approval does not carry to the package
`packageFromWorkforceRun` creates the package at `status: draft`, `pipeline.stage: research` — despite the run having passed AI review *and* explicit human approval. The operator must then walk the package through `research → review → approved` in a **second, unrelated review track** before production will accept it. Two governance systems, no shared state.

---

### ℹ️ BUG-7 — Router selects a lower-scoring provider
`providerCandidates` ranked `manual-export` **61** and `hyperframes` **55**, but `recommendedProvider` was `hyperframes`. The selection does not follow the published score. Either the score is not the ranking key or the ranking is wrong — in both cases the displayed score misleads.

---

## 5. Architecture weaknesses

**① The Content Package → video asset gap is the one thing standing between Mika and a finished video.**

The router correctly recommends HyperFrames for faceless social. But the HyperFrames adapter requires a `compositionId` pointing at a pre-authored composition under `tools/hyperframes/`. Only two exist — `hello-hyperframes` and `mika-hyperframes-test`, both smoke tests. `HYPERFRAMES_ENABLED` is unset.

**Nothing in the architecture converts an approved Content Package into a renderable composition.** The workforce produces a script, a 7-scene plan with timings, on-screen text, and captions — everything a composition needs — and then hands it to a provider that cannot consume it. This is the single missing link in the chain.

**② Two governance systems that don't talk.** Workforce approval (AI review + human approve) and pipeline approval (`research → review → approved`) are independent. The same creative is approved twice by the same person.

**③ The review gate has no feedback channel.** A blocking reviewer with no way to tell the writer what to change is a stop sign, not a review.

**④ Honest self-flagging is punished.** Research correctly reporting "I could not source this" is precisely what deadlocks the pipeline. Good epistemics should not be a failure mode.

---

## 6. UX friction

- **Zero discoverability.** Every step of this run was executed via `curl`. The workforce UI lives at Studio → tab 15 of 15 ("Creative Director") → nested panel.
- **Silent config gates.** A disabled workforce surfaces as absence, not as "switched off — enable here."
- **Response/persistence key drift.** Publish jobs return `state`/`validation` in API responses but persist `status`/`lastValidation`. Stage output sits at `stages[x].result.output`, not `stages[x].output`. Every consumer must know both shapes.
- **Approval count.** This one video passed **six** approval/gate surfaces. For a solo operator that is the difference between shipping daily and never.

---

## 7. Missing business capabilities

Confirmed empirically, not inferred:

| Capability | Status |
|---|---|
| Video asset generation from a package | **Missing — the blocker** |
| Idea origination | Missing — `topic` is a required human input |
| Trend/timeliness signal | Missing |
| Monetization binding | Missing — the CTA says "Comment AUDIT" with **no tracked destination, no UTM, no lead record** |
| Attribution | Missing — nothing connects this content to a lead or dollar |
| Analytics | Mock data only |

The content produced is genuinely good and **cannot currently earn anything**, because nothing downstream captures the response to its own CTA.

---

## 8. Recommended engineering priorities

Ranked by business impact.

### P0 — Close the Package → Composition gap
**Impact: unblocks all video output.** Add one stage that renders an approved Content Package into a HyperFrames composition (the package already carries scenes, timings, on-screen text, and captions). Set `HYPERFRAMES_ENABLED=true`. Without this, Mika cannot produce a video, and every other improvement is decoration.

### P1 — Wire review feedback into reruns *(BUG-4)*
Pass `revisionInstructions` into the rerun prompt. Cheap, and it converts the review gate from a wall into a loop. Prerequisite for any unattended operation.

### P2 — Make workforce approval carry to the package *(BUG-6)*
A run that passed AI review and human approval should emit a package at `approved`. Deletes an entire redundant review track and two clicks per item.

### P3 — Attach monetization before scaling volume
This video's CTA points nowhere. Bind a destination URL + UTM at request time and record the lead. Until this exists, more content produces more unmonetized media — the exact state the strategy audit identified.

### P4 — Clear stale overrides on rerun *(BUG-5)*
Silent data loss. Small fix, real correctness bug.

### P5 — Default the local dev environment to enabled *(BUG-2)*
Flags off by default cost this project its entire usage history.

### P6 — Fix router score/selection disagreement *(BUG-7)*
Low impact, high confidence cost — a visible number that doesn't explain the decision erodes trust in the router.

---

## Changes made during M0

Deliberately minimal, per milestone rules.

| File | Change |
|---|---|
| `.env.local` | `CONTENT_WORKFORCE_ENABLED` false→true; `CONTENT_RESEARCH_ENABLED` false→true (backup: `.env.local.m0-backup`) |
| `lib/creative-director/workforce/workforceRules.js` | Added `research: ['claims']` to `OVERRIDE_FIELDS` + sanitizer branch + merge branch (~30 lines, one file) |
| `.next/` | Deleted and rebuilt |

No architecture redesigned. No new systems. No providers added. No refactors.
