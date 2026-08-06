# P0.5 — Preserve Render Intent

**2026-08-05 · Validated on the real Digital Diamond AI package `pack-1785960819732-4ed2d0`**

> **Result: stage-output information loss went from 61.8% → 0.0%. URS completeness 85 → 97.**

---

## 1. Read-only audit

Method: enumerate every leaf value produced by each workforce stage (reading *effective* output, so human overrides count), then test each value's presence in the Content Package. 144 values checked.

### Preserved verbatim

| Stage field | Package destination |
|---|---|
| `storyboard.scenes[].visual` | `scenes[].visual` |
| `storyboard.scenes[].narration` | `scenes[].voiceover` |
| `storyboard.scenes[].onScreenText` | `scenes[].onScreenText` |
| `script.hooks[]`, `script.fullText`, `script.cta` | `hooks[]`, `script.*`, `cta` |
| `caption.primaryCaption` | `caption` |
| `caption.cta`, `hashtags[]`, `keywords[]` | `cta`, `hashtags[]`, `keywords[]` |
| `thumbnail.headline` | `thumbnail.headline` |

### Transformed

| Stage field | Becomes | Note |
|---|---|---|
| `storyboard.scenes[].index` (0-based) | `scenes[].order` (1-based) | `mapScenes()` — reversible |
| `storyboard.scenes[].startSeconds`/`endSeconds` | `scenes[].durationSeconds` | **Absolute offsets discarded**, duration retained |
| `thumbnail.imagePrompt` | `thumbnail.visualBrief` | **Slot collision — see the bug below** |

### Summarized (into the Production Job, never the package)

`buildScenesSummary()` → `hasVisual: true|false`. `buildVoiceoverScriptSummary()` → `wordCount`, `available`. These are readiness telemetry; the underlying content is not carried.

### Discarded — 89 of 144 values (61.8%)

| Stage | Discarded |
|---|---|
| **Storyboard** | `scenes[].camera`, `scenes[].motion`, `scenes[].transition`, `scenes[].assetType`, `scenes[].providerHint`, `pacing`, `visualStyle`, `continuityNotes[]`, `totalDurationSeconds` |
| **Prompt Generation** | **The entire stage.** `productionMode`, presenter direction, `compositionBrief`, `animationDirections[]`, `typography`, `transitions[]`, `aspectRatio`, all 7 per-scene `prompt` + `negativePrompt` pairs, thumbnail `imagePrompt`/`composition`/`exclusions[]` |
| **Thumbnail** | `visualBrief`, `alternateHeadlines[]`, `subject`, `background`, `composition`, `emotion`, `contrastStrategy`, `brandElements[]`, `negativePrompt`, `platformSafeAreaNotes[]`, `score` |
| **Caption** | `alternateCaptions[]`, `firstComment`, `platformVariants{}` (6 platforms), `complianceNotes[]` |
| **Review** | `verdict`, `overallScore`, `categoryScores{}`, `warnings[]` |

**Evidence for the Prompt stage:** `grep -c prompts lib/creative-director/workforce/packageFromWorkforceRun.js` → `0`. The stage is never read.

---

## 2. Loss analysis

| Field group | Originated | Lost at | Intentional? | Downstream benefit |
|---|---|---|---|---|
| Per-scene `camera`/`motion`/`transition` | Storyboard | `mapScenes()` — the map literally lists 5 output keys | **Accidental** | Camera moves, animation directives, and clip seams — the core of any motion renderer |
| `assetType` | Storyboard | `mapScenes()` | **Accidental** | Per-scene routing (generated video vs. graphic vs. stock) |
| `providerHint` | Storyboard | `mapScenes()` | Defensibly **intentional** — advisory, and the Router owns provider choice | Low. Preserved for provenance only |
| `pacing`, `visualStyle`, `continuityNotes[]` | Storyboard | Never read | **Accidental** | Cross-scene visual consistency — the difference between 7 clips and one film |
| Entire Prompt Generation stage | Prompts | Never read | **Accidental** | **The actual generation inputs.** Every image/video model consumes exactly `prompt` + `negativePrompt` |
| `typography`, `transitions[]`, `compositionBrief` | Prompts | Never read | **Accidental** | Composition styling and transition vocabulary |
| Thumbnail art direction (10 fields) | Thumbnail | `buildContentPackage()` accepts only `headline` + `visualBrief` | **Accidental** | Generating the thumbnail rather than describing it |
| `thumbnail.visualBrief` | Thumbnail | **Overwritten** at `packageFromWorkforceRun.js:73` | **Accidental — a bug** | See below |
| Caption `alternates`/`firstComment`/`platformVariants` | Caption | Not mapped | Partly **intentional** (a package targets one platform) | Multi-platform publishing, auto-posting the first comment, A/B testing |
| Review scores/warnings | Review | Not mapped | **Intentional** (governance, not content) | `productionReadiness` + `warnings` describe render risk |

### Root cause

`contentPackageSchema.js` was designed for a **single-shot synthesis call** — its own header says "raw model synthesis output". The seven-stage Content Workforce was mapped onto that older, narrower shape later. The package has slots for *written* content and no slots for *directorial* content. The loss is structural, not a decision anyone made.

### The `visualBrief` bug

```js
// packageFromWorkforceRun.js:73
visualBrief: thumbnail?.imagePrompt || thumbnail?.visualBrief || '',
```

`imagePrompt` wins whenever it exists, so the package's `visualBrief` slot holds the **generation prompt**, and the stage's genuine human-readable `visualBrief` is destroyed. Two distinct artifacts, one slot.

Verified on the real run:
- stage `visualBrief`: *"A modern office setup showcasing automation tools and software."*
- stage `imagePrompt`: *"A modern office desk with a sleek laptop showing automation software, surrounded by…"*
- package `thumbnail.visualBrief`: **the imagePrompt**

Line 73 was left untouched (changing it would alter existing package output). Both values are now preserved separately.

---

## 3. Implementation

Two changes. One new file, one three-line attach.

| File | Change |
|---|---|
| `lib/content/renderIntentSchema.js` | **NEW.** `buildRenderIntent()` + `validateRenderIntent()`. Pure, no I/O. Its own sanitizer, so **no existing validator was modified** |
| `lib/creative-director/workforce/packageFromWorkforceRun.js` | One import + attach `renderIntent` to the package |
| `lib/production/renderSpec/*` | Reads `pkg.renderIntent` to populate previously-null URS fields (null-safe) |

**Design rules obeyed:**
- **Preserve, never reinterpret.** Values copied verbatim, length-clamped for safety only. Nothing renamed — renaming is interpretation, so it happens in the *consumer* (`buildRenderSpec` maps to neutral URS names), not at the storage layer. The storyboard's `assetType: "video"` passes through as-is rather than being coerced into `generated_video`.
- **No invented defaults, no inference.** Absent field → `null`. Absent array → `[]`. Nothing derived.
- **Single source of truth.** Fields the package already carries (hooks, script, scene visuals, caption, hashtags, thumbnail headline) are **not** duplicated, so an operator edit cannot create two disagreeing copies.
- **Backward compatible.** `renderIntent` is a new *optional* top-level key. `validateRenderIntent(null)` returns valid.

**Untouched, as required:** Provider Execution Engine, provider adapters, Production Plans, budget logic, existing APIs, existing validators. `git status` shows exactly two modified files across all milestones — one from M0, one from P0.5.

---

## 4. Validation — same package, before vs after

```
=== URS VALIDITY ===
before: ok=true errors=[]
after : ok=true errors=[]

=== COMPLETENESS ===
BEFORE score: 85   missing: [scene motion/camera direction,
                             visualIdentity.typography or visualStyle,
                             audio.music intent,
                             visual negative prompts]
AFTER  score: 97   missing: [audio.music intent]

=== STAGE-OUTPUT LOSS AUDIT ===
values checked: 144
lost BEFORE: 89  (61.8%)
lost AFTER :  0  (0.0%)

=== BACKWARD COMPATIBILITY ===
legacy package (no renderIntent) -> ok: true | score: 85 | renderIntentSource.present: false
```

### Newly preserved

| URS field | Before | After |
|---|---|---|
| `scenes[].camera` | `null` | *"Close-up on the desk, then zoom out…"* |
| `scenes[].motion` | `null` | *"Slow pan across the desk."* |
| `scenes[].transitionOut` | `null` | *"Cut"* |
| `scenes[].visual.assetKind` | `"unspecified"` | `"video"` |
| `scenes[].visual.generationPrompt` | `null` | *"A cluttered desk with various automation tools…"* |
| `scenes[].visual.negativePrompt` | `null` | *"No people, no mess, clean desk."* |
| `intent.pacing` | `null` | `"medium"` |
| `visualIdentity.typography` | `null` | *"Modern sans-serif, bold headings…"* |
| `visualIdentity.visualStyle` | `null` | *"Professional and modern with clear graphics."* |
| `visualIdentity.transitionVocabulary` | `null` | 4 entries |
| `visualIdentity.motionDirections` | `null` | 7 entries |
| `visualIdentity.continuityNotes` | `null` | 2 entries |
| `visualIdentity.thumbnail.direction` | `null` | full art direction |
| `captions.post.firstComment` | `null` | *"Want to streamline your business?…"* |
| `captions.post.alternates` | `null` | 3 |
| `captions.post.platformVariants` | `null` | 6 platforms |

`renderIntent` block: **7,962 bytes**, structurally valid.

---

## 5. Remaining information loss

**Zero.** All 144 stage-output values are now present on the package.

The one outstanding completeness item is **`audio.music.moodHint` (3 points)** — and it is *not* a loss. **No workforce stage produces music intent at all.** There is nothing upstream to preserve. Per the rules, it stays `null` rather than being inferred.

97/100 is therefore the maximum reachable score using only information that already exists. Closing the last 3 points requires a new upstream producer, which is out of scope here.

### Distinguishing "never produced" from "produced but lost"

URS now carries `renderIntentSource`:

```json
{ "present": true, "schemaVersion": 1, "runId": "wfr-1785960180268-73b748" }
```

A consumer seeing `camera: null` can tell whether the directorial layer was absent (`present: false` — a pre-P0.5 or non-workforce package) or genuinely not produced (`present: true`). That distinction did not exist before and is what made this audit possible to state precisely.

---

## Status

Render intent is preserved. Stopping here per scope — no URS translation, no provider implementation, no rendering.
