/**
 * The DesignCraft frame-clock runtime as a standalone JS string — the single
 * source of truth used by:
 *   1. host/motion/composition-template.js (embedded in new compositions)
 *   2. routes preview serving (injected into any composition lacking __hfSeek,
 *      same pattern as open-design's injectMotionSourcePlayer)
 *   3. tests (contract assertions)
 *
 * Contract (consumed by the workspace preview, the render worker and AI):
 *   root: <div data-composition-id data-duration(s) data-width data-height>
 *   elements: data-hf-id for AI-editable ids; data-start/data-duration visible windows
 *   clock: __hfSeek(timeMs) / __hfPlay() / __hfPause(); GSAP timeline via
 *          window.__timelines[compositionId] preferred, else Web Animations
 *   audio: <audio src data-start data-duration data-volume>
 *   live playback reports {source:'hf-preview', t, duration} to parent
 *
 * Derived from nexu-io/open-design's motion source player (Apache-2.0); adapted
 * to the DesignCraft frame-clock contract.
 */
export const FRAME_RUNTIME_JS = String.raw`(function () {
  'use strict';
  function rootEl() { return document.querySelector('[data-composition-id]'); }
  var durationMs = 0, compW = 0, compH = 0;
  function readMeta() {
    var r = rootEl(); if (!r) return false;
    compW = parseFloat(r.dataset.width || '0') || 0;
    compH = parseFloat(r.dataset.height || '0') || 0;
    durationMs = (parseFloat(r.dataset.duration || '0') || 0) * 1000;
    return compW > 0 && compH > 0 && durationMs > 0;
  }
  if (!readMeta()) { document.addEventListener('DOMContentLoaded', readMeta, { once: true }); }

  var hint = null;
  function notice(text) {
    if (!hint) {
      hint = document.createElement('output');
      hint.setAttribute('data-hf-status', ''); hint.setAttribute('role', 'status');
      hint.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;padding:6px 10px;border-radius:6px;background:#17191d;color:#fff;font:13px system-ui;display:none';
      (document.body || document.documentElement).appendChild(hint);
    }
    hint.textContent = text || '';
    hint.style.display = text ? 'block' : 'none';
  }

  var stage = document.createElement('div');
  var stageReady = false;
  function mountStage() {
    var r = rootEl();
    if (!r || !r.parentNode || stageReady) return;
    r.parentNode.insertBefore(stage, r); stage.appendChild(r); stageReady = true;
  }
  function fit() {
    if (!stageReady) mountStage();
    if (!stageReady || !(compW > 0) || !(compH > 0)) return;
    var root = rootEl(); root.style.width = compW + 'px'; root.style.height = compH + 'px';
    if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
    var scale = Math.min(window.innerWidth / compW, Math.max(1, window.innerHeight) / compH);
    stage.style.cssText = 'position:fixed;width:' + compW + 'px;height:' + compH + 'px;left:' + ((window.innerWidth - compW * scale) / 2) + 'px;top:' + ((window.innerHeight - compH * scale) / 2) + 'px;transform-origin:0 0;transform:scale(' + scale + ')';
  }
  window.addEventListener('resize', fit);

  var els = [];
  function startSeconds(node) {
    var start = 0;
    for (var n = node; n && n !== rootEl(); n = n.parentElement) start += parseFloat(n.dataset.start || '0') || 0;
    return start;
  }
  function collect() {
    els = []; var r = rootEl(); if (!r) return;
    var nodes = r.querySelectorAll('[data-start],[data-duration]');
    for (var i = 0; i < nodes.length; i++) {
      els.push({ el: nodes[i], s: startSeconds(nodes[i]),
        d: nodes[i].dataset.duration !== undefined ? parseFloat(nodes[i].dataset.duration) : NaN, vis: null });
    }
  }
  collect();
  function windows(t) {
    var s = t / 1000;
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      var vis = s >= e.s && (!isFinite(e.d) || s < e.s + e.d);
      if (e.vis !== vis) { e.vis = vis; e.el.style.visibility = vis ? 'visible' : 'hidden'; }
    }
  }

  function allTimelines() {
    var map = window.__timelines || {};
    var out = [];
    var nodes = Array.from(document.querySelectorAll('[data-composition-id]'));
    for (var k in map) { var tl = map[k]; if (tl && typeof tl.seek === 'function' && typeof tl.play === 'function') out.push({ id: k, tl: tl, start: startSeconds(nodes.find(function (n) { return n.dataset.compositionId === k; })) }); }
    return out;
  }
  function seekClock(t) {
    var all = allTimelines();
    for (var i = 0; i < all.length; i++) {
      try { var local = Math.max(0, t / 1000 - all[i].start); all[i].tl.pause(); all[i].tl.seek(Math.min(local, all[i].tl.duration() || local), false); } catch (e) { }
    }
    var pa = document.getAnimations();
    for (var j = 0; j < pa.length; j++) { try { pa[j].pause(); pa[j].currentTime = t; } catch (e) { } }
  }
  function playClock() {
    var all = allTimelines();
    for (var i = 0; i < all.length; i++) { try { all[i].tl.play(); } catch (e) { } }
    if (all.length) return;
    var a = document.getAnimations();
    for (var j = 0; j < a.length; j++) { try { a[j].play(); } catch (e) { } }
  }
  function pauseClock() {
    var all = allTimelines();
    for (var i = 0; i < all.length; i++) { try { all[i].tl.pause(); } catch (e) { } }
    if (all.length) return;
    var a = document.getAnimations();
    for (var j = 0; j < a.length; j++) { try { a[j].pause(); } catch (e) { } }
  }
  function clockTimeMs() {
    if (playing) return base + (performance.now() - t0);
    return base;
  }
  function clockEnded() {
    var all = allTimelines();
    for (var i = 0; i < all.length; i++) {
      try { if (!all[i].tl.paused() && all[i].tl.time() >= (all[i].tl.duration() || 0) - 0.001) return true; } catch (e) { }
    }
    return false;
  }

  // 渲染停顿不代表要拖动音轨；只在新鲜且稳定的漂移上校正；显式播控绕过过滤。
  function createAudioSync(audio) {
    var sampledAt = null, driftSince = null, previousDrift = 0, correctedAt = -Infinity, align = false;
    return function (target, moving, force) {
      var now = performance.now(), gap = sampledAt === null ? Infinity : now - sampledAt;
      sampledAt = now;
      if (force) { align = true; driftSince = null; }
      if (align) {
        if (audio.readyState > 0) {
          if (Math.abs(audio.currentTime - target) > .01) audio.currentTime = target;
          align = false; correctedAt = now;
        }
        return;
      }
      var drift = target - audio.currentTime;
      if (!moving || audio.paused || audio.seeking || audio.readyState < 3 || gap > 200 || Math.abs(drift) <= .3 || now - correctedAt < 1500) {
        driftSince = null; previousDrift = drift; return;
      }
      if (driftSince === null || drift * previousDrift <= 0 || Math.abs(drift - previousDrift) > .1) driftSince = now;
      previousDrift = drift;
      if (now - driftSince >= 750) {
        audio.currentTime = target; correctedAt = now; driftSince = null;
      }
    };
  }
  var tracks = [];
  function collectAudio() {
    tracks = [];
    var nodes = document.querySelectorAll('audio[src]');
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      a.pause(); a.autoplay = false; a.preload = 'auto';
      tracks.push({ audio: a, start: parseFloat(a.dataset.start || '0') || 0,
        dur: a.dataset.duration !== undefined ? parseFloat(a.dataset.duration) : NaN,
        vol: Math.min(1, Math.max(0, parseFloat(a.dataset.volume || '1'))),
        pending: false, blocked: false, sync: createAudioSync(a) });
    }
  }
  collectAudio();
  function syncAudio(tMs, shouldPlay, force) {
    for (var i = 0; i < tracks.length; i++) {
      var tr = tracks[i], local = tMs / 1000 - tr.start;
      var active = local >= 0 && (!isFinite(tr.dur) || local < tr.dur);
      tr.audio.volume = tr.vol;
      if (!active || !shouldPlay) { tr.audio.pause(); tr.sync(Math.max(0, local), false, force); continue; }
      var target = Math.max(0, isFinite(tr.dur) ? Math.min(tr.dur, local) : local);
      tr.sync(target, true, force || (tr.audio.paused && !tr.pending && !tr.blocked));
      if (tr.audio.paused && !tr.pending && !tr.blocked) {
        tr.pending = true;
        var self = tr;
        var p = tr.audio.play();
        if (p) {
          p.catch(function (err) {
            if (err && err.name === 'AbortError') return;
            self.blocked = true;
            notice(err && err.name === 'NotAllowedError' ? '点击画面开启声音' : '音频无法播放，请检查素材');
          });
          var done = function () { self.pending = false; };
          if (p.finally) p.finally(done); else p.then(done, done);
        } else tr.pending = false;
      }
    }
  }

  var playing = false, base = 0, t0 = 0, rafId = 0, lastReport = -1;
  function report(t, force) {
    if (!force && t - lastReport < 100) return;
    lastReport = t;
    try { parent.postMessage({ source: 'hf-preview', t: Math.round(t), duration: Math.round(durationMs) }, '*'); } catch (e) { }
  }
  function loop() {
    if (!playing) { rafId = 0; return; }
    var t = clockTimeMs();
    var ended = durationMs > 0 && t >= durationMs;
    if (ended) {
      base = 0; t0 = performance.now();
      seekClock(0); windows(0); syncAudio(0, true, true); report(0, true);
    } else {
      seekClock(t); windows(t); syncAudio(t, true, false); report(t, false);
    }
    rafId = requestAnimationFrame(loop);
  }
  window.__hfSeek = window.__hfSeek || function (timeMs) {
    if (durationMs <= 0) readMeta();
    playing = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    base = timeMs;
    seekClock(timeMs); windows(timeMs); syncAudio(timeMs, false, true); report(timeMs, true);
    return document.getAnimations().length;
  };
  window.__hfPlay = window.__hfPlay || function () {
    if (durationMs <= 0 && !readMeta()) { notice('合成缺少有效的 data-duration'); return; }
    if (playing) return;
    if (base >= durationMs) { base = 0; seekClock(0); }
    playing = true; t0 = performance.now();
    notice('');
    seekClock(base); syncAudio(base, true, true);
    if (!rafId) rafId = requestAnimationFrame(loop);
  };
  window.__hfPause = window.__hfPause || function () {
    if (durationMs <= 0) readMeta();
    if (playing) { base = base + (performance.now() - t0); }
    playing = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    pauseClock();
    syncAudio(base, false, true); windows(base); report(base, true);
  };
  document.addEventListener('click', function () {
    var blocked = tracks.some(function (tr) { return tr.blocked; });
    if (blocked) {
      tracks.forEach(function (tr) { tr.blocked = false; }); notice('');
      syncAudio(clockTimeMs(), playing, true);
      return;
    }
    if (playing) window.__hfPause(); else window.__hfPlay();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playing) window.__hfPause();
  });
  window.addEventListener('pagehide', function () {
    if (playing) window.__hfPause();
    tracks.forEach(function (tr) { tr.audio.pause(); });
  });
  function boot() { fit(); collect(); collectAudio(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
`;

/**
 * Inject the frame runtime into an HTML composition that lacks __hfSeek.
 * Mirrors open-design's injectMotionSourcePlayer: skip when the source already
 * ships the runtime, insert before </body> (append when absent).
 */
export function injectFrameRuntime(html) {
	if (typeof html !== 'string' || html.indexOf('<') < 0) return html;
	if (/__hfSeek/.test(html)) return html;
	const marker = '<script data-hf-frame-runtime="2">';
	const script = marker + FRAME_RUNTIME_JS + '</' + 'script>';
	const m = /<\/body\s*>/i.exec(html);
	return m ? html.slice(0, m.index) + script + html.slice(m.index) : html + script;
}
