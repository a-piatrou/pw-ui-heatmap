(function () {
  'use strict';

  var pageId = window.__pwhmPageId;
  var thresholds = window.__pwhmThresholds || { orange: 2 };

  var dataPromise = fetch('../../data.json', { cache: 'no-store' }).then(function (r) {
    return r.json();
  });

  var iframe = document.getElementById('snapshot-frame');
  var iframeLoaded = new Promise(function (resolve, reject) {
    if (!iframe) return reject(new Error('iframe not found'));

    var done = false;
    function isReady() {
      try {
        var doc = iframe.contentDocument;
        return !!(doc && doc.documentElement && doc.documentElement.hasAttribute('data-pwhm-snapshot'));
      } catch (e) {
        return false;
      }
    }
    function tryResolve() {
      if (done) return;
      if (isReady()) {
        done = true;
        clearInterval(interval);
        resolve(iframe);
      }
    }

    iframe.addEventListener('load', function () { setTimeout(tryResolve, 0); });
    iframe.addEventListener('error', function () { if (!done) reject(new Error('iframe error')); });
    var interval = setInterval(tryResolve, 100);
    tryResolve();
    setTimeout(function () {
      if (!done) {
        clearInterval(interval);
        reject(new Error('iframe did not load — snapshot may be cross-origin or missing'));
      }
    }, 10000);
  });

  Promise.all([dataPromise, iframeLoaded]).then(function (results) {
    var data = results[0];
    var page = (data.pages || []).find(function (p) { return p.identity.id === pageId; });
    if (!page) {
      showError('Page id "' + pageId + '" not found in data.json');
      return;
    }
    init(page, data);
  }).catch(function (err) {
    showError(
      'Could not initialize overlay: ' + (err && err.message ? err.message : String(err)) +
      '. If you opened this file directly from disk, browser security may block iframe access — ' +
      'use `npx pw-ui-heatmap serve` to run a local server.'
    );
  });

  function init(page, data) {
    var doc;
    try {
      doc = iframe.contentDocument;
      // Verify access (cross-origin would throw)
      void doc.documentElement;
    } catch (e) {
      showError(
        'Cannot read snapshot DOM (cross-origin). Use `npx pw-ui-heatmap serve` to view this report.'
      );
      return;
    }
    if (!doc || !doc.documentElement) {
      showError('Snapshot did not load.');
      return;
    }

    document.getElementById('page-title').textContent = page.identity.name;

    var meta = document.getElementById('page-meta');
    if (meta) {
      meta.innerHTML =
        '<span><strong>' + page.elements.filter(byTouched).length + ' / ' + page.elements.length + '</strong> elements touched</span>' +
        '<span><strong>' + Math.round(page.coverage * 100) + '%</strong> coverage</span>' +
        '<span><strong>' + page.identity.viewport + '</strong> viewport</span>' +
        '<span><code>' + escapeHtml(page.identity.urlTemplate || page.identity.sampleUrl) + '</code></span>';
    }

    var elementsById = {};
    page.elements.forEach(function (e) { elementsById[e.pwhmId] = e; });

    var overlay = document.getElementById('overlay-container');
    var tooltip = document.getElementById('tooltip');
    var showCandidates = true;
    var toggle = document.getElementById('toggle-candidates');
    if (toggle) {
      toggle.addEventListener('change', function (e) {
        showCandidates = !!e.target.checked;
        draw();
      });
    }

    function classify(count) {
      if (count === 0) return 'pwhm-red';
      if (count <= thresholds.orange) return 'pwhm-orange';
      return 'pwhm-green';
    }

    function resize() {
      var h = doc.documentElement.scrollHeight;
      iframe.style.height = Math.max(h, 200) + 'px';
    }

    function draw() {
      overlay.innerHTML = '';
      var tagged = doc.querySelectorAll('[data-pwhm-id], [data-pwhm-candidate]');
      for (var i = 0; i < tagged.length; i++) {
        var el = tagged[i];
        var id = el.getAttribute('data-pwhm-id') || el.getAttribute('data-pwhm-candidate');
        var info = elementsById[id] || { total: 0, byAction: {}, tests: [] };
        if (info.total === 0 && !showCandidates) continue;

        var rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;

        var box = document.createElement('div');
        box.className = 'pwhm-box ' + classify(info.total);
        box.style.left = (rect.left + doc.documentElement.scrollLeft) + 'px';
        box.style.top = (rect.top + doc.documentElement.scrollTop) + 'px';
        box.style.width = rect.width + 'px';
        box.style.height = rect.height + 'px';

        var badge = document.createElement('div');
        badge.className = 'pwhm-badge';
        badge.textContent = info.total;
        box.appendChild(badge);

        box.addEventListener('mouseenter', makeTooltipHandler(el, info));
        box.addEventListener('mouseleave', hideTooltip);
        box.addEventListener('mousemove', positionTooltip);

        overlay.appendChild(box);
      }
    }

    function makeTooltipHandler(el, info) {
      return function (evt) {
        var label = el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) ||
          el.tagName.toLowerCase();
        var rows = '';
        Object.keys(info.byAction).sort().forEach(function (action) {
          rows += '<div class="tooltip__row"><span>' + escapeHtml(action) +
            '</span><code>' + info.byAction[action] + '</code></div>';
        });
        if (!rows) {
          rows = '<div class="tooltip__row"><em>No interactions</em></div>';
        }
        var tests = '';
        if (info.tests && info.tests.length) {
          tests = '<div class="tooltip__divider"></div>' +
            '<div class="tooltip__tests">Tests: ' +
            info.tests.map(escapeHtml).join(', ') + '</div>';
        }
        tooltip.innerHTML =
          '<div class="tooltip__title">' +
          '&lt;' + escapeHtml(el.tagName.toLowerCase()) + '&gt; ' +
          escapeHtml(label) +
          '</div>' +
          rows +
          tests;
        tooltip.hidden = false;
        positionTooltip(evt);
      };
    }

    function positionTooltip(evt) {
      var x = evt.clientX + 12;
      var y = evt.clientY + 12;
      var maxX = window.innerWidth - tooltip.offsetWidth - 12;
      var maxY = window.innerHeight - tooltip.offsetHeight - 12;
      if (x > maxX) x = maxX;
      if (y > maxY) y = maxY;
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
    }

    function hideTooltip() {
      tooltip.hidden = true;
    }

    resize();
    draw();

    try {
      new ResizeObserver(function () { resize(); draw(); }).observe(doc.documentElement);
    } catch (e) { /* older browsers */ }
    window.addEventListener('resize', function () { resize(); draw(); });
  }

  function byTouched(e) { return e.total > 0; }

  function showError(msg) {
    var el = document.getElementById('error-banner');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
