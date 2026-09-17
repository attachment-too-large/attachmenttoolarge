# Character art — hosted as release assets, not in the repository

Three images of Muelsyse are used by the landing page (`index.html`). They are **not**
in the repository, and that is deliberate.

| Asset | What it is | Size |
|---|---|---|
| `muelsyse.png` | the official standing illustration (*立绘*) | 2048×2048 |
| `muelsyse-bust.png` | the official bust portrait (*半身像*) | 180×360 |
| `muelsyse-chibi.png` | the official battle chibi (*小人*, Q version) | 720×960 |

**Copyright.** The character and all three images are from *Arknights* (明日方舟) and belong to
Hypergryph / Studio Montagne. They are used here non-commercially, with attribution, because the
author of this site likes the character — nothing more than that. The site is a work of fiction
and is not affiliated with the rights holders.

**Why they are not in the repository.** They are somebody else's artwork. Keeping them out of the
git history keeps the repository to the site's own work; the images are still published, as
release assets, so the deployed page can show them.

**How the page refers to them.** `index.html` points each `<img>` at the release asset's absolute
URL. If that fetch fails, `assets/js/character.js` retries the equivalent path under
`assets/img/` (useful when working locally with the files present) and, if that fails too, the
card shows its "not distributed" fallback rather than a broken image.

## Republishing

```sh
node tools/publish-asset.mjs assets/img/muelsyse.png       --tag character-art-v1 --title "Muelsyse character art" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/img/muelsyse-bust.png  --tag character-art-v1 --title "Muelsyse character art" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/img/muelsyse-chibi.png --tag character-art-v1 --title "Muelsyse character art" --notes docs/CHARACTER-ART.md
```

The tag is `character-art-v1`, not `v*`, so the CLI release workflow is not triggered.

## Where the chibi came from

The in-game chibi exists only as a Spine model — no source publishes it as a flat image. It was
rendered once, locally, from the official 3.8.99 skeleton:

- model: `isHarryh/Ark-Models` → `models/249_mlyss/build_char_249_mlyss.{skel,atlas,png}`
- runtime: `EsotericSoftware/spine-runtimes`, branch `3.8` → `spine-ts/build/spine-webgl.js`
- posed at the `Default` idle, framed to the tight drawn bounds, exported 3:4 with a transparent
  background

The render is a one-off, local step: the site ships a PNG and no runtime, no dependency and no
network call of its own. When the images are unavailable the fallback in `assets/img/` is what
makes a local run work; see `docs/DESIGN-SKILL.md` §6 for the full recipe.
