/* ==========================================================================
   UNDERSTUDY — 窗外的天气（rain.js）
   --------------------------------------------------------------------------
   这里原来画的是"玻璃挂水"：一颗亮头拖一条尾巴。
   结果它看起来像精子，不像雨。撤了。

   现在画的是**雾**，四个层次：

     1. 夜里的街：远处几盏灯，全部糊成光晕（雾天看不见轮廓）
     2. 雾团：九个大而极淡的圆，缓慢平移，出界就绕回来
     3. 水膜：四条宽而极淡的竖条，慢慢往下淌（是"流下来的一层水"，
        不是一颗颗水珠 —— 所以没有头也没有尾巴）
     4. 玻璃：一层奶白色的薄雾贴在玻璃上，加一次性生成的噪点防色带

   平静、缓慢、不用盯着看。prefers-reduced-motion 时只画一帧。
   ========================================================================== */
(function () {
  "use strict";
  var host = document.querySelector("[data-rain]");
  if (!host) return;

  var canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  host.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  var W = 0, H = 0, dpr = 1;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  var puffs = [];      // 雾团
  var films = [];      // 水膜
  var grainPat = null; // 噪点（防色带）

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = host.clientWidth || 320;
    H = host.clientHeight || 240;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeGrain() {
    var g = document.createElement("canvas");
    g.width = g.height = 64;
    var gc = g.getContext("2d");
    var img = gc.createImageData(64, 64);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 128 + (Math.random() * 2 - 1) * 34;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    grainPat = ctx.createPattern(g, "repeat");
  }

  function seed() {
    puffs = [];
    var big = Math.max(W, H);
    for (var i = 0; i < 9; i++) {
      puffs.push({
        x: rnd(-0.15, 1.15) * W,
        y: rnd(0.05, 1.05) * H,
        r: rnd(0.28, 0.68) * big,
        a: rnd(0.05, 0.14),
        vx: rnd(-3.5, 3.5),
        vy: rnd(-1.2, 1.2)
      });
    }
    films = [];
    for (var k = 0; k < 4; k++) {
      films.push({
        x: rnd(0.05, 0.95) * W,
        y: rnd(-H, H),
        w: rnd(12, 30),
        v: rnd(2.2, 5.5),
        a: rnd(0.020, 0.045)
      });
    }
  }

  function drawNight() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2b2e26");
    g.addColorStop(0.5, "#232419");
    g.addColorStop(1, "#1a1a12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* 远处的灯：雾里只剩光晕，没有轮廓 */
  function drawLights() {
    var lights = [[0.26, 0.74, 0.52, 0.30], [0.72, 0.42, 0.30, 0.13], [0.55, 0.86, 0.36, 0.15]];
    lights.forEach(function (L) {
      var cx = L[0] * W, cy = L[1] * H, rr = L[2] * Math.max(W, H);
      var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      rg.addColorStop(0, "rgba(255,206,142," + L[3] + ")");
      rg.addColorStop(0.4, "rgba(250,196,138," + (L[3] * 0.35) + ")");
      rg.addColorStop(1, "rgba(240,190,130,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    });
  }

  /* --------------------------------------------------------------------------
     窗外的黑影。
     它站在街灯的光里，所以它本身是"一块挡光的黑"，不是一坨涂料。
     雾在它之后画，于是它总有一半被雾吃掉。它几乎不动；
     你盯着它看（鼠标移到窗上）的时候它会消失 —— 那是它唯一"活着"的证据。
     -------------------------------------------------------------------------- */
  var figure = { x: 0.66, y: 0.80, alpha: 0, want: 0, next: 4, hold: 0, drifting: 0, blinkT: 2.5, blinkShut: 0 };
  /* ?figure=1 让它立刻站在那儿 —— 给截图和人工检查用（平时它是按自己节奏出现的） */
  if (location.search.indexOf("figure=1") >= 0) { figure.want = 0.82; figure.alpha = 0; figure.hold = 9999; }

  function drawFigure(dt) {
    /* 状态机：出现 → 站几秒（轻微横移）→ 消失；然后再等一会儿 */
    if (figure.hold > 0) {
      figure.hold -= dt;
      if (figure.hold <= 0) { figure.want = 0; figure.next = 12 + Math.random() * 16; }
    } else {
      figure.next -= dt;
      if (figure.next <= 0) { figure.want = 0.62 + Math.random() * 0.22; figure.hold = 5 + Math.random() * 6; figure.x = 0.5 + Math.random() * 0.26; }
    }
    figure.alpha += (figure.want - figure.alpha) * Math.min(1, dt * 1.6);
    /* 眨眼：它不常眨，而且眨眼时不是"闭上"，是那两点光暂时压暗 */
    figure.blinkT -= dt;
    if (figure.blinkT <= 0) { figure.blinkShut = 0.13; figure.blinkT = 2.5 + Math.random() * 5; }
    if (figure.blinkShut > 0) figure.blinkShut -= dt;
    figure.drifting += dt * 0.25;
    if (figure.alpha < 0.01) return;

    var cx = (figure.x + Math.sin(figure.drifting) * 0.012) * W;
    var baseY = figure.y * H;                     // 脚在街上
    var hgt = H * 0.34;                           // 高得不太对：比一个人高一截
    var wid = hgt * 0.20;
    var a = figure.alpha * 0.86;   // 隔着雾看，暗形略收

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#070605";
    ctx.shadowColor = "rgba(0,0,0,.85)";
    ctx.shadowBlur = Math.max(6, H * 0.03);
    /* 身体：肩略斜，站得笔直 */
    ctx.beginPath();
    ctx.moveTo(cx - wid * 0.55, baseY);
    ctx.lineTo(cx - wid * 0.62, baseY - hgt * 0.62);
    ctx.quadraticCurveTo(cx - wid * 0.58, baseY - hgt * 0.80, cx - wid * 0.24, baseY - hgt * 0.84);
    ctx.lineTo(cx + wid * 0.24, baseY - hgt * 0.84);
    ctx.quadraticCurveTo(cx + wid * 0.58, baseY - hgt * 0.80, cx + wid * 0.62, baseY - hgt * 0.62);
    ctx.lineTo(cx + wid * 0.55, baseY);
    ctx.closePath();
    ctx.fill();
    /* 头：小一点，微微前倾 —— 它在看这边 */
    ctx.beginPath();
    ctx.ellipse(cx + wid * 0.06, baseY - hgt * 0.90, wid * 0.30, wid * 0.36, -0.08, 0, 6.283);
    ctx.fill();
    ctx.restore();

    /* 眼睛 —— 全身上下唯一发亮的两点。它不凶，它只是在看你。 */
    var ex = cx + wid * 0.10, ey = baseY - hgt * 0.89;
    var vis = figure.blinkShut > 0 ? 0.22 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a * 1.15) * vis;
    ctx.shadowColor = "rgba(236,228,198,.95)";
    ctx.shadowBlur = Math.max(5, H * 0.022);
    ctx.fillStyle = "rgba(240,234,206,1)";
    /* 每只眼睛外面先垫一圈很淡的光晕 —— 黑暗里的一对眼睛是靠晕才看得见的，
       只有两个小点的话，缩到真实尺寸就没了。 */
    [-1, 1].forEach(function (s) {
      var cxp = ex + s * wid * 0.135;
      var halo = ctx.createRadialGradient(cxp, ey, 0, cxp, ey, wid * 0.30);
      halo.addColorStop(0, "rgba(236,228,198,.55)");
      halo.addColorStop(0.45, "rgba(226,216,182,.16)");
      halo.addColorStop(1, "rgba(220,210,176,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cxp, ey, wid * 0.30, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "rgba(244,238,212,1)";
      ctx.beginPath();
      ctx.ellipse(cxp, ey, wid * 0.085, wid * 0.058, 0, 0, 6.283);
      ctx.fill();
    });
    ctx.restore();
  }
  function drawPuffs(dt) {
    ctx.globalCompositeOperation = "lighter";
    puffs.forEach(function (p) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      var m = p.r * 1.1;
      if (p.x < -m) p.x = W + m; else if (p.x > W + m) p.x = -m;
      if (p.y < -m) p.y = H + m; else if (p.y > H + m) p.y = -m;
      var rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      rg.addColorStop(0, "rgba(206,200,178," + p.a + ")");
      rg.addColorStop(0.55, "rgba(196,190,168," + (p.a * 0.45) + ")");
      rg.addColorStop(1, "rgba(190,184,162,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
    });
    ctx.globalCompositeOperation = "source-over";
  }

  /* 水膜：宽、极淡、慢慢往下淌 —— 没有头，也没有尾巴 */
  function drawFilms(dt) {
    films.forEach(function (f) {
      f.y += f.v * dt;
      if (f.y - H * 0.5 > H) { f.y = -H * 0.5; f.x = rnd(0.05, 0.95) * W; f.w = rnd(12, 30); }
      var lg = ctx.createLinearGradient(f.x - f.w, 0, f.x + f.w, 0);
      lg.addColorStop(0, "rgba(216,210,186,0)");
      lg.addColorStop(0.5, "rgba(216,210,186," + f.a + ")");
      lg.addColorStop(1, "rgba(216,210,186,0)");
      ctx.fillStyle = lg;
      var hh = H * 1.4;
      ctx.fillRect(f.x - f.w, f.y - hh * 0.5, f.w * 2, hh);
    });
  }

  /* 贴在玻璃上的奶白薄雾 + 一层反光 + 噪点 */
  function drawGlass() {
    var v = ctx.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, "rgba(226,220,196,0.075)");
    v.addColorStop(0.45, "rgba(226,220,196,0.032)");
    v.addColorStop(1, "rgba(226,220,196,0.055)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    var s = ctx.createLinearGradient(0, 0, W, H);
    s.addColorStop(0, "rgba(255,255,255,0.055)");
    s.addColorStop(0.4, "rgba(255,255,255,0.012)");
    s.addColorStop(1, "rgba(255,255,255,0.030)");
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, W, H);

    if (grainPat) {
      ctx.save();
      ctx.globalAlpha = 0.030;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = grainPat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  var last = 0, running = false;
  function frame(t) {
    var dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
    last = t;
    ctx.clearRect(0, 0, W, H);
    drawNight();
    drawLights();
    drawPuffs(dt);
    drawFigure(dt);   // 黑影画在雾之后：雾厚的时候它也必须是个可辨的暗形
    drawFilms(dt);
    drawGlass();
    if (!reduce) requestAnimationFrame(frame); else running = false;
  }

  resize();
  makeGrain();
  seed();
  running = !reduce;
  frame(0);
  if (!reduce) requestAnimationFrame(frame);

  /* 对外：游戏逻辑与自动化测试用 */
  window.__undFigure = {
    force: function (visible, alpha) {          // 测试用：立刻让它出现/消失
      figure.want = visible ? (alpha || 0.7) : 0;
      figure.alpha = figure.want;
      figure.hold = visible ? 8 : 0;
      figure.next = visible ? 99 : 12;
      return figure.alpha;
    },
    hide: function () { figure.want = 0; figure.hold = 0; figure.next = 6 + Math.random() * 8; },
    state: function () {
      return { alpha: Math.round(figure.alpha * 1000) / 1000, x: Math.round(figure.x * 1000) / 1000,
               want: figure.want, hold: Math.round(figure.hold * 10) / 10 };
    }
  };

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); makeGrain(); seed(); last = 0; if (reduce || !running) frame(0); }, 200);
  });
})();
