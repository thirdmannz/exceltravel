'use strict';
/* Metadata uses the same localized content as the visible tour page.
 * No Offer is emitted: headline prices and availability are not confirmed.
 * Browser and Node share this builder so tests exercise production code. */
(function (root) {
  function build(tour, content, origin) {
    var base = new URL(origin).origin;
    var url = base + '/tour.html?slug=' + encodeURIComponent(tour.slug);
    if (content.published) url = base + (content.lang === 'zh' ? '' : '/' + content.lang) + '/tours/' + encodeURIComponent(tour.slug) + '.html';
    var image = (tour.images || [])[0];
    image = image ? new URL(image, base).href : null;
    var title = content.title + ' | Excel Travel';
    var description = String(content.short || content.desc || content.title).replace(/\s+/g, ' ').trim();
    var trip = {
      '@context': 'https://schema.org', '@type': 'TouristTrip',
      '@id': url + '#trip', name: content.title, description: description,
      url: url, inLanguage: content.lang,
      provider: { '@type': 'TravelAgency', name: 'Excel Travel 赛尔旅游', url: base + '/' }
    };
    if (image) trip.image = image;
    return { url: url, title: title, description: description, image: image, schema: trip };
  }
  function apply(document, metadata) {
    document.title = metadata.title;
    function meta(selector, key, value) {
      if (value == null) return;
      var el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        var match = selector.match(/\[(name|property)="([^"]+)"\]/);
        el.setAttribute(match[1], match[2]);
        document.head.appendChild(el);
      }
      el.setAttribute(key, value);
    }
    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', metadata.url);
    meta('meta[name="description"]', 'content', metadata.description);
    ['og:title', 'twitter:title'].forEach(function (k) {
      meta('meta[' + (k.indexOf('og:') === 0 ? 'property' : 'name') + '="' + k + '"]', 'content', metadata.title);
    });
    ['og:description', 'twitter:description'].forEach(function (k) {
      meta('meta[' + (k.indexOf('og:') === 0 ? 'property' : 'name') + '="' + k + '"]', 'content', metadata.description);
    });
    meta('meta[property="og:url"]', 'content', metadata.url);
    ['og:image', 'twitter:image'].forEach(function (k) {
      meta('meta[' + (k.indexOf('og:') === 0 ? 'property' : 'name') + '="' + k + '"]', 'content', metadata.image);
    });
    // Remove generic breadcrumb whose item incorrectly points to the tour list.
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (el) {
      try {
        var data = JSON.parse(el.textContent);
        if (data['@type'] === 'TouristTrip' || data['@type'] === 'BreadcrumbList') el.remove();
      } catch (_) { /* Preserve unrelated structured data. */ }
    });
    var schema = document.createElement('script');
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify(metadata.schema);
    document.head.appendChild(schema);
  }
  var api = { build: build, apply: apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ETSEO = api;
})(typeof window !== 'undefined' ? window : globalThis);
