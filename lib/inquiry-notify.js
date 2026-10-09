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
    const configured = await getRecipients().catch(() => null);
    const recipientSetting = env.INQUIRY_NOTIFY_EMAIL || env.NOTIFY_EMAIL;
    const to = ((Array.isArray(configured) && configured.length) ? configured : (recipientSetting ? recipientSetting.split(',') : DEFAULT_RECIPIENTS))
      .map(address => address.trim()).filter(Boolean);
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
        return { sent: false, reason: 'email-provider-error' };
      }
      return { sent: true };
    } catch (error) {
      logger.warn('[inquiry email failed]', error.message);
      return { sent: false, reason: 'email-provider-error' };
    }
  };
}

module.exports = { createInquiryNotifier, DEFAULT_RECIPIENTS };
