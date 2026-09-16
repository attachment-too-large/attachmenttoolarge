/* ==========================================================================
   升静态资源缓存戳（?v=…）—— 自证没有改坏编码

   用法：
     node tools/bump-asset-stamp.mjs 20260916b          # 全站升到新戳
     node tools/bump-asset-stamp.mjs 20260916b --dry    # 只看会改什么

   为什么需要这个脚本：DESIGN-SKILL 的规矩 1 要求「每次改 CSS／图片必须同时升
   ?v=」。手动升戳踩过一次真实的坑——用 PowerShell 的 Get-Content -Raw 读、
   WriteAllText 写，会把 UTF-8 当成 ANSI 往返一次：中文和符号全变成乱码，
   而且 GBK 双字节序列会**吞掉紧跟其后的 ASCII 字符**（`◈<` 里的 `<` 就这么没了），
   于是 404／join／register 三个页面的内联脚本直接语法错误、审核报
   "TypeError: Cannot read properties of undefined"。

   所以这个脚本只做一件事，但每写一个文件都必须通过两道自检：
     1. 读进来的字节必须是合法 UTF-8（否则立刻中止，不写）；
     2. 所有非 ASCII 码点在替换前后必须**逐个一致**（只许 ASCII 的版本号变）。
   任何一条不过，文件保持原样并报错退出。
   ========================================================================== */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const next = process.argv[2];
const dry = process.argv.includes("--dry");

if (!next || !/^[0-9A-Za-z._-]+$/.test(next)) {
  console.error("用法：node tools/bump-asset-stamp.mjs <新版本戳> [--dry]");
  console.error("版本戳只允许字母、数字、点、下划线、连字符（会写进 URL 查询串）");
  process.exit(2);
}

/* 严格 UTF-8 解码器：遇到非法字节直接抛错，而不是悄悄塞进 U+FFFD。
   这正是上一次事故里缺掉的那道闸。 */
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

function nonAscii(text) {
  const out = [];
  for (const ch of text) if (ch.codePointAt(0) > 127) out.push(ch);
  return out;
}

const files = readdirSync(rootDir).filter((f) => f.endsWith(".html")).sort();
const stampRe = /\?v=([0-9A-Za-z._-]+)/g;

let changed = 0, touched = 0, skipped = 0, failed = 0;

for (const file of files) {
  const path = join(rootDir, file);
  if (!existsSync(path)) continue;

  const bytes = readFileSync(path);
  let text;
  try {
    text = fatalUtf8.decode(bytes);
  } catch (e) {
    console.error(`  ✗ ${file}：不是合法 UTF-8，已跳过（${e.message}）`);
    failed++;
    continue;
  }

  const stamps = [...new Set([...text.matchAll(stampRe)].map((m) => m[1]))];
  if (!stamps.length) { skipped++; continue; }
  if (stamps.length === 1 && stamps[0] === next) { skipped++; continue; }

  const updated = text.replace(stampRe, `?v=${next}`);

  /* 自检：除了 ?v= 后的版本号，一个非 ASCII 字符都不许动。 */
  const before = nonAscii(text).join("");
  const after = nonAscii(updated).join("");
  if (before !== after) {
    console.error(`  ✗ ${file}：非 ASCII 字符被改动了，拒绝写入`);
    failed++;
    continue;
  }
  if (updated.length === text.length && updated === text) { skipped++; continue; }

  const hits = [...text.matchAll(stampRe)].length;
  console.log(`  ${dry ? "·" : "✓"} ${file.padEnd(20)} ${hits} 处  ${stamps.join(", ")} -> ${next}`);
  if (!dry) writeFileSync(path, updated, "utf8");
  changed += hits;
  touched++;
}

console.log(`\n${dry ? "（演练，未写入）" : "已写入"} ${touched} 个文件、${changed} 处缓存戳；跳过 ${skipped} 个，失败 ${failed} 个`);
process.exit(failed ? 1 : 0);
