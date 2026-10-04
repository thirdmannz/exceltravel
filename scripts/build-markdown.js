'use strict';
/* Plain-text mirrors of every published page, for crawlers that prefer text over
 * HTML. Facts come from the same tours.json and dictionaries that render the
 * site; nothing is stated here that the page does not already say. */
function markdownName(url) {
  if (url === '/') return 'index.md';
  // The URL carries the percent-encoded slug; the file on disk keeps the literal
  // characters a web server resolves to after decoding the request path.
  const rel = url.slice(1).replace(/\.html$/, '');
  let decoded = rel;
  try { decoded = decodeURIComponent(rel); } catch { /* leave malformed input as-is */ }
  return decoded + '.md';
}
function section(title, body) {
  return body ? '\n## ' + title + '\n\n' + body + '\n' : '';
}
function render(url, lang, lines, tour, T2) {
  T2 = T2 || (s => s);
  const T = T2;
  const ORIGIN_TARGET = 'https://www.exceltravel.nz/';
  const prefix = lang === 'zh' ? '' : lang + '/';
  const link = file => ORIGIN_TARGET + prefix + file;
  const canonical = 'https://www.exceltravel.nz' + url;
  const footer = '\nPrices, departures and availability must be confirmed with the travel team.\n';
  if (!tour) {
    return '# Excel Travel 赛尔旅游\n\n' + canonical + '\n' +
      section('About', lines.description) +
      section('Highlights', lines.tags.map(t => '- ' + t).join('\n')) +
      section('Explore', lines.links.map(l => '- [' + l + '](' + link(l) + ')').join('\n')) +
      footer.trim() + '\n\nContact: ' + link('contact.html') + '\n';
  }
  const f = tour.facts;
  const price = tour.content.priceTable || [];
  return '# ' + f.title + '\n\n' + canonical + '\n\n' +
    (tour.content.desc || tour.content.short || '') + '\n' +
    section('Itinerary', f.days.map(d => '- **' + d.label + '** ' + d.title + (d.desc ? ': ' + d.desc : '')).join('\n')) +
    section('Highlights', f.highlights.map(h => '- ' + h).join('\n')) +
    section('Departure dates', f.departures) +
    section('Included', f.included) +
    section('Notes', f.notes) +
    section('Prices', price.map(row => '- ' + T(row.label) + ': ' + (row.price ? 'NZ$' + row.price : T('价格请咨询'))).join('\n')) +
    section('Explore more', lines.links.map(l => '- [' + l + '](' + link(l) + ')').join('\n')) +
    footer.trim() + '\n\nContact: ' + link('contact.html') + '\n';
}
module.exports = { markdownName, render };
