/* ==========================================================================
   attachmenttoolarge — 浏览器端自检（CDP 驱动，零依赖）

   用法：
     node tools/browser-check.mjs                  # 默认检查 index.html
     node tools/browser-check.mjs rap.html         # 检查指定页面
     node tools/browser-check.mjs 全部             # 检查全部页面（含移动视口）

   启动无头 Edge，通过 Chrome DevTools Protocol 在真实页面里跑交互并回收结果：
   主题切换、主题音乐与 Rap 曲目（含离线渲染波形，证明确实出声）、
   歌词与 lyrics.js 的一致性、卡拉OK高亮、音效开关联动、复制按钮、Toast、
   附件体积计、表单 413 拦截、窄屏溢出、无 JS 时的可读性、未捕获异常。
   ========================================================================== */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome"
];
const EDGE = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!EDGE) {
  console.error("找不到 Edge/Chrome，无法执行浏览器自检");
  process.exit(2);
}

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

function resolvePages(arg) {
  if (!arg) return ["index.html"];
  if (arg === "全部" || arg === "all") {
    return readdirSync(rootDir)
      .filter((f) => f.endsWith(".html"))
      .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
  }
  return [arg];
}

const pages = resolvePages(process.argv[2]);
const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "att-cdp-"));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("CDP 未就绪");
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener("open", () => res({
      send(method, params) {
        return new Promise((ok, no) => {
          const mid = ++id;
          pending.set(mid, { ok, no });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      on(fn) { listeners.push(fn); },
      close: () => ws.close()
    }));
    ws.addEventListener("error", rej);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
        return;
      }
      listeners.forEach((fn) => fn(msg));
    });
  });
}

/* ============================ 页面内断言 ============================ */
const SUITE = `(async () => {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const vh = () => window.innerHeight;
  const inFirstScreen = (el) => el.getBoundingClientRect().top < vh() * 0.92;
  async function until(fn, ms = 6000, step = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await wait(step); }
    return false;
  }
  const hiddenNow = () => [...document.querySelectorAll(".reveal")]
    .filter(e => e.offsetParent !== null)                       // 跳过 display:none 的东西（本就不该可见）
    .filter(e => inFirstScreen(e) && getComputedStyle(e).opacity !== "1").length;

  /* ---------- 基础 ---------- */
  ok("页面标题非空", document.title.length > 0, document.title);
  ok("样式表已加载", getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)", getComputedStyle(document.body).backgroundColor);
  ok("导航链接渲染", document.querySelectorAll("[data-nav-links] a").length >= 6, document.querySelectorAll("[data-nav-links] a").length + " 个");
  await until(() => hiddenNow() === 0, 4000);
  ok("首屏区块全部可见", hiddenNow() === 0, hiddenNow() + " 个首屏区块仍透明");
  const termLines = [...document.querySelectorAll(".terminal .term-line")];
  if (termLines.length) {
    await until(() => termLines.every(l => getComputedStyle(l).opacity === "1"), 5000, 150);
    const hidden = termLines.filter(l => getComputedStyle(l).opacity !== "1").length;
    ok("终端文字可见（动画未藏内容）", hidden === 0, termLines.length + " 行，隐藏 " + hidden);
  }
  ok("未横向溢出视口", document.documentElement.scrollWidth <= window.innerWidth + 1, document.documentElement.scrollWidth + " / " + window.innerWidth);
  ok("页脚年份已填充", /\\d{4}/.test(document.querySelector("[data-year]")?.textContent || ""), document.querySelector("[data-year]")?.textContent);

  /* ---------- 主题 ---------- */
  const themeBtn = document.querySelector("[data-theme-toggle]");
  const before = document.documentElement.getAttribute("data-theme");
  themeBtn.click(); await frame();
  const after = document.documentElement.getAttribute("data-theme");
  /* Contrast, measured rather than eyeballed. The manifesto quote sat on a dark plate
     in the dark theme with dark ink on it, which is why it read as a black rectangle.
     This reports the real numbers and the block's position on the page. */
  const attrLum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const attrParse = (s) => { const n = String(s).replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",").map(Number); return n.length >= 3 && !isNaN(n[0]) ? n.slice(0, 3) : [255, 255, 255]; };
  const attrBg = (el) => { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return attrParse(c); n = n.parentElement; } return [10, 13, 16]; };
  const attrMeasure = () => {
    const q = document.querySelector(".quote");
    if (!q) return null;
    const t = q.querySelector("p") || q;
    const a = attrLum(attrParse(getComputedStyle(t).color)), b = attrLum(attrBg(t));
    const r = q.getBoundingClientRect();
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: getComputedStyle(t).color,
             bg: attrBg(t).join(","), top: Math.round(r.top + window.scrollY), h: Math.round(r.height) };
  };
  const attrOriginalTheme = document.documentElement.getAttribute("data-theme");
  for (const attrTheme of ["dark", "light"]) {
    document.documentElement.setAttribute("data-theme", attrTheme);
    await wait(250);
    const m = attrMeasure();
    const wantLight = attrTheme === "dark";
    const isLight = m ? attrLum(attrParse(m.color)) > 0.5 : null;
    ok("引述块文字随主题 · " + attrTheme, m ? isLight === wantLight : true,
       m ? "text " + m.color + " (" + (isLight ? "light" : "dark") + ", wanted " + (wantLight ? "light" : "dark") + ") · y=" + m.top + " h=" + m.h : "no .quote on this page");
  }
  if (attrOriginalTheme) document.documentElement.setAttribute("data-theme", attrOriginalTheme);
  else document.documentElement.removeAttribute("data-theme");
  await wait(150);
  /* The platter appearing to spin around the wrong point was not a 3D problem: the
     scene forced a 3:2 drawing buffer while the element's CSS box was a different
     shape, so the canvas was cropped and the disc's centre left the middle of the
     panel. Buffer and CSS box must agree, or the render is a crop rather than a fit. */
  const recordCanvas = document.querySelector("[data-record-scene] canvas");
  if (recordCanvas && recordCanvas.clientWidth) {
    const ratioW = recordCanvas.width / (recordCanvas.clientWidth * (window.devicePixelRatio || 1));
    const ratioH = recordCanvas.height / (recordCanvas.clientHeight * (window.devicePixelRatio || 1));
    ok("唱片画布无裁切（缓冲与显示尺寸一致）", Math.abs(ratioW - 1) < 0.03 && Math.abs(ratioH - 1) < 0.03,
       "buffer " + recordCanvas.width + "x" + recordCanvas.height + " vs box " + recordCanvas.clientWidth + "x" + recordCanvas.clientHeight +
       " · ratios " + ratioW.toFixed(3) + " / " + ratioH.toFixed(3));
  } else {
    ok("唱片画布无裁切（本页无画布，跳过）", true, "no canvas on this page");
  }
  /* The entrance plate is a door, not part of the page: it covers everything and
     swallows the first click, so close it before anything is measured. */
  (function () {
    try { sessionStorage.setItem("att.intro.seen", "1"); } catch (e) { /* private mode */ }
    var plate = document.querySelector(".intro");
    if (plate && plate.parentNode) plate.parentNode.removeChild(plate);
    document.documentElement.classList.remove("intro-lock");
  })();
  await wait(200);
  ok("主题切换生效", before !== after, before + " -> " + after);
  ok("主题按钮是 SVG 图标", !!themeBtn.querySelector("svg"));
  themeBtn.click(); await frame();
  ok("主题可切回", document.documentElement.getAttribute("data-theme") === before);

  /* ---------- 音乐：器乐 ---------- */
  const music = window.ATTMusic;
  ok("音乐模块已加载", !!music && typeof music.start === "function");
  const vs = ("speechSynthesis" in window) ? (window.speechSynthesis.getVoices() || []) : [];
  const zh = vs.filter(v => /zh|Chinese|Huihui|Xiaoxiao|Yunxi|Kangkang/i.test((v.lang || "") + (v.name || "")));
  ok("系统语音能力", true,
     !("speechSynthesis" in window) ? "本机不支持语音合成（Rap 降级为纯伴奏）"
       : vs.length === 0 ? "语音列表为空（未知）"
       : zh.length ? "中文语音 " + zh.length + "/" + vs.length + " 个 · " + zh[0].name
       : "共 " + vs.length + " 个语音但无中文（Rap 会降级）");
  const pill = document.querySelector("[data-music]");
  ok("音乐控件已注入", !!pill);
  ok("默认静音", music.isOn() === false);
  ok("静音时音效静默", window.attSfx("error") === false);
  music.selectTrack("lofi"); await wait(150);
  const rl = await music.renderOffline(6, "lofi");
  ok("器乐合成器有波形", rl.peak > 0.02 && rl.rms > 0.004, "peak=" + rl.peak + " rms=" + rl.rms);
  ok("器乐没有嘶声杂音", rl.hf < 0.25, "hf=" + rl.hf + " (high-frequency energy share)");
  const twoLoops = await music.renderOffline(Math.ceil(music.loopSeconds() * 2) + 1, "lofi");
  const ratio = twoLoops.rmsSecondHalf / Math.max(twoLoops.rmsFirstHalf, 1e-9);
  ok("器乐可以一直循环（不衰减）", ratio > 0.6 && ratio < 1.6,
     "first half " + twoLoops.rmsFirstHalf + " / second half " + twoLoops.rmsSecondHalf +
     " · ratio " + ratio.toFixed(2) + " · over " + Math.round(music.loopSeconds() * 2) + "s");
  pill.querySelector("[data-music-toggle]").click(); await wait(450);
  ok("点击后进入播放态", music.isOn() === true);
  ok("控件反映播放状态", pill.classList.contains("is-playing"));
  ok("播放后音效放行", window.attSfx("blip") === true);
  music.setVolume(0.3); await wait(200);
  ok("音量设置生效", Math.abs(parseFloat(pill.querySelector("[data-music-vol]").value) - 30) < 1);
  pill.querySelector("[data-music-toggle]").click(); await wait(400);
  ok("再次点击可暂停", music.isOn() === false && !pill.classList.contains("is-playing"));
  ok("暂停后音效恢复静默", window.attSfx("error") === false);
  music.setVolume(0.6);

  /* ---------- 播放器：只有器乐一条曲目 ---------- */
  const lines = music.lyrics();
  ok("歌词已加载", lines.length >= 30, lines.length + " 行");
  const rr = await music.renderOffline(6, "rap");
  ok("合成器能渲染说唱鼓组（引擎仍在）", rr.peak > 0.02 && rr.rms > 0.004, "peak=" + rr.peak);
  ok("播放器不提供说唱切换", !pill.querySelector("[data-music-track]"), "no track switcher");
  ok("播放器不提供人声朗读开关", !pill.querySelector("[data-music-voice]"), "no voice switch");
  ok("站点背景音乐是器乐而非人声", ["postrock", "lofi"].indexOf(music.currentTrack().id) >= 0, music.currentTrack().name + " (" + music.currentTrack().id + ")");
  ok("入口指向唱片页", /music\.html/.test(pill.querySelector("[data-music-lyrics]")?.getAttribute("href") || ""),
     (pill.querySelector("[data-music-lyrics]")?.textContent || "").trim());

  const heard = [];
  const off = music.onLine(p => { if (p) heard.push(p); });
  music.start();
  await wait(1200);
  ok("器乐播放中", music.isOn() === true, "playing");
  ok("器乐不朗读歌词", heard.length === 0, "no lyric narration from the background track");
  if (off) off();

  // 紧急静音：一键全停，并且之后拒绝播放
  music.stop(); await wait(200);
  music.panic(); await wait(200);
  ok("紧急静音生效", music.isMuted() === true && music.isOn() === false, "muted");
  ok("静音后拒绝播放", music.start() === false, "start() 返回 false");
  music.mute(false); await wait(150);
  ok("可以解除静音", music.isMuted() === false, "unmuted");
  ok("解除后仍保持不自动播放", music.isOn() === false, "still silent until asked");

  /* ---------- 唱片页：四首曲目、真实播放、歌词跟随 ---------- */
  const trackList = document.querySelector("[data-ms-tracks]");
  if (trackList) {
    const rows = [...trackList.querySelectorAll(".ms-track")];
    /* The count is not fixed — tracks keep being added, and a hard-coded number
       only ever fails for the wrong reason. What matters is that every row is
       playable and that the known ones are present. */
    ok("曲目表不为空且每条都可播放", rows.length >= 5 && rows.every(r => r.hasAttribute("data-track")),
       rows.length + " rows, each with a data-track");
    const names = rows.map(r => r.querySelector(".ms-name")?.textContent || "");
    ok("曲目名完整", /Failed at 19:59/.test(names[0]) && /Wrong Side of the Wire/.test(names[2]) && /Ninety-Nine Forever/.test(names[3]) && /The Long Send/.test(names[4]), names.join(" · ").slice(0, 78));

    /* the in-house Ark-flavoured score: composed here, not fetched from anywhere */
    const ark = await music.renderOffline(22, "postrock");   // a whole eight-bar build, not just the intro
    ok("后摇曲有波形", ark.peak > 0.02 && ark.rms > 0.004, "peak=" + ark.peak + " rms=" + ark.rms);
    /* The comparison that was actually asked for: the two pieces by their spectrum.
       Percussion is a layer on top of whatever bed is underneath, so counting hits
       per second cannot tell "a different piece" from "the same piece with drums" —
       which is exactly the mistake this test used to make. The spectral centroid and
       the low/mid/high energy shares can tell: a piece with its own pad, bass and
       arpeggio sits elsewhere in the spectrum before a single drum plays. */
    const centroidGap = Math.abs(ark.centroidHz - rl.centroidHz) / Math.max(ark.centroidHz, rl.centroidHz, 1);
    const bandGap = Math.max(
      Math.abs(ark.lowShare - rl.lowShare),
      Math.abs(ark.midShare - rl.midShare),
      Math.abs(ark.highShare - rl.highShare)
    );
    const differs = (centroidGap >= 0.15 ? 1 : 0) + (bandGap >= 0.10 ? 1 : 0);
    ok("后摇与铺底是两首不同的曲子（按频谱）", differs >= 2,
       "centroid " + rl.centroidHz + "Hz vs " + ark.centroidHz + "Hz (gap " + (centroidGap * 100).toFixed(0) + "%) · " +
       "low/mid/high " + rl.lowShare + "/" + rl.midShare + "/" + rl.highShare + " vs " +
       ark.lowShare + "/" + ark.midShare + "/" + ark.highShare + " (max band gap " + (bandGap * 100).toFixed(0) + "%)");
    /* the electronic version, and the fact that track 01 now carries a long melody */
    const el = await music.renderOffline(8, "electro");
    ok("电音版有波形", el.peak > 0.02 && el.rms > 0.004, "peak=" + el.peak + " rms=" + el.rms);
    ok("电音版是鼓组驱动（起音密集）", el.onsetsPerSecond > rl.onsetsPerSecond * 3,
       "electro " + el.onsetsPerSecond + "/s vs ambient " + rl.onsetsPerSecond + "/s");
    ok("第一首的循环已延长", music.loopSeconds() > 40, music.loopSeconds() + "s per pass");
    const elRow = document.querySelector('[data-track="electro"]');
    if (elRow) {
      elRow.click(); await wait(400);
      ok("选到电音版", /Rejected/.test(music.currentTrack().name), music.currentTrack().id + " · " + music.currentTrack().name);
      ok("电音版在播", music.isOn() === true, "playing");
      elRow.click(); await wait(200);
    }
    const arkRow = document.querySelector('[data-track="postrock"]');
    if (arkRow) {
      arkRow.click(); await wait(400);
      ok("选到后摇曲目", music.currentTrack().id === "postrock" && /The Long Send/.test(music.currentTrack().name),
         music.currentTrack().id + " · " + music.currentTrack().name);
      ok("后摇曲目在播", music.isOn() === true, "playing");
      arkRow.click(); await wait(200);   // stop it again
    }

    /* the words below the list must follow whichever track is selected */
    const msTitle = () => (document.querySelector("[data-lyrics-title]") || {}).textContent || "";
    const msCount = () => document.querySelectorAll("[data-lyrics] .lyric-line").length;
    const msRow = (id) => document.querySelector('[data-track="' + id + '"]');
    ok("删掉了那段说明文字", !/real recordings, generated from their own lyrics/.test(document.body.innerText), "removed");
    if (msRow("wire")) {
      msRow("wire").click(); await wait(300);
      ok("歌词随曲目切换 · wire", /Wrong Side of the Wire/.test(msTitle()) && msCount() > 15, msTitle() + " · " + msCount() + " lines");
      msRow("ninetynine").click(); await wait(300);
      ok("歌词随曲目切换 · ninetynine", /Ninety-Nine Forever/.test(msTitle()), msTitle());
      msRow("lofi").click(); await wait(300);
      ok("器乐不冒充别人的歌词", msTitle() === "No words" && msCount() === 0, msTitle());
      msRow("rap").click(); await wait(300);
      ok("切回说唱是它自己的词", /Attachment Too Large/.test(msTitle()) && msCount() >= 30, msTitle() + " · " + msCount() + " lines");
      /* Leave the player stopped: the page stops the current track when its row is
         clicked again, and a later assertion clicking "rap" then starts it properly.
         (The page's stopAll() lives in a closure and is not reachable from here.) */
      msRow("rap").click(); await wait(200);
    }

    /* ---------- switching between tracks: the file player and the live synth ---------- */
    if (msRow("wire") && msRow("lofi")) {
      const el = document.querySelector("audio");
      const src = () => (el && (el.currentSrc || el.src)) || "";
      const short = () => src().split("/").pop();

      msRow("wire").click();
      await until(() => /wire\.mp3/.test(src()) && !el.paused, 6000, 150);
      ok("切到 03：音轨换成 wire 并在播", /wire\.mp3/.test(src()) && !el.paused, short() + " paused=" + el.paused);

      msRow("ninetynine").click();
      await until(() => /ninetynine\.mp3/.test(src()) && !el.paused, 6000, 150);
      ok("03 直接切 04 不卡住", /ninetynine\.mp3/.test(src()) && !el.paused, short() + " paused=" + el.paused);

      msRow("lofi").click();
      await until(() => music.isOn(), 6000, 150);
      ok("切到器乐：录音停下、合成器接管", el.paused === true && music.isOn() === true,
         "audio paused=" + el.paused + " synth=" + music.isOn());

      msRow("rap").click();
      await until(() => /rap\.mp3/.test(src()) && !el.paused, 6000, 150);
      ok("从器乐切回录音：合成器让位", /rap\.mp3/.test(src()) && !el.paused && music.isOn() === false,
         short() + " paused=" + el.paused + " synth=" + music.isOn());

      msRow("rap").click(); await wait(250);            // stop again, leaving the page quiet
      ok("连点两次同一行会停下", el.paused === true, "paused=" + el.paused);
    }
    ok("播放器在 DOM 里", !!document.querySelector("audio"), "hidden audio element");

    // 点击说唱那条：应当切到 rap.mp3 并开始播放
    const rapRow = rows.find(r => /rap\.mp3/.test(r.getAttribute("data-src") || ""));
    rapRow.click();
    await until(() => { const a = document.querySelector("audio"); return a && /rap\.mp3/.test(a.currentSrc || a.src) && a.duration > 0; }, 9000, 200);
    const a1 = document.querySelector("audio");
    ok("点击后切到该曲目", /rap\.mp3/.test(a1.currentSrc || a1.src), (a1.currentSrc || a1.src).split("/").pop());
    ok("该曲目时长正确", a1.duration > 150 && a1.duration < 200, Math.round(a1.duration) + "s");
    await until(() => !a1.paused, 4000, 150);
    ok("真的在播放", !a1.paused, "paused=" + a1.paused);
    ok("该行高亮", rapRow.classList.contains("is-playing"), "row marked");

    // 歌词：38 行（一致性由下面那条通用断言负责），点一行会跳到对应位置并高亮
    const lyricLines = [...document.querySelectorAll("[data-lyrics] .lyric-line")];
    ok("唱片页带说唱歌词", lyricLines.length === 38, lyricLines.length + " lines");
    lyricLines[12].click();
    await until(() => document.querySelector(".lyric-line.is-active"), 4000, 150);
    ok("点歌词会定位并高亮", !!document.querySelector(".lyric-line.is-active"),
       (document.querySelector(".lyric-line.is-active")?.textContent || "").slice(0, 30));

    // 切到合成器乐那条：不该有音频文件在放
    rows[0].click();
    await wait(600);
    const a2 = document.querySelector("audio");
    ok("切到实时合成器乐会停掉文件", a2.paused === true, "file audio paused");
    ok("播放条反映状态", /Failed at 19:59/.test(document.querySelector("[data-ms-state]")?.textContent || ""),
       document.querySelector("[data-ms-state]")?.textContent?.slice(0, 40));

    /* ---------- 缪尔赛思的主题：Through the Water Line ----------
       「好听、舒服」不能靠嘴说，但可以用几个能测的代理指标守住：
       有波形、不削顶、不刺耳、没有鼓、有层次、引擎认得这个 id。
       这些一条都不过关时，它不可能舒服。 */
    const wl = await music.renderOffline(28, "waterline");
    ok("水线主题有波形", wl.peak > 0.02 && wl.rms > 0.004, "peak=" + wl.peak + " rms=" + wl.rms);
    ok("水线主题不削顶", wl.peak < 0.95, "peak=" + wl.peak + "（>=0.95 就是在削顶）");
    ok("水线主题不刺耳（高频占比低）", wl.hf < 0.10,
       "hf=" + wl.hf + " · centroid " + wl.centroidHz + "Hz · low/mid/high " + wl.lowShare + "/" + wl.midShare + "/" + wl.highShare);
    /* 琶音是八分音符，本来就有起音；要证明的是它比鼓组稀疏得多，而不是「绝对没有起音」 */
    ok("水线主题没有鼓（比电音稀疏）", wl.onsetsPerSecond < el.onsetsPerSecond,
       "waterline " + wl.onsetsPerSecond + "/s vs electro " + el.onsetsPerSecond + "/s");
    /* 48 秒刚好跨过第一层到第二层的分界（前 8 小节只有垫，之后才进琶音与低音），
       再长就只是让审计多跑一遍离线渲染。 */
    const wlBuild = await music.renderOffline(48, "waterline");
    ok("水线主题有层次（不是一条音量到底）", wlBuild.rmsSecondHalf > wlBuild.rmsFirstHalf,
       "前 24 秒 rms " + wlBuild.rmsFirstHalf + " → 后 24 秒 " + wlBuild.rmsSecondHalf);
    /* selectTrack 会把不认识的 id 悄悄退回 lofi —— 所以这条断言是有意义的：
       忘了把新曲目加进白名单时，这里会红。 */
    ok("引擎认得水线主题", music.selectTrack("waterline") === "waterline", music.currentTrack().name);

    /* ---------- 唱片页：盘要转，歌词要跟着走 ----------
       两条都断言"跑出来的事实"，不是读代码推断。

       盘转没转，不看像素（场景是 WebGL，画完缓冲区就丢了），看场景自己在 host 上
       打的 is-spinning。这个类现在也是断言的抓手：录放时它曾经**永远是 false**，
       因为播放器是用 new Audio() 建的、元素不在 DOM 里，而场景脚本在加载时用
       document.querySelector("audio") 找过它一次，拿到 null 就再没问过第二次。
       （注意：这段字符串本身是模板字面量，注释里不能出现反引号。）

       歌词走没走，让录音跳到末尾，看面板的 scrollTop 有没有真的动。以前只在活跃行
       快贴到边时才滚，列表能连着八九行纹丝不动 —— 高亮在动，页面看着像没动。 */
    const sceneHost = document.querySelector("[data-record-scene]");
    const firstFile = rows.find(r => r.getAttribute("data-kind") === "file");
    if (sceneHost && firstFile) {
      firstFile.click();
      await until(() => sceneHost.classList.contains("is-spinning"), 5000, 150);
      ok("放录音时唱片真的在转", sceneHost.classList.contains("is-spinning"),
         "is-spinning=" + sceneHost.classList.contains("is-spinning") + " · " + firstFile.querySelector(".ms-name").textContent);

      const lyricHost = document.querySelector("[data-lyrics]");
      const lineCount = document.querySelectorAll("[data-lyrics] .lyric-line").length;
      const a3 = document.querySelector("audio");
      if (lyricHost && lineCount && a3) {
        await until(() => a3.duration > 0, 6000, 150);
        ok("歌词面板可滚动", lyricHost.scrollHeight > lyricHost.clientHeight,
           lyricHost.scrollHeight + " / " + lyricHost.clientHeight);
        a3.currentTime = a3.duration * 0.92;
        await until(() => lyricHost.scrollTop > 0, 5000, 150);
        ok("歌词跟着歌走（跳到末尾后面板滚下去）", lyricHost.scrollTop > 0,
           "scrollTop=" + Math.round(lyricHost.scrollTop) + " · 活跃行「" +
           (document.querySelector("[data-lyrics] .lyric-line.is-active")?.textContent || "").trim().slice(0, 16) + "」");
      }

      firstFile.click();                       // stop it again
      await until(() => !sceneHost.classList.contains("is-spinning"), 4000, 150);
      ok("停下之后盘也停", !sceneHost.classList.contains("is-spinning"),
         "is-spinning=" + sceneHost.classList.contains("is-spinning"));
    }

    if (window.ATTMusic && ATTMusic.isOn()) ATTMusic.stop();
  } else if (document.querySelector('audio[src*="rap.mp3"]')) {
    ok("旧版说唱页（已退役为跳转）", true, "legacy page");
  } else {
    ok("本页无唱片播放器（跳过）", true, "N/A on this page");
  }

  /* ---------- 设计审计：把已经犯过的错变成断言 ---------- */
  /* Runs on every page, not only the ones without a player. It used to sit inside
     the else above, so the records page — which has the most text on the site —
     skipped the contrast audit, the heading check, the fixed-control overlap check
     and the cache-stamp check without saying so. A gate that silently skips a page
     is worse than no gate, because the green run is a lie. */
  {
    /* No regular expressions anywhere in here on purpose: this whole suite is a
       template literal in the host file, which swallows backslashes — a regex
       written with escaped parentheses silently becomes a different regex and
       takes the suite down with it (it happened: 12 checks instead of 102). */
    function lumOfTriplet(r, g, b, a) {
      if (a !== undefined && a === 0) return -1;
      const f = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    }
    function colorsIn(str) {
      const out = [];
      const s = String(str || "");
      const parts = s.split("rgb");
      for (let i = 1; i < parts.length; i++) {
        const seg = parts[i];
        const a = seg.indexOf("("), b = seg.indexOf(")");
        if (a < 0 || b < 0) continue;
        const nums = seg.slice(a + 1, b).split(",").map(x => parseFloat(x));
        if (nums.length >= 3 && nums.slice(0, 3).every(v => !isNaN(v))) out.push(nums);
      }
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== "#") continue;
        const hex = s.slice(i + 1, i + 7);
        if (hex.length >= 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
          out.push([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]);
        }
      }
      return out;
    }
    function lumOf(c) {
      const list = colorsIn(c);
      if (!list.length) return -1;
      const v = list[0];
      return lumOfTriplet(v[0], v[1], v[2], v.length > 3 ? v[3] : undefined);
    }
    /* A panel can be light because of a background-image gradient rather than a
       background-color — which is exactly how a bone-white plate with white text
       on it slipped past the first version of this audit. So gradients count too:
       every colour stop in the image is averaged and treated as the backdrop.
       It now returns the paint itself, not just its luminance: which element owns
       the winning background declaration, which property carried it, and the raw
       colour string. "ratio=1.69" is a number, not a lead — the colour, its
       property and the box that supplied it are what actually name the culprit. */
    /* One background layer, with its alpha kept. A translucent wash is the case
       that matters: rgba(182,224,74,0.14) over a near-black page is a dark plate,
       but reading the colour and ignoring the alpha says "bright lime", and then
       light text on it looks like a 1.18:1 failure that does not exist. Poster
       layouts are built from exactly such washes, so this is the difference
       between an audit and a coin toss. */
    function paintOf(cs) {
      const solid = colorsIn(cs.backgroundColor);
      if (solid.length) {
        const v = solid[0];
        const a = v.length > 3 ? v[3] : 1;
        if (a > 0) return { rgb: [v[0], v[1], v[2]], alpha: a, css: cs.backgroundColor, prop: "background-color" };
      }
      if (cs.backgroundImage && cs.backgroundImage !== "none") {
        const stops = colorsIn(cs.backgroundImage);
        if (stops.length) {
          const rgb = [0, 1, 2].map(i => stops.reduce((s, x) => s + x[i], 0) / stops.length);
          const a = stops.reduce((s, x) => s + (x.length > 3 ? x[3] : 1), 0) / stops.length;
          if (a > 0) return { rgb: rgb, alpha: a, css: cs.backgroundImage.slice(0, 52), prop: "background-image" };
        }
      }
      return null;
    }
    /* Collect the stack of layers from the element outward, stop at the first
       opaque one, then composite them bottom-up. That is what the eye sees. */
    function bgSource(el) {
      const stack = [];                       // nearest layer first
      let n = el;
      while (n && n !== document.documentElement) {
        const p = paintOf(getComputedStyle(n));
        if (p) { p.el = n; stack.push(p); if (p.alpha >= 0.999) break; }
        n = n.parentElement;
      }
      if (!stack.length) return { lum: 0, css: "浏览器默认（一路走到 html 都没有底）", prop: "none", el: document.documentElement };
      if (stack[stack.length - 1].alpha < 0.999) {
        stack.push({ rgb: [8, 9, 10], alpha: 1, css: "假定页底 #08090a", prop: "fallback", el: document.documentElement });
      }
      let base = stack[stack.length - 1].rgb.slice();
      for (let i = stack.length - 2; i >= 0; i--) {
        const L = stack[i];
        base = [0, 1, 2].map(k => L.rgb[k] * L.alpha + base[k] * (1 - L.alpha));
      }
      const top = stack[0];
      const over = stack.length > 1 ? " 叠在 " + stack[stack.length - 1].css : "";
      const eff = "rgb(" + base.map(v => Math.round(v)).join(", ") + ")";   // what the eye actually gets
      return { lum: lumOfTriplet(base[0], base[1], base[2]), eff: eff,
               css: top.css + (top.alpha < 0.999 ? "@" + top.alpha.toFixed(2) : "") + over,
               prop: top.prop, el: top.el };
    }
    /* A readable name for the element that owns the backdrop: tag plus a few
       classes is what a person needs to go and find the offending rule. */
    function nameOf(n) {
      if (!n || !n.tagName) return "?";
      const raw = n.className;
      const cls = typeof raw === "string" ? raw.split(" ").filter(Boolean).slice(0, 3) : [];
      return n.tagName.toLowerCase() + cls.map(c => "." + c).join("");
    }
    /* WCAG AA for real: 4.5:1 for body text, 3:1 once it is large (>=24px, or
       >=18.66px when bold). The flat 2.4 gate this used to carry is not a
       standard and it is what let small chip text sit at 1.69 and still pass. */
    function wcagNeed(cs) {
      const size = parseFloat(cs.fontSize) || 16;
      const weight = parseInt(cs.fontWeight, 10) || 400;
      return (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
    }
    const auditRoots = [...document.querySelectorAll("main h1, main h2, main h3, main p, main li, main a, main span, main button, main label")]
      .filter(el => el.offsetParent !== null && el.textContent.trim().length > 3
        && !el.closest(".hud-rail,.hud-timer,.hud-crumb,.music-pill,.bg-fx"));
    function contrastPass() {
      const all = [];
      const low = [];
      for (const el of auditRoots) {
        const cs = getComputedStyle(el);
        const fillRaw = cs.webkitTextFillColor || "";
        const colorRaw = cs.color;
        const fillSet = !!fillRaw && fillRaw !== "rgb(0, 0, 0)" && fillRaw !== colorRaw;
        const fgRaw = fillSet ? fillRaw : colorRaw;
        const who = nameOf(el);
        const snippet = el.textContent.trim().slice(0, 18);
        const fgNote = "color " + colorRaw + (fillSet ? " · -webkit-text-fill-color " + fillRaw : "");
        const L1 = lumOf(fgRaw);
        if (L1 < 0) {
          const rec = { ratio: 0, line: who + " '" + snippet + "' · " + fgNote +
            " · 透明填充：没有任何颜色可读（审计规则 2）" };
          all.push(rec);
          low.push(rec);
          continue;
        }
        const bg = bgSource(el);
        const ratio = (Math.max(L1, bg.lum) + 0.05) / (Math.min(L1, bg.lum) + 0.05);
        const need = wcagNeed(cs);
        const rec = { ratio: ratio,
          line: who + " '" + snippet + "' · fg " + fgRaw + " (" + fgNote + ")" +
                " · bg " + bg.eff + " = " + bg.css + " 由 " + bg.prop + " 提供，来自祖先 " + nameOf(bg.el) +
                " · " + ratio.toFixed(2) + ":1（需 " + need + "）" };
        all.push(rec);
        if (ratio < need) low.push(rec);
      }
      all.sort((a, b) => a.ratio - b.ratio);
      low.sort((a, b) => a.ratio - b.ratio);
      return { all: all, low: low };
    }

    /* Both themes, every time. This used to measure whichever theme happened to
       be active — which was always dark — so the light theme was never checked
       at all, and the light theme is where the unreadable text was. */
    const contrastThemeBefore = document.documentElement.getAttribute("data-theme");
    for (const auditTheme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", auditTheme);
      await wait(560);                      // the theme is a crossfade; let the colours settle
      const pass = contrastPass();
      const worst = pass.all.length ? pass.all[0].ratio.toFixed(2) + ":1" : "n/a";
      ok("审计: 文字对比度足够 · " + auditTheme, pass.low.length === 0,
         pass.low.length
           ? pass.low.length + " / " + pass.all.length + " 处不达 WCAG AA，最低 " + worst + "（明细见下）"
           : pass.all.length + " 处文字全部达到 WCAG AA，最低 " + worst);
      /* Failures first, each on its own line, with the three things needed to fix
         it: the painted foreground, the paint behind it, and the element that owns
         that paint. This is the part that used to be missing. */
      pass.low.slice(0, 8).forEach((r, i) => {
        ok("审计·对比度不达标 · " + auditTheme + " " + (i + 1), false, r.line);
      });
      if (pass.low.length > 8) ok("审计·对比度不达标（其余）· " + auditTheme, false, "另有 " + (pass.low.length - 8) + " 处未列出");
      /* Always printed, pass or fail: the three tightest pairs on the page and the
         box that owns each backdrop, so a green run still shows real colours. */
      pass.all.slice(0, 3).forEach((r, i) => {
        ok("审计·最紧的 " + (i + 1) + " 处 · " + auditTheme, true, r.line);
      });
    }
    if (contrastThemeBefore) document.documentElement.setAttribute("data-theme", contrastThemeBefore);
    else document.documentElement.removeAttribute("data-theme");
    await wait(320);

    const invisibleHeads = [...document.querySelectorAll("main h1, main h2")].filter(h => {
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      const fill = cs.webkitTextFillColor || cs.color;
      return r.height < 8 || lumOf(fill) < 0;
    }).map(h => h.tagName + " " + h.textContent.trim().slice(0, 20) + " h=" + Math.round(h.getBoundingClientRect().height));
    ok("审计: 标题可见（非透明、有高度）", invisibleHeads.length === 0, invisibleHeads.join(" | ") || "all visible");

    const fixed = [...document.querySelectorAll(".hud-crumb,.hud-rail,.hud-timer,.music-pill")]
      .filter(el => el.offsetParent !== null || getComputedStyle(el).position === "fixed")
      .map(el => ({ n: el.className.split(" ")[0], r: el.getBoundingClientRect() }))
      .filter(o => o.r.width > 0 && o.r.height > 0);
    const clashes = [];
    for (let a = 0; a < fixed.length; a++) for (let b = a + 1; b < fixed.length; b++) {
      const A = fixed[a].r, B = fixed[b].r;
      const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (ox > 4 && oy > 4) clashes.push(fixed[a].n + " × " + fixed[b].n);
    }
    ok("审计: 固定控件互不重叠", clashes.length === 0, clashes.join(", ") || fixed.length + " 个固定控件无交叠");

    const fx = document.querySelector(".bg-fx");
    if (fx) {
      const col = document.querySelector("main .container") || document.querySelector("main");
      const c = col.getBoundingClientRect();
      const mid = document.elementFromPoint(Math.round(c.left + c.width / 2), Math.round(c.top + Math.min(120, c.height / 2)));
      ok("审计: 装饰层未挡住正文", !(mid && mid.closest(".bg-fx")), mid ? mid.tagName + "." + String(mid.className).split(" ")[0] : "n/a");
    }
    const stamps = [...document.querySelectorAll("link[rel=stylesheet]")].map(l => { const h = l.getAttribute("href") || ""; const i = h.indexOf("?v="); return i < 0 ? "" : h.slice(i + 3); }).filter(Boolean);
    ok("审计: 样式表缓存戳一致", new Set(stamps).size <= 1, stamps.join(", "));
  }

  /* ---------- 角色立绘卡：点一下她打招呼 ---------- */
  /* 这一组刻意不写「元素存在」——那等于没测。立绘要断言**真的解码出来了**
     （naturalWidth > 0），加载态要断言**收敛**（骨架屏不会永远转），
     交互要断言**点完真的多了一句问候**且换了内容。 */
  const chFig = document.querySelector("[data-ch-figure]");
  if (chFig) {
    const chArt = chFig.querySelector("[data-ch-art]");
    const chPanel = document.querySelector("[data-ch-greeting]");
    const chLine = document.querySelector("[data-ch-line]");
    const chSkel = chFig.querySelector(".ch-skeleton");

    ok("角色立绘真的解码出来了", !!chArt && chArt.complete && chArt.naturalWidth > 0,
       chArt ? chArt.naturalWidth + "x" + chArt.naturalHeight + " · complete=" + chArt.complete : "没有 img");

    /* 三版立绘的切换：断言真的换了版本、真的换了画、问候语也跟着换了，
       而不是只断言「有个按钮」。Q版那张是从官方 Spine 模型渲出来的，
       所以这里按「每一版都真的解码出来了」逐一验，而不是只验第一版。 */
    const chSwitch = [...document.querySelectorAll(".ch-switch-btn")];
    const chArts = [...chFig.querySelectorAll("[data-ch-art]")];
    /* 明细里带上真正服务这张图的主机名：三张图走的是"Gitee → GitHub → 本地"
       这条回退链，不写出来就看不出到底哪一跳生效了。 */
    const chHost = (i) => { try { return new URL(i.currentSrc || i.src).host.split(".").slice(-2).join("."); } catch (e) { return "?"; } };
    ok("立绘的每一版都解码出来了", chArts.length >= 2 && chArts.every(i => i.complete && i.naturalWidth > 0),
       chArts.map(i => i.getAttribute("data-ch-art") + " " + i.naturalWidth + "x" + i.naturalHeight + " ← " + chHost(i)).join(" · "));

    if (chSwitch.length >= 2) {
      const variantNow = () => chFig.getAttribute("data-ch-variant");
      const start = variantNow();
      ok("立绘有多版可切", chSwitch.length + " 个切换按钮，当前 " + start, "当前版本 " + start);

      let switched = 0, failed = [];
      for (const btn of chSwitch) {
        const want = btn.getAttribute("data-ch-variant");
        if (want === start || btn.disabled) continue;
        const img = chFig.querySelector('[data-ch-art="' + want + '"]');
        btn.click();
        /* 交叉淡入淡出是 0.42s 的过渡：轮询到终态再断言，别用固定 sleep 赌时间。 */
        await until(() => img && parseFloat(getComputedStyle(img).opacity) > 0.98, 2500, 100);
        const shown = img ? getComputedStyle(img).opacity : "0";
        const okNow = variantNow() === want && parseFloat(shown) > 0.98 && btn.getAttribute("aria-pressed") === "true";
        if (okNow) switched++;
        else failed.push(want + "(variant=" + variantNow() + " opacity=" + shown + " pressed=" + btn.getAttribute("aria-pressed") + ")");
      }
      ok("每一版都切得过去、而且真的画出来了", failed.length === 0 && switched === chSwitch.length - 1,
         failed.length ? "没过：" + failed.join(" · ") : switched + " 版全部切换成功");

      /* 切回去，并确认有一版能切回起点 */
      const first = chSwitch.find(b => b.getAttribute("data-ch-variant") === start);
      if (first) { first.click(); await until(() => variantNow() === start, 2000, 100); }
      ok("能切回来", variantNow() === start, "回到 " + variantNow());
    }

    await until(() => chFig.classList.contains("is-ready") || chFig.classList.contains("is-missing"), 7000, 120);
    const chReady = chFig.classList.contains("is-ready");
    const chMissing = chFig.classList.contains("is-missing");
    ok("加载态会收敛（骨架屏不会一直转）", chReady || chMissing,
       chReady ? "is-ready：立绘已就位" : chMissing ? "is-missing：立绘缺席，走降级" : "卡在加载中");
    ok("就位后骨架屏已撤掉", !chReady || (chSkel && getComputedStyle(chSkel).display === "none"),
       chSkel ? "display=" + getComputedStyle(chSkel).display : "没有骨架屏");

    if (chPanel && chLine) {
      const hiddenFirst = getComputedStyle(chPanel).visibility === "hidden";
      ok("问候语默认先藏着（点击才浮现）", hiddenFirst, "visibility=" + getComputedStyle(chPanel).visibility);

      const line0 = chLine.textContent.trim();
      chFig.click();
      await wait(260);
      const shown = getComputedStyle(chPanel).visibility === "visible";
      ok("点一下就浮现问候", shown && chLine.textContent.trim().length > 4,
         shown ? "「" + chLine.textContent.trim().slice(0, 20) + "」" : "面板仍不可见");
      ok("点击后如实上报展开状态", chFig.getAttribute("aria-expanded") === "true",
         "aria-expanded=" + chFig.getAttribute("aria-expanded"));

      chFig.click();
      await wait(260);
      ok("再点换下一句", chLine.textContent.trim() !== line0 && chLine.textContent.trim().length > 4,
         "「" + chLine.textContent.trim().slice(0, 20) + "」");
    } else {
      ok("角色卡带问候面板", false, "缺少 [data-ch-greeting] 或 [data-ch-line]");
    }

    ok("页面注明了角色来源", /鹰角|Hypergryph/i.test(document.body.innerText),
       "版权与「作者喜欢的角色」声明在位");

    /* 她的主题曲：断言真的出声、真的是那一首、而且能停下。
       「按钮存在」不算数 —— 引擎没加载时按钮会被禁用，那时这条会走跳过分支。 */
    const chPlay = document.querySelector("[data-ch-play]");
    if (chPlay && !chPlay.disabled) {
      chPlay.click();
      await until(() => window.ATTMusic && window.ATTMusic.isOn(), 4000, 120);
      const nowOn = window.ATTMusic.isOn();
      ok("卡上能放她的主题曲", nowOn && window.ATTMusic.currentTrack().id === "waterline",
         nowOn ? window.ATTMusic.currentTrack().name : "点了没出声");
      chPlay.click();
      await until(() => !window.ATTMusic.isOn(), 4000, 120);
      ok("再点能停下", window.ATTMusic.isOn() === false, "playing=" + window.ATTMusic.isOn());
    } else {
      ok("卡上没有主题曲按钮（跳过）", true, "跳过");
    }
  } else {
    ok("本页无角色立绘卡", true, "跳过");
  }

  /* ---------- 歌词页：HTML 与 lyrics.js 一致性 ---------- */
  const domLines = [...document.querySelectorAll("[data-lyrics] .lyric-line")];
  if (domLines.length) {
    const domTexts = domLines.map(el => el.querySelector(".mark") ? el.textContent.replace(el.querySelector(".mark").textContent, "").trim() : el.textContent.trim());
    const srcTexts = lines.map(l => l.text.trim());
    const same = domTexts.length === srcTexts.length && domTexts.every((t, i) => t === srcTexts[i]);
    ok("歌词页与歌词源一致", same, domTexts.length + " / " + srcTexts.length + " 行" + (same ? "" : " 首个不同: " + domTexts.find((t, i) => t !== srcTexts[i])));
    const idxOk = domLines.every((el, i) => parseInt(el.getAttribute("data-line"), 10) === i);
    ok("歌词行号连续", idxOk, domLines.length + " 行");
    document.querySelector("#play-song")?.click();
    await until(() => document.querySelector(".lyric-line.is-active"), 5000);
    ok("卡拉OK高亮生效", !!document.querySelector(".lyric-line.is-active"), (document.querySelector(".lyric-line.is-active")?.textContent || "无").slice(0, 22));
    music.stop(); await wait(200);
  }

  /* ---------- 复制按钮与 Toast ---------- */
  const copy = document.querySelector("[data-copy]");
  if (copy) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    copy.click(); await wait(400);
    const toasts = [...document.querySelectorAll(".toast")];
    const last = toasts[toasts.length - 1];
    ok("复制后有 Toast 反馈", !!last && /copied/i.test(last.textContent), last ? last.textContent.slice(0, 22) : "无");
  } else {
    ok("本页无需复制按钮", true, "跳过");
  }

  /* ---------- 附件体积计 ---------- */
  const meter = document.querySelector("[data-meter]");
  if (meter) {
    meter.scrollIntoView({ block: "center" });
    await until(() => meter.querySelector(".meter-fill").style.width === "100%", 9000, 120);
    const width = meter.querySelector(".meter-fill").style.width;
    ok("体积计填满", width === "100%", width);
    ok("体积计给出 550 结论", meter.querySelector(".meter-note").textContent.includes("550 5.3.4"), meter.querySelector(".meter-note").textContent.slice(0, 34));
  } else {
    ok("本页无体积计", true, "跳过");
  }

  /* ---------- 表单 413 拦截 ---------- */
  const form = document.querySelector("[data-size-guard]");
  if (form) {
    form.scrollIntoView({ block: "center" });
    const area = form.querySelector("textarea");
    area.value = "测试".repeat(9 * 1024 * 1024);   // 约 54 MB
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(250);
    const note = form.querySelector("[data-size-note]").textContent;
    ok("超限时表单报警", note.includes("550 5.3.4") && !!form.querySelector(".field.has-error"), note.slice(0, 30));
    document.querySelectorAll(".toast").forEach(t => t.remove());
    form.querySelector("button[type=submit]").click();
    await wait(400);
    const toasts = [...document.querySelectorAll(".toast")];
    const last = toasts[toasts.length - 1];
    ok("超限时拒绝提交", !!last && last.textContent.includes("550 5.3.4"), last ? last.textContent.slice(0, 24) : "无 Toast");
    area.value = "很短的一段";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(200);
    ok("恢复正常后解除报警", !form.querySelector(".field.has-error"));
  } else {
    ok("本页无表单", true, "跳过");
  }

  /* ---------- 注册链路（只在真的连着后端时跑） ---------- */
  const regForm = document.querySelector('[data-auth="register"]');
  if (regForm && window.ATTAuth) {
    const mode = window.ATTAuth.state().mode;
    if (mode === "server") {
      const stamp = Date.now();
      regForm.querySelector('[name="name"]').value = "浏览器自检员";
      regForm.querySelector('[name="email"]').value = "e2e-" + stamp + "@example.com";
      regForm.querySelector('[name="password"]').value = "BrowserCheck-2026";
      regForm.querySelector('[name="password2"]').value = "BrowserCheck-2026";
      regForm.querySelector('input[type=checkbox]').checked = true;
      regForm.querySelector("button[type=submit]").click();
      await until(() => document.querySelector("[data-member-card] .member-card"), 6000, 150);
      const card = document.querySelector("[data-member-card] .member-card");
      const serial = card ? (card.querySelector(".member-serial")?.textContent || "").trim() : "";
      ok("浏览器内可完成真实注册", !!card && /^ATT-20MB-\d{6}$/.test(serial), serial || "没有出现会员证");
      const dir = await fetch("/api/members").then(r => r.json()).catch(() => null);
      ok("新会员出现在公开名录", !!dir && dir.members.some(m => m.serial === serial), dir ? "在册 " + dir.count + " 位" : "取不到名录");
      ok("名录里没有邮箱", !!dir && !JSON.stringify(dir).includes("@"), "无 @ 字符");
      const me = await window.ATTAuth.me();
      ok("注册后会话已建立", me.authenticated === true && me.member.serial === serial, me.member?.rank || "");
    } else {
      ok("静态模式：显示无后端提示", !!document.querySelector("[data-static-notice]") && getComputedStyle(document.querySelector("[data-static-notice]")).display !== "none", "mode=" + mode);
    }
  }

  return { results, viewport: window.innerWidth + "x" + window.innerHeight };
})()`;

/* ============================ 无 JS 可读性 ============================ */
const NOJS = `(() => {
  const hidden = [...document.querySelectorAll(".reveal")].filter(e => getComputedStyle(e).opacity !== "1").length;
  const text = document.body.innerText.replace(/\\s+/g, "");
  return {
    hiddenReveals: hidden,
    chars: text.length,
    hasTitle: text.includes(document.title.slice(0, 6)),
    hasNav: document.querySelectorAll("[data-nav-links] a").length
  };
})()`;

/* ==================== 真像素对比度：量屏幕上真正画出来的底 ====================
   为什么需要它：审计原来只沿祖先链找底色。这个站的正文底下压着一张固定定位
   的照片（z-index:-1，不是文字的祖先），于是祖先链一路走到 body 的骨白底，
   算出 16:1 报 PASS —— 而屏幕上真实的底是那张照片。浅色主题下正文因此只有
   约 1.3:1，全站读不了，审计却一路绿灯。

   所以这里不再"推算"底色，而是**拍下来**：每个视口取几个滚动位置，
   截一张图，把每个文字元素矩形内的像素取出来，剔除接近字色的像素（那些是字），
   取剩下像素的中位亮度当底色，再算对比度。照片、canvas、任何不是祖先画的底，
   都骗不过去。

   中位数为什么够用：文字在它的包围盒里是少数像素，留下来的多数像素就是底。
   若底色和字色几乎一样（真正的故障），剔除后所剩无几 —— 这时就用全部像素的
   中位数，算出来自然是很差的比值，正好是我们想要的结论。 */

/* 最小 PNG 解码：只认 8 位 RGB / RGBA，Chrome 截图就是这两种。 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let p = 8, w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = color === 6 ? 4 : color === 2 ? 3 : 0;
  if (!ch || depth !== 8) throw new Error("只支持 8 位 RGB/RGBA，收到 depth=" + depth + " color=" + color);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let off = 0;
  for (let y = 0; y < h; y++) {
    const filt = raw[off++];
    const line = Buffer.from(raw.subarray(off, off + stride));
    off += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filt === 1) v += a;
      else if (filt === 2) v += b;
      else if (filt === 3) v += (a + b) >> 1;
      else if (filt === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 0xff;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const s = x * ch, d = (y * w + x) * 4;
      out[d] = line[s];
      out[d + 1] = ch >= 3 ? line[s + 1] : line[s];
      out[d + 2] = ch >= 3 ? line[s + 2] : line[s];
      out[d + 3] = ch === 4 ? line[s + 3] : 255;
    }
  }
  return { width: w, height: h, data: out };
}

function lum255(r, g, b) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function rgbOf(s) {
  const n = String(s || "").replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",").map(Number);
  if (n.length < 3 || isNaN(n[0])) return null;
  return [n[0], n[1], n[2], (n.length > 3 && !isNaN(n[3])) ? n[3] : 1];
}

/* 入口板会盖住整屏，先摘掉；顺便把「已看过入口」记下来。
   再把动画和过渡全部停掉：本站的 .reveal 是滚动进入时 0.5 秒淡入的，截图若正好
   落在淡入途中，元素还是半透明的，量出来的底就偏暗 —— 实测一块青绿徽标被拍成
   了 60% 亮度，报出一个并不存在的 3.89:1。量像素前先把画面钉住。 */
const PIXEL_PREP = `(function () {
  try { sessionStorage.setItem("att.intro.seen", "1"); } catch (e) {}
  var p = document.querySelector(".intro");
  if (p && p.parentNode) p.parentNode.removeChild(p);
  document.documentElement.classList.remove("intro-lock");
  var quiet = document.createElement("style");
  quiet.id = "att-pixel-quiet";
  quiet.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}";
  document.head.appendChild(quiet);
  document.querySelectorAll(".reveal").forEach(function (e) { e.classList.add("is-visible"); });
  return true;
})()`;

const PIXEL_RESTORE = `(function () {
  var q = document.getElementById("att-pixel-quiet");
  if (q && q.parentNode) q.parentNode.removeChild(q);
  return true;
})()`;

const PIXEL_RESET = `document.querySelectorAll("[data-probed]").forEach(function (e) { e.removeAttribute("data-probed"); }); true;`;

/* 列出当前视口里还没量过、也没有被固定控件压住的文字元素。 */
const PIXEL_PROBE = `(function () {
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const sel = "main h1, main h2, main h3, main p, main li, main a, main span, main button, main label,"
            + " .hud-timer span, .hud-timer b, .hud-crumb, .hud-crumb span, .hud-crumb b, .hud-rail a,"
            + " .footer-bottom span, .footer-col a, .footer-col h4, .brand-text, .nav-links a, .site-footer p";
  /* 固定控件有自己的不透明面板，"文字被它压住"是版式问题、不是对比度问题，
     所以压在固定控件下的元素直接跳过，免得把噪声算成失败。 */
  const fixed = [...document.querySelectorAll(".hud-crumb,.hud-rail,.hud-timer,.music-pill,.skip-link")]
    .map(function (e) { return e.getBoundingClientRect(); })
    .filter(function (r) { return r.width > 0 && r.height > 0; });
  const lum = function (s) {
    const n = String(s || "").replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",").map(Number);
    if (n.length < 3 || isNaN(n[0])) return -1;
    if (n.length > 3 && n[3] === 0) return -1;
    const f = [n[0], n[1], n[2]].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  for (const el of document.querySelectorAll(sel)) {
    if (el.getAttribute("data-probed") === "1") continue;
    if (el.offsetParent === null) continue;
    const txt = el.textContent.trim();
    if (txt.length <= 3) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom < 2 || r.top > vh - 2 || r.right < 2 || r.left > vw - 2) continue;
    if (fixed.some(function (f) { return Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top) > 4 && Math.min(r.right, f.right) - Math.max(r.left, f.left) > 4; })) continue;
    const cs = getComputedStyle(el);
    /* visibility:hidden 的元素仍有矩形、offsetParent 也不为 null，但屏幕上没有它的
       像素。不排掉的话，采到的是它身后的底，算出一个根本不存在的一比一失败。 */
    if (cs.visibility !== "visible" || parseFloat(cs.opacity) === 0) continue;
    const fill = cs.webkitTextFillColor || "";
    const col = cs.color;
    const fg = (fill && fill !== "rgb(0, 0, 0)" && fill !== col) ? fill : col;
    const L = lum(fg);
    if (L < 0) continue;
    const size = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    el.setAttribute("data-probed", "1");
    const raw = el.className;
    const cls = typeof raw === "string" ? raw.split(" ").filter(Boolean).slice(0, 2) : [];
    out.push({
      who: el.tagName.toLowerCase() + cls.map(function (c) { return "." + c; }).join(""),
      txt: txt.slice(0, 16), fg: fg, L: L,
      need: (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5,
      vw: vw, vh: vh,
      x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)),
      w: Math.round(Math.min(r.right, vw) - Math.max(r.left, 0)),
      h: Math.round(Math.min(r.bottom, vh) - Math.max(r.top, 0))
    });
  }
  return out;
})()`;

async function pixelContrast(cdp, isMobile) {
  const rows = [];
  const themeBefore = await cdp.send("Runtime.evaluate", {
    expression: `document.documentElement.getAttribute("data-theme") || ""`, returnByValue: true
  });
  const restore = themeBefore.result.value;
  const fractions = isMobile ? [0, 0.5] : [0, 0.34, 0.68];

  const all = {};
  let shotDims = "";
  /* style.css 里是 html { scroll-behavior: smooth }。不关掉它，window.scrollTo
     会花几百毫秒慢慢滚，于是"取矩形"和"截图"落在两个不同的滚动位置上，
     量出来的底全是错的（实测表现为一片 1.00:1 的假失败）。 */
  await cdp.send("Runtime.evaluate", { expression: `document.documentElement.style.scrollBehavior = "auto"; true;` });
  for (const theme of ["dark", "light"]) {
    await cdp.send("Runtime.evaluate", { expression: `document.documentElement.setAttribute("data-theme", "${theme}"); true;` });
    await cdp.send("Runtime.evaluate", { expression: PIXEL_RESET });
    await sleep(560);
    all[theme] = [];
    for (const f of fractions) {
      await cdp.send("Runtime.evaluate", {
        expression: `window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * ${f})); true;`
      });
      await sleep(280);
      const probe = await cdp.send("Runtime.evaluate", { expression: PIXEL_PROBE, returnByValue: true });
      const items = (probe.result && probe.result.value) || [];
      if (!items.length) continue;
      let shot;
      try {
        shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      } catch (e) { continue; }
      let img;
      try { img = decodePng(Buffer.from(shot.data, "base64")); } catch (e) { continue; }
      if (!shotDims && items[0]) shotDims = img.width + "x" + img.height + " 截图像素 / 视口 " + items[0].vw + "x" + items[0].vh;

      for (const it of items) {
        const fgRgb = rgbOf(it.fg);
        if (!fgRgb) continue;
        /* 手机模拟下截图可能是被缩放过的（页面缩放因子），所以一律按
           「截图尺寸 / 布局视口」换算坐标，不能假设 1:1 —— 之前就是这么错位的。 */
        const sx = it.vw ? img.width / it.vw : 1;
        const sy = it.vh ? img.height / it.vh : 1;
        const x0 = Math.max(0, Math.round(it.x * sx)), x1 = Math.min(img.width, Math.round((it.x + it.w) * sx));
        const y0 = Math.max(0, Math.round(it.y * sy)), y1 = Math.min(img.height, Math.round((it.y + it.h) * sy));
        if (x1 - x0 < 3 || y1 - y0 < 3) continue;
        const stepX = Math.max(1, Math.round(sx)), stepY = Math.max(1, Math.round(sy));
        const vals = [];
        for (let y = y0; y < y1; y += stepY) {
          for (let x = x0; x < x1; x += stepX) {
            const i = (y * img.width + x) * 4;
            const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
            const d = Math.abs(r - fgRgb[0]) + Math.abs(g - fgRgb[1]) + Math.abs(b - fgRgb[2]);
            vals.push({ L: lum255(r, g, b), r: r, g: g, b: b, glyph: d < 90 });
          }
        }
        if (vals.length < 6) continue;
        const clean = vals.filter((v) => !v.glyph);
        const use = clean.length >= vals.length * 0.2 ? clean : vals;
        use.sort((a, b) => a.L - b.L);
        const mid = use[Math.floor(use.length / 2)];
        /* 半透明字色（本站到处在用 rgba 的 --hud-dim）在屏幕上并不是它自己，
           而是「它压在底上」的结果。不合成这一层，算出来的对比度会凭空偏高。 */
        const alpha = fgRgb[3];
        const effFg = alpha >= 0.999 ? [fgRgb[0], fgRgb[1], fgRgb[2]]
          : [0, 1, 2].map((k) => fgRgb[k] * alpha + mid[k] * (1 - alpha));
        const fgL = lum255(effFg[0], effFg[1], effFg[2]);
        const ratio = (Math.max(fgL, mid.L) + 0.05) / (Math.min(fgL, mid.L) + 0.05);
        all[theme].push({ ratio: ratio, need: it.need, theme: theme,
          line: it.who + " '" + it.txt + "' · fg " + it.fg + (alpha < 0.999 ? "（半透明，合成后 rgb(" + effFg.map((v) => Math.round(v)).join(", ") + ")" : "") +
                " · 实测底 rgb(" + mid.r + ", " + mid.g + ", " + mid.b + ") L=" + mid.L.toFixed(3) +
                " → " + ratio.toFixed(2) + ":1（需 " + it.need + "）" });
      }
    }
  }
  if (restore) await cdp.send("Runtime.evaluate", { expression: `document.documentElement.setAttribute("data-theme", "${restore}"); true;` });
  await cdp.send("Runtime.evaluate", { expression: `window.scrollTo(0, 0); document.documentElement.style.scrollBehavior = ""; true;` });
  await cdp.send("Runtime.evaluate", { expression: PIXEL_RESTORE });

  for (const theme of ["dark", "light"]) {
    const list = all[theme].sort((a, b) => a.ratio - b.ratio);
    const low = list.filter((r) => r.ratio < r.need);
    const worstTxt = list.length ? list[0].ratio.toFixed(2) + ":1" : "n/a";
    rows.push({ name: "审计: 实测像素对比度 · " + theme, pass: low.length === 0,
      detail: (low.length ? low.length + " / " + list.length + " 处真实底色不达标，最低 " + worstTxt
                          : list.length + " 处（按屏幕像素实测）全部达标，最低 " + worstTxt) +
              (list.length ? " · " + shotDims : "（本页没采到样本）") });
    low.slice(0, 6).forEach((r) => rows.push({ name: "审计·实测像素不达标 · " + theme, pass: false, detail: r.line }));
  }
  return rows;
}

/* ============================ 执行 ============================ */
const allRows = [];
let total = 0, failed = 0;

async function run() {
  const target = await pageTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable").catch(() => {});

  for (const file of pages) {
    // file 可以是相对文件名，也可以是 http(s):// 地址（用来验证真正的服务器）
    const url = /^https?:\/\//i.test(file) ? file : pathToFileURL(join(rootDir, file)).href;
    for (const size of [
      { w: 1360, h: 900, mobile: false, label: "桌面 1360x900" },
      { w: 390, h: 780, mobile: true, label: "移动 390x780" }
    ]) {
      const errors = [];
      const collect = (msg) => {
        if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
        if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(msg.params.entry.text);
      };
      cdp.on(collect);

      await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.mobile });
      await cdp.send("Page.navigate", { url });
      await sleep(2400);

      /* 真像素对比度放在页面内断言之前跑：这时候页面还是原样的 ——
         没有被表单灌进 54 MB 文字、没有残留 Toast、没有滚来滚去。 */
      await cdp.send("Runtime.evaluate", { expression: PIXEL_PREP, returnByValue: true });
      await sleep(320);
      const pixelRows = await pixelContrast(cdp, size.mobile);

      const out = await cdp.send("Runtime.evaluate", { expression: SUITE, awaitPromise: true, returnByValue: true });
      const rows = [];
      if (out.exceptionDetails) {
        rows.push({ name: "页面内断言执行", pass: false, detail: (out.exceptionDetails.exception?.description || "异常").split("\n")[0].slice(0, 80) });
      } else {
        rows.push(...out.result.value.results);
      }
      rows.push({ name: "无未捕获 JS 异常", pass: errors.length === 0, detail: errors.length ? errors[0].split("\n")[0].slice(0, 66) : "0 个" });
      rows.push(...pixelRows);

      console.log(`\n=== ${file} · ${size.label} · 实测视口 ${out.result.value?.viewport ?? "?"} ===`);
      for (const row of rows) {
        total++;
        if (!row.pass) failed++;
        console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name.padEnd(22)} ${row.detail}`);
      }
      allRows.push({ file, label: size.label, rows });
    }
  }

  /* 无 JS 回退：禁用脚本后再看一次首屏 */
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: pathToFileURL(join(rootDir, "index.html")).href });
  await sleep(1500);
  const nojs = await cdp.send("Runtime.evaluate", { expression: NOJS, returnByValue: true });
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
  const n = nojs.result.value || {};
  console.log("\n=== 无 JavaScript 回退（index.html）===");
  const noJsRows = [
    { name: "内容默认可见", pass: n.hiddenReveals === 0, detail: (n.hiddenReveals ?? "?") + " 个透明区块" },
    { name: "正文有实际文本", pass: (n.chars || 0) > 1200, detail: (n.chars || 0) + " 字" },
    { name: "导航仍然渲染", pass: (n.hasNav || 0) >= 6, detail: (n.hasNav || 0) + " 个链接" }
  ];
  for (const row of noJsRows) {
    total++;
    if (!row.pass) failed++;
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name.padEnd(22)} ${row.detail}`);
  }

  /* 「永久静音」URL 参数：?sound=off 必须在加载时就把声音关死 */
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: pathToFileURL(join(rootDir, "index.html")).href + "?sound=off" });
  await sleep(1800);
  const muted = await cdp.send("Runtime.evaluate", {
    expression: `({ muted: window.ATTMusic ? ATTMusic.isMuted() : null,
                    startBlocked: window.ATTMusic ? ATTMusic.start() === false : null,
                    playing: window.ATTMusic ? ATTMusic.isOn() : null,
                    voice: window.ATTMusic ? ATTMusic.voiceOn() : null,
                    label: document.querySelector('[data-music-status]')?.textContent || '' })`,
    returnByValue: true
  });
  const m = muted.result.value || {};
  console.log("\n=== ?sound=off 永久静音 ===");
  const muteRows = [
    { name: "加载即处于静音", pass: m.muted === true, detail: String(m.muted) },
    { name: "start() 被拒绝", pass: m.startBlocked === true, detail: String(m.startBlocked) },
    { name: "没有在播放", pass: m.playing === false, detail: "playing=" + m.playing },
    { name: "人声也是关的", pass: m.voice === false, detail: "voice=" + m.voice },
    { name: "界面如实说明", pass: /sound off/i.test(m.label), detail: m.label.slice(0, 40) }
  ];
  for (const row of muteRows) {
    total++;
    if (!row.pass) failed++;
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name.padEnd(22)} ${row.detail}`);
  }

  cdp.close();
}

try {
  await run();
} catch (e) {
  console.error("自检失败：", e.message);
  failed++;
} finally {
  edge.kill();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 偶尔占用 */ }
}

console.log(`\n共 ${total} 项检查，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
