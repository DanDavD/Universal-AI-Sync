'use strict'
const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

/**
 * Sends the license key to the subscriber.
 * @param {{ to: string, licenseKey: string }} params
 */
async function sendLicenseEmail({ to, licenseKey }) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Your Universal AI Sync license key',
    text: [
      'Thank you for subscribing to Universal AI Sync!',
      '',
      'Your license key is:',
      '',
      `  ${licenseKey}`,
      '',
      'How to activate:',
      '1. Open the extension in Chrome',
      '2. Click the ⚙ Options link at the bottom of the popup',
      '3. Paste your license key in the License Key field and click Activate',
      '',
      'Your subscription renews automatically each month.',
      'To cancel, log in to your PayPal account and cancel the subscription there.',
      '',
      'If you have any issues, reply to this email.',
    ].join('\n'),
    html: `
      <p>Thank you for subscribing to <strong>Universal AI Sync</strong>!</p>
      <p>Your license key is:</p>
      <p style="font-size:20px;font-family:monospace;background:#f4f4f4;padding:12px;border-radius:6px;letter-spacing:2px">
        <strong>${licenseKey}</strong>
      </p>
      <p><strong>How to activate:</strong></p>
      <ol>
        <li>Open the extension in Chrome</li>
        <li>Click the <strong>⚙ Options</strong> link at the bottom of the popup</li>
        <li>Paste your license key in the <em>License Key</em> field and click <strong>Activate</strong></li>
      </ol>
      <p>Your subscription renews automatically each month. To cancel, log in to your PayPal account.</p>
    `,
  })
}

module.exports = { sendLicenseEmail }
