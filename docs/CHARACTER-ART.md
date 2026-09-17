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

**How the page refers to them.** Each `<img>` carries the Gitee URL as its `src` and the rest of
the chain in `data-ch-alt`:

1. **Gitee** — `machinekyansauto3-operator/attachmenttoolarge-assets`, release `character-art-v1`.
   Served as `image/png` with no referer check, and reachable from inside China.
2. **GitHub** — `attachment-too-large/attachmenttoolarge`, same tag. Fine from outside China, but
   the download redirects to the objects CDN, which is often unreachable from inside it.
3. **Local** — `assets/img/<name>.png`, for working on the site with the files present.

`assets/js/character.js` walks that list on each `error` and only shows the "not distributed"
fallback once every candidate has failed. The order matters and is written into the file:
`is-missing` is a terminal class, so marking the card missing after the *first* failure would make
every later candidate useless.

The audit prints which host actually served each image, so a silent fallback cannot hide.

**The words on the card are her own.** Every greeting is a line from her official voice record —
the Chinese and English text is taken from the in-game voice files as transcribed on PRTS
(*缪尔赛思/语音记录*). The first version of this card used lines written for the occasion, one of
which had her say she "isn't human anyway"; that is simply wrong about her — she is an elf, a
people from Sami, and she never says anything of the kind about herself. Quoting her beats
inventing her.

## Republishing

```sh
# GitHub
node tools/publish-asset.mjs assets/img/muelsyse.png       --tag character-art-v1 --title "Muelsyse character art" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/img/muelsyse-bust.png  --tag character-art-v1 --title "Muelsyse character art" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/img/muelsyse-chibi.png --tag character-art-v1 --title "Muelsyse character art" --notes docs/CHARACTER-ART.md
```

The tag is `character-art-v1`, not `v*`, so the CLI release workflow is not triggered.

Gitee has no equivalent of `publish-asset.mjs`; it takes a multipart `attach_files` call against
the release id:

```sh
curl -X POST -H "Authorization: token $GITEE_TOKEN" \
  -F "file=@assets/img/muelsyse.png" \
  https://gitee.com/api/v5/repos/machinekyansauto3-operator/attachmenttoolarge-assets/releases/<release_id>/attach_files
```

The mirror is insurance, not decoration: when the GitHub object CDN is unreachable the page still
shows her. If only one host is ever needed, drop the other from `data-ch-alt`.

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
