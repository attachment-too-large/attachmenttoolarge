# Character art and voice — hosted as release assets, not in the repository

Three images and three voice clips of Muelsyse are used by the landing page (`index.html`). They
are **not** in the repository, and that is deliberate.

| Asset | What it is | Size |
|---|---|---|
| `muelsyse.png` | the official standing illustration (*立绘*) | 2048×2048 |
| `muelsyse-bust.png` | the official bust portrait (*半身像*) | 180×360 |
| `muelsyse-chibi.png` | the chibi from the official *Arknights Festival* welcome card, background cut out | 474×635 |
| `muelsyse-jp-cn_033.mp3` | her Japanese line for 进驻设施 — "Let's really decorate this place" | 34 KB |
| `muelsyse-jp-cn_032.mp3` | her Japanese line for 行动失败 — "I got my mirages to lead them off" | 30 KB |
| `muelsyse-jp-cn_043.mp3` | her Japanese line for 生日 — "imagining what you might've been like" | 184 KB |

The `cn_0NN` in the audio filenames is **a record number, not a language**: on the source archive
the directory `voice/` holds the Japanese performances and `voice_cn/` the Mandarin ones, with the
same filenames in both. These three come from `voice/`.

The chibi is the one asset that was edited rather than used as found. The original card carries the
festival banner, a QR code and a Xiaohongshu repost watermark; the crop keeps the character, the
paper plane and the *MUELSYSE* name plate and drops everything below the orange rule, which removes
the QR code and the watermark together. The crop is exactly 3:4, the ratio of the art box.

Then the poster's blue background was cut away so she sits on the card the way the other two
figures do. That is a segmentation, not a colour key: the background is not only blue, it also has
yellow and green shapes in the character's own palette, so keying on blue either leaves those
behind or eats her leaf ornaments. What works, in order:

1. **Blur the decision image by 1px, then region-grow from the border with a local tolerance.** The
   fill compares each pixel with the one it came from, so a gradient is followed rather than
   matched against a fixed colour. The blur is what makes it work: the poster's halftone dots dam
   the growth, and behind a dam a whole field of blue never reaches the border and survives as a
   slab. Tolerance is critical and was measured, not guessed — at 1px blur the silhouette holds at
   14 and fails at 18, and 18 is not "a bit worse", it is her entire body gone.
2. **Erode to the solid core, then grow back only into non-blue pixels.** Growth stops outside her
   dark outline, which leaves a rim of background blue clinging to her; growing back through
   non-blue pixels drops the rim while returning her own edges.
3. **Keep the largest blob.** That is what discards the name plate, the game logo and the loose
   confetti — and, once the rim is gone, the yellow stars that were hanging off it too.
4. **Absorb any remaining blue region of 50px or more.** Enclosed pockets ringed by hair can never
   be reached by connectivity. Blue is safe as a test here precisely because she has none: her hair
   is grey-brown, her uniform white-grey-black, her ornaments olive and orange.
5. **Feather by 1px and decontaminate.** Edge pixels are a blend of her and the blue, so their
   colour is pulled back toward hers before the alpha is written; without it the cut-out carries a
   faint blue penumbra.

Three small background fragments survive near the paper plane's lower-left edge, in the one place
where the poster's yellow-green band runs right up against the wing. They were left rather than
chased: every patch tried there landed on the wing itself and punched a hole in it, which is worse
than the fragment. Dropping the paper plane as well would remove them, at the cost of a plainer
picture.

**Copyright.** The character, all three images and all three voice clips are from *Arknights*
(明日方舟) and belong to Hypergryph / Studio Montagne. They are used here non-commercially, with
attribution, because the author of this site likes the character — nothing more than that. The
site is a work of fiction and is not affiliated with the rights holders.

**Why they are not in the repository.** They are somebody else's work. Keeping them out of the git
history keeps the repository to the site's own work; all six files are still published, as release
assets, so the deployed page can show and play them.

**How the page refers to them.** The tag is now `character-art-v3` on both hosts — v1 still exists
and still works, but the chibi changed in v2 and a release asset cannot be overwritten in place, so
the whole set moved together. Each `<img>` carries the Gitee URL as its `src` and the rest of the
chain in `data-ch-alt`:

1. **Gitee** — `machinekyansauto3-operator/attachmenttoolarge-assets`, release `character-art-v3`.
   Served as `image/png` and `audio/mpeg` with no referer check, and reachable from inside China.
2. **GitHub** — `attachment-too-large/attachmenttoolarge`, same tag. Fine from outside China, but
   the download redirects to the objects CDN, which is often unreachable from inside it.
3. **Local** — `assets/img/<name>.png` and `assets/audio/<name>.mp3`, for working on the site with
   the files present.

`assets/js/character.js` walks that list on each `error` and only shows the "not distributed"
fallback once every candidate has failed. The order matters and is written into the file:
`is-missing` is a terminal class, so marking the card missing after the *first* failure would make
every later candidate useless.

The voice files use the same two-mirror list. The player is **attached to the document** rather
than being a detached `new Audio()`: a detached player cannot be found from outside, which is
exactly what made the platter on the records page stand still while a recording played. It also
means the check can see the element and assert that the clip really advances.

Sounding off is the left-bottom switch's job. The switch means "nothing makes noise", so a muted
site stays silent when she is clicked; that is asserted, not assumed.

The audit prints which host actually served each image, so a silent fallback cannot hide.

**The words on the card are her own.** Every greeting is a line from her official voice record —
the Chinese and English text is taken from the in-game voice files as transcribed on PRTS
(*缪尔赛思/语音记录*). The first version of this card used lines written for the occasion, one of
which had her say she "isn't human anyway"; that is simply wrong about her — she is an elf, a
people from Sami, and she never says anything of the kind about herself. Quoting her beats
inventing her.

## Republishing

```sh
# GitHub — one call per file, all under the same tag
node tools/publish-asset.mjs assets/img/muelsyse.png            --tag character-art-v3 --title "Muelsyse character assets" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/img/muelsyse-bust.png       --tag character-art-v3 --title "Muelsyse character assets" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/img/muelsyse-chibi.png      --tag character-art-v3 --title "Muelsyse character assets" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/audio/muelsyse-jp-cn_033.mp3 --tag character-art-v3 --title "Muelsyse character assets" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/audio/muelsyse-jp-cn_032.mp3 --tag character-art-v3 --title "Muelsyse character assets" --notes docs/CHARACTER-ART.md
node tools/publish-asset.mjs assets/audio/muelsyse-jp-cn_043.mp3 --tag character-art-v3 --title "Muelsyse character assets" --notes docs/CHARACTER-ART.md
```

The tag is `character-art-vN`, not `v*`, so the CLI release workflow is not triggered. **A release
asset cannot be overwritten**, and `publish-asset.mjs` skips names that already exist — so
replacing an asset means a new tag, which is why the chibi change pulled the whole set to v2.

Gitee has no equivalent of `publish-asset.mjs`; it takes a multipart `attach_files` call against
the release id:

```sh
curl -X POST -H "Authorization: token $GITEE_TOKEN" \
  -F "file=@assets/img/muelsyse-chibi.png" \
  https://gitee.com/api/v5/repos/machinekyansauto3-operator/attachmenttoolarge-assets/releases/<release_id>/attach_files
```

The mirror is insurance, not decoration: when the GitHub object CDN is unreachable the page still
shows — and now speaks — her. If only one host is ever needed, drop the other from `data-ch-alt`.

## Where the voice came from

The Japanese performances are archived at `torappu.prts.wiki/assets/audio/`. The path is
`voice/<character id>/<file>.mp3` for Japanese and `voice_cn/...` for Mandarin, with the filename
**lowercased** — `voice/char_249_mlyss/cn_033.mp3`, not `CN_033`. (The PRTS voice widget builds the
same URL from the parameters on its `语音记录` subpage; reading the rendered page's data attributes
gets there faster than guessing.)

## Where the battle chibi came from — the previous version

Before the festival card, the Q版 was the in-game battle sprite rendered from its Spine model. That
render is still reproducible: the model exists only as a Spine skeleton, and no source publishes it
as a flat image, so it was rendered once, locally, from the official 3.8.99 skeleton:

- model: `isHarryh/Ark-Models` → `models/249_mlyss/build_char_249_mlyss.{skel,atlas,png}`
- runtime: `EsotericSoftware/spine-runtimes`, branch `3.8` → `spine-ts/build/spine-webgl.js`
- posed at the `Default` idle, framed to the tight drawn bounds, exported 3:4 with a transparent
  background

That render is 720×960 with a transparent background, so it composites onto the card perfectly; the
festival crop is an opaque 474×635 rectangle and sits on the plate as a card instead. Swapping back
is one attribute in `index.html` plus the asset under the tag that still holds it. The render is a
one-off local step: the site ships a PNG and no runtime, no dependency and no network call of its
own. See `docs/DESIGN-SKILL.md` §6 for the full recipe.

