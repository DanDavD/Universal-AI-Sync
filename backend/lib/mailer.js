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
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    * { box-sizing: border-box; }
    body, table, td, div, p, a { -webkit-text-size-adjust: 100%; }

    /* Force dark mode on all clients */
    body { background-color: #09090b !important; margin: 0 !important; padding: 0 !important; }

    @media (prefers-color-scheme: dark) {
      body { background-color: #09090b !important; }
      .email-bg { background-color: #09090b !important; }
      .card { background-color: #18181b !important; border-color: #27272a !important; }
      .text-primary { color: #f4f4f5 !important; }
      .text-muted { color: #71717a !important; }
      .text-subtle { color: #52525b !important; }
      .text-secondary { color: #a1a1aa !important; }
      .text-strong { color: #e4e4e7 !important; }
      .key-bg { background-color: #09090b !important; }
      .divider { background-color: #27272a !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#09090b;" bgcolor="#09090b">

  <!-- Outer wrapper -->
  <div style="background-color:#09090b;padding:48px 16px;min-height:100vh;" class="email-bg">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:#09090b;" bgcolor="#09090b">
    <tr>
      <td align="center" style="background-color:#09090b;" bgcolor="#09090b">
        <table width="540" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:540px;width:100%;">

          <!-- Gradient top bar -->
          <tr>
            <td height="3" style="background:linear-gradient(135deg,#4f8ef7,#7c3aed);font-size:0;line-height:0;" bgcolor="#4f8ef7">&nbsp;</td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#18181b;border:1px solid #27272a;border-top:none;border-radius:0 0 16px 16px;padding:40px 36px 36px;" bgcolor="#18181b" class="card">

              <!-- Brand row -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td style="vertical-align:middle;">
                    <p style="margin:0 0 3px;font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#a78bfa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                      Universal AI Sync
                    </p>
                    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7c3aed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                      Pro Plan Activated
                    </p>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:20px;padding:5px 16px;font-size:11px;font-weight:800;color:#ffffff;letter-spacing:0.08em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">PRO</span>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="height:1px;background-color:#27272a;margin-bottom:28px;font-size:0;line-height:0;" class="divider">&nbsp;</div>

              <!-- Headline -->
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f4f4f5;letter-spacing:-0.4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-primary">
                Welcome to Sync Pro
              </p>
              <p style="margin:0 0 32px;font-size:14px;color:#71717a;line-height:1.65;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-muted">
                Your subscription is active. Copy your license key below and activate it in your browser in under 30 seconds.
              </p>

              <!-- License key label -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#52525b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-subtle">
                Your License Key
              </p>

              <!-- License key box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                <tr>
                  <td style="background-color:#09090b;border:2px solid #7c3aed;border-radius:12px;padding:22px 24px;text-align:center;" bgcolor="#09090b" class="key-bg">
                    <p style="margin:0;font-size:20px;font-family:'Courier New',Courier,monospace;letter-spacing:4px;color:#f4f4f5;font-weight:700;" class="text-primary">
                      ${licenseKey}
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 36px;font-size:12px;color:#52525b;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-subtle">
                Keep this key safe — it is tied to your subscription.
              </p>

              <!-- Steps label -->
              <p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#52525b;text-transform:uppercase;letter-spacing:0.1em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-subtle">
                How to activate
              </p>

              <!-- Step 1 -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
                <tr>
                  <td width="36" style="vertical-align:top;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">1</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-secondary">
                    Click the <strong style="color:#e4e4e7;" class="text-strong">Universal AI Sync</strong> icon in your Chrome toolbar
                  </td>
                </tr>
              </table>

              <!-- Step 2 -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
                <tr>
                  <td width="36" style="vertical-align:top;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">2</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-secondary">
                    Click <strong style="color:#e4e4e7;" class="text-strong">Upgrade</strong> at the top of the popup
                  </td>
                </tr>
              </table>

              <!-- Step 3 -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
                <tr>
                  <td width="36" style="vertical-align:top;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">3</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-secondary">
                    Scroll down to <strong style="color:#e4e4e7;" class="text-strong">"Already have a key?"</strong>
                  </td>
                </tr>
              </table>

              <!-- Step 4 -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
                <tr>
                  <td width="36" style="vertical-align:top;padding-top:1px;">
                    <div style="width:22px;height:22px;background:linear-gradient(135deg,#4f8ef7,#7c3aed);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">4</div>
                  </td>
                  <td style="vertical-align:top;font-size:14px;color:#a1a1aa;line-height:1.6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-secondary">
                    Paste your key and click <strong style="color:#e4e4e7;" class="text-strong">Activate License Key</strong>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <div style="height:1px;background-color:#27272a;margin-bottom:24px;font-size:0;line-height:0;" class="divider">&nbsp;</div>

              <!-- Footer -->
              <p style="margin:0;font-size:12px;color:#52525b;line-height:1.7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" class="text-subtle">
                Your subscription renews automatically each month. To cancel at any time, go to
                <strong style="color:#3f3f46;">PayPal &rarr; Payments &rarr; Manage automatic payments</strong>.
                Questions? Reply to this email.
              </p>

            </td>
          </tr>

          <!-- Bottom tagline -->
          <tr>
            <td align="center" style="padding-top:24px;background-color:#09090b;" bgcolor="#09090b">
              <p style="margin:0 0 4px;font-size:12px;color:#3f3f46;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                Universal AI Sync &mdash; One Brain. Four AI. Zero Context Lost.
              </p>
              <p style="margin:0;font-size:11px;color:#27272a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                universalaisync.com
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
  </div>

</body>
</html>
    `,
  })
}

module.exports = { sendLicenseEmail }
