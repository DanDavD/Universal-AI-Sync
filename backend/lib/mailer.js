'use strict'
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * Sends the license key to the subscriber.
 * @param {{ to: string, licenseKey: string }} params
 */
async function sendLicenseEmail({ to, licenseKey }) {
  await resend.emails.send({
    from: 'Universal AI Sync <onboarding@resend.dev>',
    to,
    subject: 'Your Universal AI Sync Pro license key',
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Logo / Brand -->
          <tr>
            <td align="center" style="padding-bottom:36px;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#f4f4f5;letter-spacing:-0.3px;">Universal AI Sync</p>
              <p style="margin:5px 0 0;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7c3aed;">Pro Plan</p>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#18181b;border:1px solid #27272a;border-radius:16px;padding:40px 36px;">

              <p style="margin:0 0 6px;font-size:24px;font-weight:700;color:#f4f4f5;letter-spacing:-0.4px;">
                Welcome to Sync Pro
              </p>
              <p style="margin:0 0 32px;font-size:14px;color:#71717a;line-height:1.65;">
                Your subscription is active. Find your license key below and follow the steps to activate it in your browser.
              </p>

              <!-- License key -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#52525b;">
                License Key
              </p>
              <div style="background:#09090b;border-radius:12px;padding:22px 24px;text-align:center;margin-bottom:36px;border:1px solid #3f3f46;">
                <p style="margin:0;font-size:21px;font-family:'SF Mono','Fira Code','Courier New',monospace;letter-spacing:5px;color:#f4f4f5;font-weight:600;">
                  ${licenseKey}
                </p>
              </div>

              <!-- Steps header -->
              <p style="margin:0 0 18px;font-size:13px;font-weight:700;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.07em;">
                How to activate
              </p>

              <!-- Step 1 -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="vertical-align:top;width:32px;">
                    <div style="width:24px;height:24px;background:#1e1e2e;border:1px solid #3f3f46;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:700;color:#a1a1aa;">1</div>
                  </td>
                  <td style="vertical-align:top;padding-top:3px;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Click the <strong style="color:#e4e4e7;">Universal AI Sync</strong> icon in your Chrome toolbar
                  </td>
                </tr>
              </table>

              <!-- Step 2 -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="vertical-align:top;width:32px;">
                    <div style="width:24px;height:24px;background:#1e1e2e;border:1px solid #3f3f46;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:700;color:#a1a1aa;">2</div>
                  </td>
                  <td style="vertical-align:top;padding-top:3px;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Click the <strong style="color:#e4e4e7;">Upgrade</strong> button at the top of the popup
                  </td>
                </tr>
              </table>

              <!-- Step 3 -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="vertical-align:top;width:32px;">
                    <div style="width:24px;height:24px;background:#1e1e2e;border:1px solid #3f3f46;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:700;color:#a1a1aa;">3</div>
                  </td>
                  <td style="vertical-align:top;padding-top:3px;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Scroll down to <strong style="color:#e4e4e7;">"Already have a key?"</strong>
                  </td>
                </tr>
              </table>

              <!-- Step 4 -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td style="vertical-align:top;width:32px;">
                    <div style="width:24px;height:24px;background:#1e1e2e;border:1px solid #3f3f46;border-radius:50%;text-align:center;line-height:24px;font-size:11px;font-weight:700;color:#a1a1aa;">4</div>
                  </td>
                  <td style="vertical-align:top;padding-top:3px;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Paste your key and click <strong style="color:#e4e4e7;">Activate License Key</strong>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="height:1px;background:#27272a;margin-bottom:28px;"></div>

              <!-- Footer note -->
              <p style="margin:0;font-size:12px;color:#52525b;line-height:1.7;">
                Your subscription renews automatically each month. To cancel at any time, go to your
                <strong style="color:#71717a;">PayPal account &rarr; Payments &rarr; Manage automatic payments</strong>.
                If you have any questions, simply reply to this email.
              </p>

            </td>
          </tr>

          <!-- Bottom brand -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:12px;color:#3f3f46;">Universal AI Sync &mdash; Sync every AI, every conversation.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  })
}

module.exports = { sendLicenseEmail }
