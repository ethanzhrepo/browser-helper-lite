import type { TargetInfo } from './page/types';

/**
 * Forums and social media. The assistant goes there for the user, to look
 * things up: in the user's browser, signed in as them, at a person's pace.
 * So these sites get three rules of their own (see runtime.ts):
 * - their pages are opened in the tab, where the user sees them, and never
 *   read side by side in the background (research_pages, read_url);
 * - a request looks at a limited number of pages on one of them;
 * - anything that acts in the user's name there (a like, a vote, a follow, a
 *   post) waits for the user, whatever the mode.
 */
export const DEFAULT_SOCIAL_SITES: readonly string[] = [
  'reddit.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'facebook.com',
  'instagram.com',
  'threads.net',
  'tiktok.com',
  'linkedin.com',
  'pinterest.com',
  'quora.com',
  'tumblr.com',
  'bsky.app',
  'mastodon.social',
  'news.ycombinator.com',
  'weibo.com',
  'weibo.cn',
  'zhihu.com',
  'xiaohongshu.com',
  'bilibili.com',
  'douyin.com',
  'douban.com',
  'tieba.baidu.com',
  'smzdm.com',
  'v2ex.com',
  'hupu.com',
  'coolapk.com',
  'nga.cn',
  'mobile01.com',
  'ptt.cc',
  'lihkg.com',
  '5ch.net',
  'ppomppu.co.kr',
  'clien.net',
  'redflagdeals.com',
  'hotukdeals.com',
  'mydealz.de',
  'dealabs.com',
  'chollometro.com',
  'ozbargain.com.au',
];

/** How many different pages of one social site a request looks at, unless the user chose another number. */
export const DEFAULT_SOCIAL_PAGES = 8;
export const MAX_SOCIAL_PAGES = 100;
export const MAX_SOCIAL_SITES = 200;

/**
 * The user's changes to the rules (Settings, Site access): sites added to
 * the list that comes with the extension, sites taken off it, and the number
 * of pages. Kept as changes, so a site added to the list by a later version
 * reaches those who edited theirs.
 */
export interface SocialSettings {
  added: string[];
  removed: string[];
  pages: number;
}

export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = { added: [], removed: [], pages: DEFAULT_SOCIAL_PAGES };

/** "https://www.Example.com/r/x" → "example.com"; '' when it is not a site's name. */
export function socialHost(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.replace(/\.+$/, '').replace(/^(\*\.|www\.)/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
  } catch {
    return '';
  }
}

/** The sites the rules apply to: the list that comes with the extension, with the user's changes. */
export function socialSites(settings: SocialSettings = DEFAULT_SOCIAL_SETTINGS): string[] {
  const removed = new Set(settings.removed);
  return [...new Set([...DEFAULT_SOCIAL_SITES.filter((site) => !removed.has(site)), ...settings.added])].sort();
}

export function socialPages(settings: SocialSettings = DEFAULT_SOCIAL_SETTINGS): number {
  const pages = Math.round(Number(settings.pages));
  return Number.isFinite(pages) ? Math.min(Math.max(pages, 1), MAX_SOCIAL_PAGES) : DEFAULT_SOCIAL_PAGES;
}

/** The settings with a site put on the list. */
export function withSocialSite(settings: SocialSettings, input: string): SocialSettings {
  const site = socialHost(input);
  if (!site || socialSites(settings).length >= MAX_SOCIAL_SITES) return settings;
  const removed = settings.removed.filter((other) => other !== site);
  return { ...settings, removed, added: DEFAULT_SOCIAL_SITES.includes(site) ? settings.added : [...new Set([...settings.added, site])] };
}

/** The settings with a site taken off the list. */
export function withoutSocialSite(settings: SocialSettings, site: string): SocialSettings {
  const added = settings.added.filter((other) => other !== site);
  return { ...settings, added, removed: DEFAULT_SOCIAL_SITES.includes(site) ? [...new Set([...settings.removed, site])] : settings.removed };
}

/** The social site a host belongs to, if it is one of `sites`. */
export function socialSite(host: string, sites: readonly string[] = DEFAULT_SOCIAL_SITES): string | undefined {
  const name = host.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
  return sites.find((site) => name === site || name.endsWith(`.${site}`));
}

const ACT_WORDS = [
  'like',
  'unlike',
  'upvote',
  'downvote',
  'vote',
  'repost',
  'retweet',
  'follow',
  'unfollow',
  'subscribe',
  'unsubscribe',
  'join',
  'message',
  'block',
  'mute',
  'report',
  "j'aime",
  'suivre',
  'republier',
  "s'abonner",
  'signaler',
  'me gusta',
  'seguir',
  'repostear',
  'suscribirse',
  'denunciar',
];
const ACT_ZH = ['点赞', '赞同', '喜欢', '收藏', '转发', '投票', '投币', '私信', '关注', '拉黑', '举报', '一键三连'];
const ACT = new RegExp(`(?:^|[^\\p{L}])(?:${ACT_WORDS.map((word) => word.replace(/ /g, '\\s+')).join('|')})(?:$|[^\\p{L}])`, 'iu');
/** A control's label is short; a sentence that happens to hold one of the words is not a control for it. */
const LABEL_CHARS = 40;

/** A control that acts in the user's name on a social site: a like, a vote, a follow, a repost, a message. */
export function isSocialAct(target: TargetInfo): boolean {
  const label = [target.text, target.ariaLabel].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!label || label.length > LABEL_CHARS) return false;
  return ACT.test(label) || ACT_ZH.some((word) => label.includes(word));
}

/** What the model is told when it asks to read a social site's page in the background. */
export const SOCIAL_IN_TAB = 'a forum or social site: open it in the tab (navigate or open_tab) and read it there, a few posts at most';

export function socialLimitNote(site: string, pages: number): string {
  return `You have looked at ${pages} pages on ${site} in this request, which is the limit for a forum or social site. Do not open more pages there: report what you found. The user can ask you to look further.`;
}
