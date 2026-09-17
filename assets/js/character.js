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

  /* 以下全部是**官方语音记录里的原话**（中/英文本取自 PRTS 的「缪尔赛思/语音记录」），
     不是我自己编的。第一版是我写的同人台词，里面有一句「反正我本来就不是人」——
     那句是错的：她是精灵，是萨米来的一个种族，不是「非人」；她自己也从不这么说。
     宁可去查原话，也不要替角色发明她的立场。 */
  var LINES = {
    /* 全身立绘：日常、关心、记得过去 */
    full: [
      { zh: "在你开始工作前，我们聊会天吧。",
        en: "Hiya! How about a little chat before you get to work?" },
      { zh: "嘴唇是不是有些干？……好像还有些脱皮了，平常一定要多喝水啊。",
        en: "Are your lips kind of dry there...? Yeah, they look a little chapped. You need more water on the regular." },
      { zh: "你还记得罗德岛刚刚成立的时候吗，博士？记不得？没事的，时间一长，你总会想起来。",
        en: "Do you still remember when Rhodes Island was new on its feet? No? That's fine, you'll remember with enough time." }
    ],
    /* 半身像：凑近、触碰、递东西给你 */
    bust: [
      { zh: "我的润唇膏给你吧，之后买一支还给我就行。我只用这个牌子的，薄荷味，可别买错了，好吗？",
        en: "You can have my chapstick, and then we're even again once you buy me a new stick. This is the only brand I use, and it's gotta be peppermint flavor. Don't get the wrong one. Okay?" },
      { zh: "呼，至少还有你能触碰我。",
        en: "At least I can still feel your touch." },
      { zh: "如果还有事情在困扰着你，就先把它丢到一旁吧，来尝尝这个“橙味风暴”。",
        en: "If anything's bothering you, put it to one side for now. Here, try this out, 'Orange Storm'." }
    ],
    /* Q版小人：她上了战场、也过生日的那一面 */
    chibi: [
      { zh: "好好装修一下，一定能变得很舒适。",
        en: "Let's really decorate this place. It'll be cozy in no time, promise." },
      { zh: "幻象引开他们了，我们走这边吧。",
        en: "I got my mirages to lead them off. We'll go this way." },
      { zh: "嗯？嗯……没什么，只是在想刚刚诞生的你大概会是什么模样。",
        en: "Hm? Mm... nothing, I'm just imagining what you might've been like when you were born." }
    ]
  };

  var variant = "full";
  var idx = 0;

  function markReady() { figure.classList.add("is-ready"); }
  function markMissing() { figure.classList.add("is-missing"); }
  function settled() {
    return figure.classList.contains("is-ready") || figure.classList.contains("is-missing");
  }

  /* 三张图不入库（那是鹰角的美术），按顺序试三个地址：
       1. Gitee 的 release 附件 —— 国内直连，而且返回的是正确的 image/png
       2. GitHub 的 release 附件 —— 国外网络更顺，但会跳 objects CDN
       3. 本地 assets/img/ 下的同名文件 —— 带着文件跑的时候不该依赖网络
     前两个是彼此的备份：一台 CDN 不通，图还在。
     顺序很要紧：**先试完所有地址、再判缺席**。is-missing 是终态，
     提前打上去，后面换地址也救不回来 —— .ch-art 会被 display:none。 */
  function wireArt(img, onReady, onGiveUp) {
    var queue = (img.getAttribute("data-ch-alt") || "").split(/\s+/).filter(Boolean);
    var next = 0;
    img.addEventListener("load", function () {
      if (img.naturalWidth > 0 && onReady) onReady();
    });
    img.addEventListener("error", function () {
      if (next < queue.length) { img.setAttribute("src", queue[next++]); return; }
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
