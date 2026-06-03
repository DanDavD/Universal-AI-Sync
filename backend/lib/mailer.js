'use strict'
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * Sends the license key to the subscriber.
 * @param {{ to: string, licenseKey: string }} params
 */
async function sendLicenseEmail({ to, licenseKey }) {
  await resend.emails.send({
    from: 'Universal AI Sync <noreply@universalaisync.com>',
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
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">

          <!-- Top gradient accent bar -->
          <tr>
            <td style="height:3px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:2px 2px 0 0;"></td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#18181b;border:1px solid #27272a;border-top:none;border-radius:0 0 16px 16px;padding:40px 36px 36px;">

              <!-- Brand header -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:20px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                      Universal AI Sync
                    </p>
                    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7c3aed;">
                      Pro Plan Activated
                    </p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <span style="display:inline-block;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:20px;padding:4px 14px;font-size:11px;font-weight:800;color:#fff;letter-spacing:0.06em;text-transform:uppercase;">
                      PRO
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="height:1px;background:#27272a;margin-bottom:28px;"></div>

              <!-- Headline -->
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f4f4f5;letter-spacing:-0.4px;">
                Welcome to Sync Pro
              </p>
              <p style="margin:0 0 32px;font-size:14px;color:#71717a;line-height:1.65;">
                Your subscription is active. Copy your license key below and activate it in your browser in under 30 seconds.
              </p>

              <!-- License key box with gradient border -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#52525b;">
                Your License Key
              </p>
              <div style="background:linear-gradient(#09090b,#09090b) padding-box,linear-gradient(135deg,#4f8ef7,#7c3aed) border-box;border:2px solid transparent;border-radius:12px;padding:22px 24px;text-align:center;margin-bottom:12px;box-shadow:0 0 30px rgba(79,142,247,0.12),0 0 60px rgba(124,58,237,0.08);">
                <p style="margin:0;font-size:22px;font-family:'SF Mono','Fira Code','Courier New',monospace;letter-spacing:5px;color:#f4f4f5;font-weight:700;">
                  ${licenseKey}
                </p>
              </div>
              <p style="margin:0 0 36px;font-size:12px;color:#52525b;text-align:center;">
                Keep this key safe — it's tied to your subscription.
              </p>

              <!-- Steps header -->
              <p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:0.1em;">
                How to activate
              </p>

              <!-- Steps -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="vertical-align:top;width:36px;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#fff;">1</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Click the <strong style="color:#e4e4e7;">Universal AI Sync</strong> icon in your Chrome toolbar
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="vertical-align:top;width:36px;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#fff;">2</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Click <strong style="color:#e4e4e7;">Upgrade</strong> at the top of the popup
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                <tr>
                  <td style="vertical-align:top;width:36px;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#fff;">3</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Scroll down to <strong style="color:#e4e4e7;">"Already have a key?"</strong>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td style="vertical-align:top;width:36px;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#fff;">4</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;">
                    Paste your key and click <strong style="color:#e4e4e7;">Activate License Key</strong>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="height:1px;background:#27272a;margin-bottom:24px;"></div>

              <!-- Footer note -->
              <p style="margin:0;font-size:12px;color:#52525b;line-height:1.7;">
                Your subscription renews automatically each month. To cancel at any time, go to
                <strong style="color:#3f3f46;">PayPal &rarr; Payments &rarr; Manage automatic payments</strong>.
                Questions? Reply to this email.
              </p>

            </td>
          </tr>

          <!-- Bottom brand -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0 0 4px;font-size:12px;color:#3f3f46;">
                Universal AI Sync &mdash; One Brain. Four AI. Zero Context Lost.
              </p>
              <p style="margin:0;font-size:11px;color:#27272a;">
                universalaisync.com
              </p>
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
