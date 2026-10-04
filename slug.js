'use strict';
/* One slug rule shared by the browser, the prerenderer and the tests.
 * tours.json keeps its Chinese slug as the stable data key; localized output
 * uses an ASCII slug so every language has a readable URL. */
(function (root) {
  function slugURL(slug) {
    return /^[\x20-\x7e]+$/.test(slug) ? slug : encodeURIComponent(slug);
  }
  function publishedSlug(tour, lang) {
    return lang === 'zh' ? tour.slug : (tour.slugEn || tour.slug);
  }
  var api = { slugURL: slugURL, publishedSlug: publishedSlug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ETSlug = api;
})(typeof window !== 'undefined' ? window : globalThis);
