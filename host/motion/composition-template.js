import { FRAME_RUNTIME_JS } from './frame-runtime.js';

/**
 * Default composition template for new motion projects. Ships the frame-clock
 * runtime (adapted from nexu-io/open-design's motion source player, Apache-2.0):
 *   __hfSeek(timeMs)  — pause + seek to an exact time (worker / scrub / step)
 *   __hfPlay()        — native playback from the current time, looping
 *   __hfPause()       — freeze at the current time
 * Clock: a composition may register a GSAP timeline as
 * `window.__timelines[compositionId]` (real seconds, timeScale 1, duration ==
 * data-duration, no repeat/delay); the runtime drives it directly. Otherwise
 * all Web Animations (CSS keyframes / WAAPI) are paused+seeked via
 * document.getAnimations().
 * Audio: <audio src data-start data-duration data-volume> tracks are synced to
 * the clock with drift correction; blocked autoplay recovers on click.
 * The stage scales the composition to fit the viewport; live playback posts
 * {source:'hf-preview', t, duration} to the parent window.
 */
export function compositionTemplate({ durationFrames, width, height, fps }) {
	const durationSeconds = durationFrames / fps.num;
	const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#0E1116;}
  #dc-stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;}
  #dc-stage [data-hf-id]{position:absolute;}
  /* 示例元素：AI 可通过 write_sources 替换或增删 */
  .hf-title{left:0;right:0;top:42%;text-align:center;font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;
    font-size:64px;font-weight:700;color:#F5F7FA;letter-spacing:.08em;
    animation:hf-title-in 1.2s cubic-bezier(.22,.61,.36,1) .2s both;}
  .hf-sub{left:0;right:0;top:58%;text-align:center;font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;
    font-size:24px;color:#9FB0BF;letter-spacing:.35em;
    animation:hf-sub-in 1.2s cubic-bezier(.22,.61,.36,1) .55s both;}
  @keyframes hf-title-in{from{opacity:0;transform:translateY(26px);}to{opacity:1;transform:translateY(0);}}
  @keyframes hf-sub-in{from{opacity:0;letter-spacing:.6em;}to{opacity:1;letter-spacing:.35em;}}
</style>
</head>
<body>
<div id="dc-stage" data-composition-id="dc" data-duration="${durationSeconds}" data-width="${width}" data-height="${height}">
  <h1 class="hf-title" data-hf-id="hf-title">新动画</h1>
  <p class="hf-sub" data-hf-id="hf-subline">在左侧设计对话描述你想要的效果</p>
</div>
<script data-hf-frame-runtime="2">${FRAME_RUNTIME_JS}</script>
</body>
</html>
`;
	return { 'composition.html': html };
}
