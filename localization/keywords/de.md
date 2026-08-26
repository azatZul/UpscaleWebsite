# 🇩🇪 German keywords — `/de/`

Part of the UScale keyword map. Shared rules, the English head terms and the
page architecture live in [`../../keywords.md`](../../keywords.md); this file holds
everything specific to this locale.

Status: live

---


**ASO popularity** (App Store demand): `bilder schärfer machen` (p26, d47) · `foto schärfen` (p14, d45) · `AI Foto verbessern` (p11, d45) · `bild schärfen` (p10, d59) · `fotos schärfen bilder qualität` (p7, **d21**) · `gesicht enhancer` (p5, d41) · `videoverbesserung` (p5, **d17**) · `KI Fotoverbesserung` (p5, **d13**) · `KI Bildbearbeitung` (p55, d74)

**Web demand** — Google Trends, region DE, 12 months to 2026-08-23, six comparisons stitched on the shared anchor `foto schärfen` = 1.00. The anchor is below the Trends cutoff for most weeks, so the ratios come from the final three weeks, where it clears the threshold in every batch. `bilder schärfer machen` appears in two batches independently and lands at 2.8 and 3.0, which is what validates the stitch.

| Term | × anchor | Verdict |
|---|---|---|
| `remini` | 45.5 | Competitor brand — see the comparison page below |
| `ki bildbearbeitung` | 36.6 | Excluded: generative *editing* intent, Adobe/Canva SERP |
| **`bild vergrößern`** | **12.2** | Biggest usable term. Contaminated with zoom/print — qualify it |
| **`auflösung erhöhen`** | **7.5** | Clean upscaler intent |
| **`bildqualität verbessern`** | **5.1** | Best clean head term, matches the in-app label „Verbessern“ |
| `bild schärfen` | 4.6 | Singular beats the phrase form |
| `foto verbessern` | 4.4 | |
| `bild hochskalieren` | 3.9 | Correct technical term, but a third of `vergrößern` |
| `bilder schärfer machen` | 2.9 | The previous `<title>` target — the weakest of this cluster |
| `videoqualität verbessern` | 1.9 | Top video term; `video hochskalieren` is 0.55 |
| `alte fotos restaurieren` | 1.0 | Measurable — the restore guide has real demand |
| `fotos kolorieren` | 0.5 | Measurable |
| `fotoqualität verbessern` | 0.13 | **40× below `bildqualität verbessern`** — never write *Fotoqualität* |
| `ki fotoverbesserung`, `foto enhancer` | 0.0 | Germans do not search these as nouns. Removed from the H1 |
| `verwackeltes foto reparieren`, `dunkle fotos aufhellen`, `zeitlupe erstellen` | 0.0 | Below the Trends cutoff, **not** zero demand — long-tail guide plays, keep as-is |

**Reading the zeros:** Trends has a measurement floor. A flat zero means "under the floor", never "nobody searches it". The 0.0 rows above are unmeasured, not disqualified; only Keyword Planner can separate the two.

**`KI Bildbearbeitung` is deliberately not the landing-page target**, despite topping both ASO (p55) and Trends (36.6). Those rank demand, not fit. The German SERP for it is Adobe Firefly, Canva, Android and Perfect Corp — generative photo *editing*, a different intent and an unwinnable page.

**`Bild` beats `Foto` in compounds.** `bildqualität verbessern` outdraws `fotoqualität verbessern` 40:1 between two exact synonyms. Prefer *Bild-* in any compound noun that carries search intent.

Placement: `bildqualität verbessern` → home `<title>`, screenshot caption · `bilder schärft, vergrößert, restauriert` → home H1 · `auflösung erhöhen` → hero subhead and the 4K guide H1 · `bild vergrößern ohne Qualitätsverlust` → 4K guide `<title>`, card and meta description · `videoqualität verbessern` → video guide `<title>` · `alte fotos restaurieren` → restore guide `<title>`.

**`hochskalieren` stays the verb for the *product action*** — it is the in-app label („Kreatives Hochskalieren“) and every step-by-step instruction must match what the user sees on screen. But it is only a third of `vergrößern` on the web, so **SEO surfaces lead with `vergrößern` / `Auflösung erhöhen`** and the body copy switches to `hochskalieren` once the reader is on the page. The 4K guide intro contrasts the two explicitly, which is what keeps the intents from splitting.

**iPhone as the qualifier.** We cannot outrank free browser upscalers on the bare head terms — the searcher for `bild vergrößern` wants a web tool. What we can own is the same term plus the platform, so every German `<title>` and H1 now names iPhone. German body copy still says *Smartphone* where the sentence is about physically holding the phone, which is correct German and not an SEO surface.

**Competitor brands.** `remini` at 45.5 is the single largest German term measured, and `/de/compare.html` already runs the same photos through Remini, BlurBuster and EnhanceFox. That page — not the landing page — is where brand demand is captured; the §1 exclusion of brand terms still holds for `/de/`.

