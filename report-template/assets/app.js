(function () {
  'use strict';

  fetch('data.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function (err) {
      var grid = document.getElementById('pages-grid');
      grid.innerHTML = '<div class="empty-state">Failed to load data.json: ' + escapeHtml(String(err)) + '</div>';
    });

  function render(data) {
    var generatedAt = document.getElementById('generated-at');
    if (generatedAt) {
      try {
        generatedAt.textContent = 'Generated ' + new Date(data.generatedAt).toLocaleString();
      } catch (e) {
        generatedAt.textContent = 'Generated ' + data.generatedAt;
      }
    }

    var summary = document.getElementById('summary');
    if (summary) {
      summary.innerHTML =
        '<span><strong>' + data.summary.totalPages + '</strong> pages</span>' +
        '<span><strong>' + data.summary.totalInteractions + '</strong> interactions</span>' +
        '<span><strong>' + Math.round(data.summary.overallCoverage * 100) + '%</strong> avg coverage</span>';
    }

    var grid = document.getElementById('pages-grid');
    if (!data.pages.length) {
      grid.innerHTML = '<div class="empty-state">No pages were captured. Did any tests run and interact with a page?</div>';
      return;
    }

    grid.innerHTML = '';
    data.pages.forEach(function (page) {
      grid.appendChild(buildCard(page));
    });
  }

  function buildCard(page) {
    var card = document.createElement('a');
    card.className = 'page-card';
    card.href = 'pages/' + page.identity.id + '/index.html';

    var thumb = document.createElement('div');
    thumb.className = 'page-card__thumb';
    var img = document.createElement('img');
    img.src = 'pages/' + page.identity.id + '/screenshot.png';
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = function () {
      thumb.innerHTML = '<span class="page-card__thumb-empty">No screenshot</span>';
    };
    thumb.appendChild(img);
    card.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'page-card__body';

    var title = document.createElement('div');
    title.className = 'page-card__title';
    title.textContent = page.identity.name;
    body.appendChild(title);

    var url = document.createElement('div');
    url.className = 'page-card__url';
    url.textContent = page.identity.urlTemplate || page.identity.sampleUrl;
    body.appendChild(url);

    var row = document.createElement('div');
    row.className = 'page-card__row';

    var pill = document.createElement('span');
    pill.className = 'coverage-pill ' + coverageClass(page.coverage);
    pill.textContent = Math.round(page.coverage * 100) + '% covered';
    row.appendChild(pill);

    var vp = document.createElement('span');
    vp.className = 'viewport-tag';
    vp.textContent = page.identity.viewport;
    row.appendChild(vp);

    body.appendChild(row);

    var counts = document.createElement('div');
    counts.style.fontSize = '11px';
    counts.style.color = 'var(--fg-muted)';
    var total = page.elements.length;
    var touched = page.elements.filter(function (e) { return e.total > 0; }).length;
    counts.textContent = touched + ' of ' + total + ' elements interacted with';
    body.appendChild(counts);

    card.appendChild(body);
    return card;
  }

  function coverageClass(c) {
    if (c < 0.34) return 'cov-low';
    if (c < 0.67) return 'cov-mid';
    return 'cov-high';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
