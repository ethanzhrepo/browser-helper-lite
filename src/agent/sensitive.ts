/**
 * Pages where one wrong click hands over an account: sign-in and account
 * security, API keys and access tokens, OAuth consent screens, cloud consoles,
 * password managers and payment services. On these, every change waits for the
 * user, whatever the mode or the site's policy (§8.1). Browsing them is fine.
 */

/** Whole sites (and their subdomains). */
const SENSITIVE_SITES = [
  // Google, Microsoft, Apple accounts
  'accounts.google.com', 'myaccount.google.com', 'passwords.google.com', 'admin.google.com', 'console.cloud.google.com',
  'pay.google.com', 'payments.google.com',
  'account.microsoft.com', 'account.live.com', 'login.live.com', 'login.microsoftonline.com', 'mysignins.microsoft.com',
  'myaccount.microsoft.com', 'portal.azure.com', 'entra.microsoft.com', 'admin.microsoft.com',
  'appleid.apple.com', 'account.apple.com', 'iforgot.apple.com',
  // Cloud consoles
  'console.aws.amazon.com', 'signin.aws.amazon.com', 'dash.cloudflare.com', 'console.aliyun.com', 'ram.console.aliyun.com',
  'console.cloud.tencent.com', 'console.volcengine.com', 'console.huaweicloud.com', 'app.netlify.com', 'vercel.com',
  // Model providers' key pages
  'platform.openai.com', 'console.anthropic.com', 'platform.deepseek.com',
  // Identity and password managers
  'id.atlassian.com', 'admin.atlassian.com', 'okta.com', 'vault.bitwarden.com', '1password.com', 'lastpass.com',
  'accountscenter.facebook.com', 'accountscenter.instagram.com',
  // Payments
  'paypal.com', 'dashboard.stripe.com', 'wise.com', 'venmo.com', 'cash.app', 'alipay.com', 'pay.weixin.qq.com',
];

/** Paths that are sensitive on any site. */
const SENSITIVE_PATHS = [
  // Account security, keys and tokens, connected apps
  /\/settings\/(?:security|tokens|personal-access-tokens|keys|ssh|gpg|apps|applications|installations|developers|connections|authorizations|password|emails?|two[_-]factor|2fa|admin|billing)(?:\/|$)/i,
  /\/(?:api[-_]?keys?|access[-_]?tokens?|personal[-_]access[-_]tokens?|security|two[-_]factor|2fa|mfa)(?:\/|$)/i,
  // OAuth consent and device sign-in
  /\/(?:oauth2?|login\/oauth|o\/oauth2|connect|auth)\/(?:authorize|consent|auth)(?:\/|$)/i,
  /^\/(?:login\/device|device|devicelogin|activate)\/?$/i,
];

/** Repository and organization settings on code hosts (deploy keys, secrets, collaborators). */
const CODE_HOST_SETTINGS = /^\/[^/]+(?:\/[^/]+)?\/(?:settings|-\/settings)(?:\/|$)/i;
const CODE_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'gitee.com'];

function underSite(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

export function isSensitivePage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (SENSITIVE_SITES.some((site) => underSite(host, site))) return true;
  if (CODE_HOSTS.some((site) => underSite(host, site)) && CODE_HOST_SETTINGS.test(parsed.pathname)) return true;
  return SENSITIVE_PATHS.some((pattern) => pattern.test(parsed.pathname));
}
