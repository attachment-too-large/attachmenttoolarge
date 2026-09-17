/* ==========================================================================
   角色立绘卡：两版立绘可切换，点一下她打招呼（character.js）
   —— 只由 index.html 加载

   做五件事：
     1. 立绘解码完成 → 给卡加 is-ready，骨架屏撤掉、卷帘抽走；
     2. 立绘既 load 也 error 不了（解码卡住）→ 5 秒后按「缺席」处理，
        绝不让骨架屏永远转下去；
     3. 立绘缺席（图没随仓库分发）→ 加 is-missing，显示说明块，不留破图；
        半身像单独缺席时，只把那一个切换按钮禁用，不影响全身；
     4. 切换：data-ch-variant 决定哪一版出场，两版是靠 CSS 交叉淡入淡出的，
        所以这里只改属性、并如实更新 aria-pressed；
     5. 点击 → 浮现问候，再点换下一句。两版有各自的问候语，
        因为「凑近看」和「全身站着」本来就该说不一样的话。

   为什么问候语写在这里、而不是服务端：这是纯前端静态站，且文案要跟角色口吻一致，
   放在一处比散在 HTML 里好改。HTML 里预置了第一句，所以禁用 JS 时也读得到。
   ========================================================================== */
(function () {
  "use strict";

  var figure = document.querySelector("[data-ch-figure]");
  if (!figure) return;

  var panel = document.querySelector("[data-ch-greeting]");
  var hint = figure.querySelector("[data-ch-hint]");
  var lineEl = panel && panel.querySelector("[data-ch-line]");
  var enEl = panel && panel.querySelector("[data-ch-line-en]");
  var artFull = figure.querySelector('[data-ch-art="full"]');

  /* 缪尔赛思：莱茵生命的生态学家，「水」做的精灵，习惯管人叫博士。
     下面是同人性质的问候，不是官方台词。 */
  var LINES = {
    full: [
      { zh: "博士，又在盯着一封 24.7 MB 的邮件发呆？",
        en: "Doctor — staring at a 24.7 MB mail again?" },
      { zh: "塞不下就别硬塞了，我从水管里帮你绕过去。反正我本来就不是人。",
        en: "If it won't fit, stop forcing it. I'll route it through the water — I'm not human anyway." },
      { zh: "20 MB 的墓碑……挺好看的。要不要我给你浇点水？",
        en: "A headstone for 20 MB. It's rather handsome. Shall I water it for you?" }
    ],
    bust: [
      { zh: "凑这么近干嘛？我又不会从屏幕里泼你一身水。",
        en: "Why so close? I'm not going to splash you through the screen." },
      { zh: "半身像也是我。只是构图更近，别当成另一个人。",
        en: "The bust is still me — just a closer crop. Don't count me twice." },
      { zh: "看够了就点回去，全身那版还站得好好的。",
        en: "When you're done, switch back. The full-length one is still standing." }
    ],
    chibi: [
      { zh: "小一号也是我。图纸还是要看的，20 MB 那条线得有人守着。",
        en: "Smaller is still me. The blueprint still needs reading — someone has to watch that 20 MB line." },
      { zh: "别捏。我这是战斗小人，不是挂件。",
        en: "Don't poke. I'm a battle sprite, not a keychain." },
      { zh: "莱茵生命生态科，缪尔赛思。要签名的话……等我先把这页看完。",
        en: "Ecology, Rhine Lab — Muelsyse. If you want an autograph, let me finish this page first." }
    ]
  };

  var variant = "full";
  var idx = 0;

  function markReady() { figure.classList.add("is-ready"); }
  function markMissing() { figure.classList.add("is-missing"); }
  function settled() {
    return figure.classList.contains("is-ready") || figure.classList.contains("is-missing");
  }

  /* 三张图都挂在 release 附件里（不入库：那是别人的美术）。
     取不到就退回同名的本地路径 —— 本地带着文件跑的时候不该依赖网络；
     两条路都断了才认输。
     顺序很要紧：**先试本地、再判缺席**。若第一次失败就把卡钉成 is-missing，
     后面换上本地路径也救不回来 —— 那个类是终态，.ch-art 会被 display:none。
     注意 wireArt 必须声明在这一层：函数声明在块里是块级作用域，
     放进下面的 if 里，后面那个 forEach 就取不到了。 */
  function wireArt(img, onReady, onGiveUp) {
    var triedLocal = false;
    img.addEventListener("load", function () {
      if (img.naturalWidth > 0 && onReady) onReady();
    });
    img.addEventListener("error", function () {
      var local = img.getAttribute("data-ch-local");
      if (!triedLocal && local && img.getAttribute("src") !== local) {
        triedLocal = true;
        img.setAttribute("src", local);
        return;
      }
      if (onGiveUp) onGiveUp();
    });
  }

  if (artFull) {
    wireArt(artFull, markReady, markMissing);
    /* 命中的缓存不会再触发 load，所以手动判一次 */
    if (artFull.complete && artFull.naturalWidth > 0) markReady();
    /* 兜底：远程与本地都迟迟不给结果时，别让骨架屏一直转。
       给足 9 秒 —— 要留出「远程失败、再试本地」这一轮的时间。 */
    window.setTimeout(function () {
      if (settled()) return;
      if (artFull.naturalWidth > 0) markReady(); else markMissing();
    }, 9000);
  }

  /* 某一版缺席时只禁用那一个按钮：一张图没有，不该把整张卡判死。
     三版一视同仁，加第四版也不用改这里。 */
  figure.querySelectorAll("[data-ch-art]").forEach(function (img) {
    var which = img.getAttribute("data-ch-art");
    if (which === "full") return;                       // 主图由上面的 is-ready / is-missing 负责
    wireArt(img, null, function () {
      var btn = document.querySelector('[data-ch-variant="' + which + '"]');
      if (btn) { btn.disabled = true; btn.setAttribute("title", which + " 取不到（release 与本地都没有）"); }
    });
  });

  /* 重放一次入场动画：先摘掉类、强制回流、再加回去。 */
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function say() {
    if (!panel || !lineEl) return;
    var first = !panel.classList.contains("is-open");

    if (first) {
      panel.classList.add("is-open");
      idx = 0;
      figure.setAttribute("aria-expanded", "true");
      if (hint) hint.textContent = "再说一句 · Say something else";
    } else {
      idx = (idx + 1) % LINES[variant].length;
    }

    var line = LINES[variant][idx];
    lineEl.textContent = line.zh;
    replay(lineEl, "is-saying");
    if (enEl) { enEl.textContent = line.en; replay(enEl, "is-saying"); }
    replay(figure, "is-greeting");
  }

  figure.addEventListener("click", say);

  /* ---------- 切换两版立绘 ---------- */
  function setVariant(next) {
    if (!LINES[next]) return;
    variant = next;
    figure.setAttribute("data-ch-variant", next);
    document.querySelectorAll("[data-ch-variant]").forEach(function (b) {
      if (b === figure) return;
      var on = b.getAttribute("data-ch-variant") === next;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    /* 问候面板已经开着的话，立刻换成这一版的话，别让上一版的话挂着。 */
    if (panel && panel.classList.contains("is-open") && LINES[next][0]) {
      idx = 0;
      if (lineEl) { lineEl.textContent = LINES[next][0].zh; replay(lineEl, "is-saying"); }
      if (enEl) { enEl.textContent = LINES[next][0].en; replay(enEl, "is-saying"); }
    }
  }

  document.querySelectorAll(".ch-switch-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      setVariant(btn.getAttribute("data-ch-variant"));
    });
  });

  /* ---------- 她的主题曲：Through the Water Line ----------
     播放/停止交给站内的音乐引擎（music.js），这里只做开关与状态显示。
     引擎不在（没加载 music.js）时按钮直接禁用，不留一个按下去没反应的控件。 */
  var playBtn = document.querySelector("[data-ch-play]");
  if (playBtn) {
    if (!window.ATTMusic || typeof window.ATTMusic.selectTrack !== "function") {
      playBtn.disabled = true;
    } else {
      var syncPlay = function (on) {
        playBtn.classList.toggle("is-on", !!on);
        playBtn.setAttribute("aria-pressed", on ? "true" : "false");
        playBtn.textContent = on ? "■ 停止 · Stop her theme" : "♪ 她的主题曲 · Through the Water Line";
      };
      playBtn.addEventListener("click", function () {
        var music = window.ATTMusic;
        if (music.isOn() && music.currentTrack().id === "waterline") {
          music.stop();
          syncPlay(false);
        } else {
          music.selectTrack("waterline");
          music.start();
          syncPlay(true);
        }
      });
      /* 别的地方把音乐停了（播放器胶囊、紧急静音）→ 按钮也要跟着复位 */
      document.addEventListener("click", function () {
        window.setTimeout(function () {
          syncPlay(window.ATTMusic.isOn() && window.ATTMusic.currentTrack().id === "waterline");
        }, 0);
      });
    }
  }

  /* 键盘可达：按钮本身已经能回车／空格触发，这里只是把焦点样式也接到 is-greeting 上 */
  figure.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      say();
    }
  });
})();
