# Universal Render Specification (URS)

**Mika's provider-neutral rendering language · v1 · 2026-08-05**

```
Content Package ──buildRenderSpec()──▶ URS ──provider adapter──▶ provider payload
   (what it MEANS)                  (what to RENDER)        (how THIS provider is called)
```

---

## Why this exists

The audit found the pipeline stops between Provider Selection and rendering, and it found *why*:

**1. The production job's plan is a readiness summary, not render content.**
`buildScenesSummary()` emits `hasVisual: true|false` — it deliberately discards the actual visual text. `buildVoiceoverScriptSummary()` returns `wordCount` and `available`, not the script. These answer *"is this package ready?"*, not *"what should be rendered?"*

**2. So adapters reach past it into the raw package — and then require a human.**
`manualExport` reads `pkg.script.fullText` directly. OpenArt requires `providerInput.prompt`, hand-typed in the UI. HyperFrames requires `providerInput.compositionId`, hand-picked from compositions authored by hand. Every provider currently needs an operator to translate creative intent into provider input, because no machine-readable render intent exists.

URS is that missing representation.

---

## The invariant

> **URS is provider-independent. It never learns which provider was selected.**

No provider name, no provider parameter, no MCP concept, no CLI concept, no model id, no API shape, no credential. If a field only makes sense for one provider it belongs in that provider's adapter — the only place allowed to know a provider exists.

**Enforced and verified.** An automated scan of both source files for `heygen|hyperframes|openart|higgsfield|runway|kling|mcp` found **zero** occurrences in executable code (provider names appear only in explanatory header comments). A scan of the generated URS for the same tokens returned only `clients` and `clinics` — words from the brief's own audience copy.

---

## Files added

Both pure — no I/O, no fs, no network — matching the convention of `productionRules.js`, `publishingRules.js`, and `contentPipelineRules.js`, so they are safe on both server and client.

| File | Role |
|---|---|
| `lib/production/renderSpec/renderSpecSchema.js` | Constants, parsers (`parseResolution`, `parseDurationHint`, `orientationFor`), `validateRenderSpec()`, `scoreCompleteness()` |
| `lib/production/renderSpec/buildRenderSpec.js` | The one transform: Content Package → URS |

**Nothing else was touched.** `buildRenderSpec` reads a package and returns a new object — it never mutates, never persists, and is not yet called by any existing code path. Content Packages, Production Plans, the Execution Engine, the Provider Registry, existing adapters, validators and APIs all continue working untouched.

Reuse over invention: the Router's existing `buildOutputSpec()` / `PLATFORM_OUTPUT_SPECS` supply platform geometry, and its existing `PRODUCTION_MODES` vocabulary supplies `intent.mode`. No parallel taxonomy was created.

---

## The contract

| Section | Answers | Notable fields |
|---|---|---|
| `source` | Where did this come from? | `packageId`, `packageUpdatedAt` (stale-spec detection) |
| `intent` | Why does this video exist? | `mode`, `goal`, `topic`, `audience`, `tone`, `hook`, `alternateHooks[]` |
| `output` | What file must come out? | `aspectRatio`, `resolution{width,height,label}`, `orientation`, `frameRate`, `fileFormat`, `captionBurnIn`, `safeAreaNotes`, `targetDuration{min,max,label}` |
| `narrative` | The words | `script{opening,body,cta,fullText}`, `cta`, `wordCount`, `estimatedNarrationSeconds` |
| `scenes[]` | The shot list, on an absolute timeline | `index`, `order`, `startSeconds`, `endSeconds`, `durationSeconds`, `visual{description,negativePrompt,assetKind}`, `narration`, `onScreenText`, `camera`, `motion`, `transitionOut` |
| `timing` | How long, and how do we know? | `totalDurationSeconds`, `source`, `fullyTimed`, `withinRequestedRange` |
| `audio` | Voice and music intent | `narration{required,source,text,voiceHint}`, `music{required,moodHint}` |
| `captions` | On-screen text vs. post copy — kept apart | `segments[{sceneIndex,text,startSeconds,endSeconds}]`, `post{caption,hashtags,keywords,firstComment}` |
| `visualIdentity` | Brand look | `typography`, `palette[]`, `styleKeywords[]`, `thumbnail{...}` |
| `assets[]` | Concrete files already available | `role`, `kind`, `assetId`, `url` |
| `completeness` | How much intent survived? | `score`, `missing[]`, `warnings[]` |

**Three design decisions worth naming:**

- **Absolute timeline computed once.** Packages carry per-scene `durationSeconds` but no offsets. Every timeline renderer needs `startSeconds`/`endSeconds`, so they're accumulated here rather than re-derived in each adapter. If a scene lacks a duration the clock stops and offsets report `null` rather than guessing.
- **`timing.source` is explicit.** Honest precedence — authored scene durations beat a narration estimate, which beats the operator's free-text request. A renderer that must hit an exact runtime needs to know whether the number is authored or inferred.
- **Null means "not specified", never a fabricated default.** Gaps are reported through `completeness`, not papered over.

---

## Validation against a real package

Run against `pack-1785960819732-4ed2d0` — the genuine Digital Diamond AI package produced by the M0 proof-of-loop.

```
=== BUILD ===
ok: true | valid: true
errors: []      warnings: []
completeness: {"score":85,"missing":[...],"warnings":[]}

=== INFORMATION-LOSS AUDIT ===
package semantic values checked: 73
RESULT: no loss — every package string value is present in the URS.

=== PROVIDER-NEUTRALITY AUDIT ===
buildRenderSpec.js executable code: clean
renderSpecSchema.js executable code: clean
```

Correctly derived, not copied:

```json
"output": { "aspectRatio": "9:16", "resolution": { "width": 1080, "height": 1920 },
            "orientation": "portrait", "frameRate": 30, "captionBurnIn": true,
            "targetDuration": { "minSeconds": 35, "maxSeconds": 45, "label": "35-45 seconds" } }

"timing": { "totalDurationSeconds": 45, "source": "scene_durations",
            "sceneCount": 7, "fullyTimed": true, "withinRequestedRange": true }

"scenes[6]": { "index": 6, "order": 7, "startSeconds": 42, "endSeconds": 45, "durationSeconds": 3,
               "visual": { "description": "A call-to-action graphic encouraging comments." },
               "narration": "Comment AUDIT and I will send you the free automation teardown.",
               "onScreenText": "Comment AUDIT for a free teardown!" }
```

Note `withinRequestedRange: true` — the 7 scenes total exactly 45s against a requested 35–45s. That check did not exist anywhere before.

### What the 15-point completeness gap proves

`missing: ["scene motion/camera direction", "visualIdentity.typography or styleKeywords", "audio.music intent", "visual negative prompts"]`

**Every one of these is produced by the Content Workforce and thrown away before the package exists.** `createPackageFromWorkforceRun()` never reads the Prompt Generation stage (`grep -c prompts` → `0`), and `mapScenes()` keeps only order/duration/visual/narration/onScreenText from the storyboard.

Discarded on the real run: per-scene image prompts **and negative prompts**, seven motion directions, four transition types, and a typography spec.

URS models these fields because a rendering language needs them, leaves them `null` when building from a package alone, and reports them honestly rather than inventing values. **The score is not a defect in URS — it is URS measuring a real upstream leak that was previously invisible.** Wiring a richer source into these same fields is a later additive change; the contract does not move when it lands.

---

## The translation layer (conceptual — deliberately not implemented)

Adapters become translators. Same object in, entirely different payloads out. Neither is built in this milestone.

### URS → HyperFrames

```
URS ──▶ HyperFrames adapter ──▶ composition ──▶ render
```

A **timeline-native, deterministic** renderer. The adapter is mostly a direct projection:

| URS | becomes |
|---|---|
| `output.resolution` + `frameRate` | composition canvas + fps |
| `scenes[].startSeconds` / `endSeconds` | `data-*` timing attributes on `.clip` elements |
| `scenes[].onScreenText` | typographic layers |
| `scenes[].motion` / `transitionOut` | animation directives and seams |
| `visualIdentity.typography` / `palette` | composition styling |
| `captions.segments[]` | burned-in caption track |
| `audio.narration.text` | TTS input or voiceover track |

This is the highest-fidelity consumer: it uses nearly every URS field, and it is exactly where the four `missing` fields would pay off most — which is why the completeness score is a useful signal rather than a vanity metric.

### URS → OpenArt Video

```
URS ──▶ OpenArt adapter ──▶ API payload ──▶ render
```

A **prompt-driven, generative** renderer with no timeline concept. The adapter must *flatten*:

| URS | becomes |
|---|---|
| `scenes[].visual.description` (+ `intent.tone`, `visualIdentity.styleKeywords`) | a composed text prompt per clip |
| `scenes[].visual.negativePrompt` | negative prompt |
| `output.aspectRatio`, `resolution` | generation parameters |
| `scenes[].durationSeconds` | per-clip duration, clamped to model limits |
| `narrative`, `captions`, `audio` | **dropped** — this provider generates silent visuals |

The adapter owns every provider concern URS refuses to hold: model selection, credit cost, clamping durations to what the model supports, and deciding that narration has nowhere to go.

**That asymmetry is the point.** One renderer consumes almost everything; the other discards most of it. Both read the identical object. Neither can influence its shape — and URS never learns which one was chosen.

---

## Success criteria

| Criterion | Status |
|---|---|
| One canonical Universal Render Specification exists | ✅ `renderSpecSchema.js` + `buildRenderSpec.js` |
| Existing Content Packages can generate a URS | ✅ validated on a real package, structurally valid |
| No information lost in the transform | ✅ 73/73 semantic values verified present |
| No provider-specific logic inside URS | ✅ automated scan clean in executable code |
| Existing providers require no breaking changes | ✅ zero existing files modified; `git status` shows only new, untracked files |
| Stable rendering contract for future providers | ✅ versioned (`ursVersion: 1`), validated, completeness-scored |

**Stopped here per milestone scope.** No rendering performed, no provider executed, no translator implemented.
