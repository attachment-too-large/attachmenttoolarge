/* ==========================================================================
   UNDERSTUDY — 房间里不该有的两样东西（uncanny.js）
   --------------------------------------------------------------------------
   一、书架缝里的眼睛
       书与书之间有一道缝。缝里有一只眼睛。它会眨、会跟着你的鼠标转，
       而**当鼠标靠近它时它会缩回黑暗里** —— 五秒后再自己探出来。
       这是全作唯一一个会"回应你"的东西，所以它必须几乎不动。

   二、窗外的黑影（画在 rain.js 的雾里，这里只负责让游戏逻辑指挥它）
       你翻开任何一件东西（"看别处"）的时候，它就不见了。
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------- 一、眼睛 ---------------- */
  var slot = document.querySelector("[data-eye]");
  var eye = slot && slot.querySelector(".eye");
  var iris = eye && eye.querySelector("i");

  var E = { open: true, hiding: false, nextBlink: 2 + Math.random() * 4, hideUntil: 0, look: { x: 0, y: 0 } };

  function blink() {
    if (!slot || E.hiding) return;
    slot.classList.add("is-shut");
    setTimeout(function () { slot.classList.remove("is-shut"); }, 110);
  }

  function tick(now) {
    if (!slot) return;
    if (!E.hiding && now > E.nextBlink) { blink(); E.nextBlink = now + 2.5 + Math.random() * 5; }
    if (E.hiding && now > E.hideUntil) {
      E.hiding = false;
      slot.classList.remove("is-hiding");
      slot.classList.remove("is-shut");
      /* 探出来之前先眨两下，像刚醒 */
      setTimeout(blink, 260); setTimeout(blink, 620);
    }
    requestAnimationFrame(tick);
  }

  document.addEventListener("mousemove", function (e) {
    if (!eye || !slot || E.hiding) return;
    var r = eye.getBoundingClientRect();
    if (!r.width) return;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = e.clientX - cx, dy = e.clientY - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);

    /* 靠得太近：缩回黑暗里 */
    if (dist < 64) {
      E.hiding = true;
      E.hideUntil = performance.now() + 4200 + Math.random() * 2600;
      slot.classList.add("is-hiding");
      return;
    }
    /* 否则眼球跟着你转（幅度很小 —— 眼睛没有整个转过来的道理） */
    var k = Math.min(1, 220 / Math.max(dist, 1));
    E.look.x = Math.max(-2.1, Math.min(2.1, (dx / Math.max(dist, 1)) * 2.1 * (1 - k * 0.35)));
    E.look.y = Math.max(-1.4, Math.min(1.4, (dy / Math.max(dist, 1)) * 1.4 * (1 - k * 0.35)));
    iris.style.transform = "translate(" + E.look.x.toFixed(2) + "px," + E.look.y.toFixed(2) + "px)";
  });

  requestAnimationFrame(tick);

  /* 测试用：一个能直接问的状态 */
  window.__undEye = {
    state: function () {
      if (!slot) return null;
      return { present: true, hiding: E.hiding, shut: slot.classList.contains("is-shut"),
               look: { x: Math.round(E.look.x * 100) / 100, y: Math.round(E.look.y * 100) / 100 },
               rect: (function () { var r = eye.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; })() };
    },
    forceLook: function (px, py) { iris.style.transform = "translate(" + px + "px," + py + "px)"; E.look.x = px; E.look.y = py; },
    forceHide: function (on) {
      E.hiding = !!on;
      slot.classList.toggle("is-hiding", !!on);
      /* 隐藏时必须同时把"什么时候回来"推到远远的未来 ——
         只设 hiding 的话，下一帧 tick 就会因为它已经过期而把它放回来。 */
      E.hideUntil = on ? (performance.now() + 600000) : 0;
      if (!on) slot.classList.remove("is-shut");
    }
  };

  /* ---------------- 二、它在的时候，音乐要换 ---------------- */
  /* 黑影按自己的节奏出现。它出现时环境音乐换成 Someone at the Gate ——
     一首专门为"窗外有东西"写的曲子；它走了再换回来。 */
  (function watchFigure() {
    if (!window.__undFigure) { setTimeout(watchFigure, 800); return; }
    var on = false;
    setInterval(function () {
      var st = window.__undFigure.state();
      var now = st.alpha > 0.35;
      if (now !== on) {
        on = now;
        document.dispatchEvent(new CustomEvent("und:figure", { detail: { on: on, alpha: st.alpha } }));
      }
    }, 350);
  })();

  /* ---------------- 三、你看别处的时候，窗外的它就没了 ---------------- */
  document.addEventListener("click", function (e) {
    if (!window.__undFigure) return;
    var t = e.target;
    if (t && t.closest && t.closest(".obj")) window.__undFigure.hide();   // 你低头看桌上的东西
  });
})();