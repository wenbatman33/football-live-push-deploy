// ==========================================================================
// 足球即時推播 · 嵌入腳本
// --------------------------------------------------------------------------
// 第三方站台只要加一行：
//   <script src="https://host/embed.js" data-match="<matchId>"
//           data-position="bottom-right"
//           data-width="280" data-height="420"></script>
//
// 可調屬性 (皆選用)：
//   data-match     必填，比賽 id
//   data-position  bottom-right | bottom-left | top-right | top-left | custom
//                  custom 時會直接把 iframe 插入 script 同層
//   data-width     預設 280
//   data-height    預設 460
//   data-offset    貼邊距離，預設 16 (px)
//   data-docked    初始化即收納：left | right
//   data-closable  是否顯示關閉鈕，預設 true
// ==========================================================================
(function () {
  'use strict';

  // 找到目前這支 script 的 <script> 標籤
  var currentScript = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    return all[all.length - 1];
  })();
  if (!currentScript) return;

  var matchId = currentScript.getAttribute('data-match');
  if (!matchId) { console.warn('[football-live-push] 缺少 data-match 屬性'); return; }

  var position = currentScript.getAttribute('data-position') || 'bottom-right';
  var width    = parseInt(currentScript.getAttribute('data-width')  || '280', 10);
  var height   = parseInt(currentScript.getAttribute('data-height') || '460', 10);
  var offset   = parseInt(currentScript.getAttribute('data-offset') || '16', 10);
  var docked   = currentScript.getAttribute('data-docked') || '';
  var closable = currentScript.getAttribute('data-closable') !== 'false';

  // 推算 server origin：embed.js 來自哪，widget 就去那
  var src = currentScript.getAttribute('src') || '';
  var origin;
  try { origin = new URL(src, location.href).origin; }
  catch (_) { origin = location.origin; }

  var qs = 'match=' + encodeURIComponent(matchId) + '&embedded=1';
  if (docked === 'left' || docked === 'right') qs += '&docked=' + docked;
  var widgetUrl = origin + '/widget.html?' + qs;

  // ── 容器 ───────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = '__flp_widget_' + matchId;
  wrap.style.cssText = 'position:fixed;z-index:2147483000;width:' + width + 'px;height:' + height + 'px;' +
    'pointer-events:none;'; // iframe 內自己處理點擊
  // pointer-events: none on wrap 讓外露空白區不擋頁面；iframe 設 auto 恢復

  switch (position) {
    case 'bottom-left':  wrap.style.left  = offset + 'px'; wrap.style.bottom = offset + 'px'; break;
    case 'top-right':    wrap.style.right = offset + 'px'; wrap.style.top    = offset + 'px'; break;
    case 'top-left':     wrap.style.left  = offset + 'px'; wrap.style.top    = offset + 'px'; break;
    case 'bottom-right': wrap.style.right = offset + 'px'; wrap.style.bottom = offset + 'px'; break;
    case 'custom': // 插到 script 同層、不定位
      wrap.style.position = 'relative';
      wrap.style.right = wrap.style.bottom = wrap.style.left = wrap.style.top = 'auto';
      break;
  }

  // iframe
  var iframe = document.createElement('iframe');
  iframe.src = widgetUrl;
  iframe.title = '足球即時推播';
  iframe.allow = 'clipboard-read; clipboard-write';
  iframe.style.cssText = 'width:100%;height:100%;border:0;background:transparent;' +
    'pointer-events:auto;color-scheme:normal;' +
    'border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,0.45);';
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('scrolling', 'no');
  wrap.appendChild(iframe);

  // 關閉鈕（host 頁面上的小 X，藏整個 widget）
  if (closable) {
    var btn = document.createElement('button');
    btn.textContent = '×';
    btn.setAttribute('aria-label', '關閉 widget');
    btn.style.cssText =
      'position:absolute;top:-10px;right:-10px;width:22px;height:22px;' +
      'border-radius:50%;border:1px solid rgba(255,255,255,0.3);' +
      'background:#0a1628;color:#fff;font-size:14px;line-height:20px;' +
      'cursor:pointer;pointer-events:auto;padding:0;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:1;';
    btn.onclick = function () { wrap.style.display = 'none'; };
    wrap.appendChild(btn);
  }

  // 插入位置
  if (position === 'custom' && currentScript.parentNode) {
    currentScript.parentNode.insertBefore(wrap, currentScript);
  } else {
    (document.body || document.documentElement).appendChild(wrap);
  }

  // 對外 API：window.FootballLivePush.close(matchId) / show(matchId)
  window.FootballLivePush = window.FootballLivePush || {
    close: function (id) {
      var el = document.getElementById('__flp_widget_' + id);
      if (el) el.style.display = 'none';
    },
    show: function (id) {
      var el = document.getElementById('__flp_widget_' + id);
      if (el) el.style.display = '';
    }
  };
})();
