'use strict';

const DEFAULT_RECIPIENTS = [
  'sophie@excel2012.com',
  'lala.liang@excel2011.com',
  'jessica.zhang@excel2011.com',
  'sandy.kim@excel2011.com',
];

function createInquiryNotifier(options = {}) {
  const env = options.env || process.env;
  const send = options.fetch || globalThis.fetch;
  const logger = options.logger || console;
  const getRecipients = options.getRecipients || (async () => null);
  return async function notifyInquiry(entry) {
    /* A silent fallback here hid the real fault for a whole day: the saved
       recipient list failed to load, so mail went to the legacy environment
       address while the admin screen still showed the saved list. Always say
       which source actually won. */
    let configured = null;
    try { configured = await getRecipients(); }
    catch (e) { logger.warn('[inquiry] saved recipients unavailable:', (e && e.message) || e); }
    const saved = Array.isArray(configured) ? configured.map(a => String(a).trim()).filter(Boolean) : [];
    const recipientSetting = env.INQUIRY_NOTIFY_EMAIL || env.NOTIFY_EMAIL;
    if (!saved.length && recipientSetting) logger.warn('[inquiry] no saved recipients, falling back to INQUIRY_NOTIFY_EMAIL');
    const fallback = (recipientSetting ? recipientSetting.split(',') : DEFAULT_RECIPIENTS).map(address => address.trim()).filter(Boolean);
    const to = saved.length ? saved : fallback;
    const from = env.INQUIRY_FROM_EMAIL || (options.netlify ? 'onboarding@resend.dev' : to[0]);
    const { nzDate, nzTime } = require('./nz-time');
    const interest = require('./inquiry-interests').interestLabel(entry.interest) || 'General inquiry';
    const subject = `[ExcelTravel] New inquiry: ${entry.name} - ${entry.message.slice(0, 40)}`;
    const body = `New customer inquiry\n\nName: ${entry.name}\nEmail: ${entry.email}\nPhone: ${entry.phone || '-'}\nInterested in: ${interest}\nTour: ${entry.tourTitleEn || entry.tourId || (entry.tourTitle && !/[\u3400-\u9fff]/.test(entry.tourTitle) ? entry.tourTitle : 'Not selected')}\nSource page: ${entry.page || '-'}\n\nMessage:\n${entry.message}\n\n---\nInquiry ID: ${entry.id}\nDate: ${nzDate(entry.createdAt)}\nTime: ${nzTime(entry.createdAt)} (New Zealand, Pacific/Auckland)${options.netlify ? '' : '\nIP: ' + entry.ip}`;
    logger.log('[inquiry]', subject);
    if (!to.length || !env.RESEND_API_KEY) return { sent: false, reason: 'email-not-configured' };
    try {
      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text: body, reply_to: entry.email }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        logger.warn('[inquiry email failed]', response.status, detail.slice(0, 300));
        return { sent: false, reason: 'email-provider-error', recipients: to.length };
      }
      /* Keep the provider id: without it "did it actually send?" needs a
         dashboard lookup instead of a log or the admin record. */
      let id = '';
      try { const data = await response.json(); id = (data && data.id) || ''; } catch (e) {}
      logger.log('[inquiry] sent', id || '(no id)', 'to', to.length, 'recipient(s)');
      return { sent: true, id, recipients: to.length };
    } catch (error) {
      logger.warn('[inquiry email failed]', error.message);
      return { sent: false, reason: 'email-provider-error', recipients: to.length };
    }
  };
}

module.exports = { createInquiryNotifier, DEFAULT_RECIPIENTS };
