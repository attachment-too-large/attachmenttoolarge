/* ==========================================================================
   tunnel-bg.js — the photograph itself, moving

   Two earlier attempts drew this procedurally: rings with foliage between them
   (the foliage read as butterflies), then rings alone. Both were simulations of
   the picture, and the picture is better than the simulation, so the picture is
   what the background uses now.

   The motion is the picture being pressed into: a slow continuous zoom with a few
   degrees of rotation over forty-eight seconds, which is what travelling down the
   tunnel looks like when the tunnel is a still photograph. It is a CSS transform
   on a fixed layer, so it runs on the compositor rather than in JavaScript, and it
   stops when the tab is hidden or when the reader has asked for reduced motion.

   One asset, one layer, no dependency: assets/img/tunnel.jpg.
   ========================================================================== */
(function () {
  if (typeof document === "undefined") return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var style = document.createElement("style");
  style.textContent = [
    /* oversized, so the zoom and the rotation never expose an edge */
    ".tunnel-bg{position:fixed;top:-14vmax;left:-14vmax;width:calc(100% + 28vmax);height:calc(100% + 28vmax);",
    "z-index:-1;pointer-events:none;background:url('assets/img/tunnel.jpg') center center / cover no-repeat;",
    "transform-origin:50% 46%;will-change:transform;",
    "animation:tunnel-advance 48s linear infinite}",

    /* the advance: press forward, turn a little, and keep going */
    "@keyframes tunnel-advance{",
    "0%{transform:scale(1.04) rotate(0deg)}",
    "50%{transform:scale(1.16) rotate(3.2deg)}",
    "100%{transform:scale(1.30) rotate(6.4deg)}}",

    /* the scrim: the photograph must never win against the text laid over it.
       These two alphas are measured, not guessed. tunnel.jpg runs from relative
       luminance 0.00 (the dark centre) to 0.74 (the white walkway rings); its
       median is 0.08.

         dark theme  — bone text (L 0.87) needs the backdrop under 0.16, so even
                       the brightest ring has to be pressed down to ~0.13.
         light theme — ink text (L 0.01) needs the backdrop ABOVE 0.22, so this
                       theme gets a bone wash, not a darkening.

       There used to be one dark scrim for both themes. Against the pale body
       colour the audit modelled, everything looked fine; against the photograph
       that is actually behind the words, light-theme body copy sat at about
       1.3:1. The audit could not see it because the photograph is painted by a
       fixed layer that is not an ancestor of the text. */
    ".tunnel-bg::after{content:'';position:absolute;inset:0;",
    "background:radial-gradient(120% 90% at 50% 46%, rgba(3,9,7,0.82) 0%, rgba(3,9,7,0.88) 55%, rgba(2,7,5,0.94) 100%)}",
    "html[data-theme='light'] .tunnel-bg::after{",
    "background:radial-gradient(120% 90% at 50% 46%, rgba(251,249,243,0.76) 0%, rgba(251,249,243,0.84) 55%, rgba(251,249,243,0.92) 100%)}",

    "@media (prefers-reduced-motion: reduce){.tunnel-bg{animation:none;transform:scale(1.12)}}"
  ].join("");

  document.head.appendChild(style);
  var layer = document.createElement("div");
  layer.className = "tunnel-bg";
  layer.setAttribute("aria-hidden", "true");
  (document.body || document.documentElement).insertBefore(layer, document.body ? document.body.firstChild : null);

  /* stop the animation while the tab is hidden: no reason to burn a compositor */
  document.addEventListener("visibilitychange", function () {
    layer.style.animationPlayState = document.hidden ? "paused" : "running";
  });
  if (reduce) layer.style.animationPlayState = "paused";
})();
