/* ==========================================================================
   页面截图（CDP 驱动，零依赖）—— 给「逐页截图，人眼过一遍深浅两种主题」用

   用法：
     node tools/shot.mjs poster.html preview/poster-light.png light
     node tools/shot.mjs poster.html preview/poster-dark.png  dark 390 780

   参数：<页面> [输出文件] [主题 dark|light|原样] [宽] [高] [viewport|full] [截图前要跑的 JS]

   第 7 个参数写 viewport 就只抓首屏，否则抓整页。
   第 8 个参数是一段 JS，用来把交互态摆好再拍（比如先点一下角色立绘）—— 
   否则拍到的永远只是初始态，而「点开之后长什么样」恰恰是最需要人眼过一遍的。

   为什么不用 msedge --screenshot：那个开关没法在执行前设定 data-theme，
   也拆不掉入口那块挡住整屏的 .intro 板。这里走 DevTools 协议，两件事都能做，
   另外用 captureBeyondViewport 抓整页而不只是首屏。
   ========================================================================== */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome"
];
const EDGE = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!EDGE) { console.error("找不到 Edge/Chrome"); process.exit(2); }

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

const page = process.argv[2] || "index.html";
const out = process.argv[3] || join("preview", page.replace(/\.html$/, "") + "-shot.png");
const theme = process.argv[4] || "light";
const width = parseInt(process.argv[5] || "1360", 10);
const height = parseInt(process.argv[6] || "900", 10);

const port = 9333 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), "att-shot-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--force-device-scale-factor=1",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" });

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p) return p;
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
    ws.addEventListener("open", () => res({
      send(method, params) {
        return new Promise((ok, no) => {
          const mid = ++id;
          pending.set(mid, { ok, no });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close: () => ws.close()
    }));
    ws.addEventListener("error", rej);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
      }
    });
  });
}

async function run() {
  const t = await target();
  const cdp = await connect(t.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  /* 既收本地文件名，也收 http(s):// 地址 —— 推送之后要抓线上复验，
     那条规矩（DESIGN-SKILL §四.5）没有截图工具配合就做不成。 */
  const navUrl = /^https?:\/\//i.test(page) ? page : pathToFileURL(join(rootDir, page)).href;
  await cdp.send("Page.navigate", { url: navUrl });
  await sleep(2600);

  /* 入口板会挡住整屏，主题也要在截图前定死。 */
  await cdp.send("Runtime.evaluate", {
    expression: `(function () {
      try { sessionStorage.setItem("att.intro.seen", "1"); } catch (e) {}
      var plate = document.querySelector(".intro");
      if (plate && plate.parentNode) plate.parentNode.removeChild(plate);
      document.documentElement.classList.remove("intro-lock");
      ${theme === "dark" || theme === "light"
        ? `document.documentElement.setAttribute("data-theme", "${theme}");`
        : ""}
      return document.documentElement.getAttribute("data-theme");
    })()`,
    returnByValue: true
  });
  await sleep(900);

  /* 等图片真的到齐再截。外站的立绘有 1.6 MB，固定等 900 ms 会截到骨架屏 ——
     截出来是"我没看到角色"，其实是图还在路上，白白让人以为坏了。 */
  for (let i = 0; i < 20; i++) {
    const pending = await cdp.send("Runtime.evaluate", {
      expression: `[...document.images].filter(function (i) { return !i.complete; }).length`,
      returnByValue: true
    });
    if (!pending.result.value) break;
    await sleep(500);
  }

  /* 截图前先跑一段 JS，用来把交互态摆好（第 8 个参数）。 */
  const before = process.argv[8];
  if (before) {
    try {
      await cdp.send("Runtime.evaluate", { expression: before, returnByValue: true });
      await sleep(800);
    } catch (e) {
      console.error("截图前的 JS 报错（继续截图）：", e.message);
    }
  }

  const metrics = await cdp.send("Page.getLayoutMetrics");
  const cs = metrics.cssContentSize || metrics.contentSize;
  const viewportOnly = process.argv[7] === "viewport";
  const shot = await cdp.send("Page.captureScreenshot", viewportOnly
    ? { format: "png" }
    : {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(cs.height), scale: 1 }
      });

  const dest = resolve(rootDir, out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(shot.data, "base64"));
  console.log(`${page} · ${theme} · ${width}x${height} -> ${out}  (${Math.ceil(cs.width)}x${Math.ceil(cs.height)})`);
  cdp.close();
}

try {
  await run();
} catch (e) {
  console.error("截图失败：", e.message);
  process.exitCode = 1;
} finally {
  edge.kill();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 偶发占用 */ }
}
