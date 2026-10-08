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
    const to = (recipientSetting ? recipientSetting.split(',') : (Array.isArray(configured) && configured.length ? configured : DEFAULT_RECIPIENTS))
      .map(address => address.trim()).filter(Boolean);
    const from = env.INQUIRY_FROM_EMAIL || (options.netlify ? 'onboarding@resend.dev' : to[0]);
    const subject = `[ExcelTravel] 新客詢：${entry.name} - ${entry.message.slice(0, 40)}`;
    const body = `姓名: ${entry.name}\nEmail: ${entry.email}\n電話: ${entry.phone || '-'}\n頁面: ${entry.page || '-'}\n行程: ${entry.tourTitle || entry.tourId || '-'}\n\n留言:\n${entry.message}\n\n---\nID: ${entry.id} 時間: ${entry.createdAt}${options.netlify ? '' : ' IP: ' + entry.ip}`;
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
