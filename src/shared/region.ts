/**
 * Where the user is, for prices, shops, delivery and availability: the
 * country chosen in Settings › Language, or with "Automatic" the country of
 * the user's IP address (see ip-region.ts), or nothing when the user chose
 * not to say or the address could not be placed. Never guessed from the
 * browser's language, which says what the user reads, not where they are.
 * It goes to the model provider with each request, as one line of the
 * system prompt.
 */
export type RegionSetting = 'auto' | 'none' | string;

/** ISO 3166-1 alpha-2. */
export const REGION_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

const KNOWN = new Set(REGION_CODES);

export const isRegionCode = (code: unknown): code is string => typeof code === 'string' && KNOWN.has(code);

/** The country of the user's IP address, when it was looked up. */
export interface IpRegion {
  code: string;
  at: number;
}

export interface UserRegion {
  code: string;
  /** Chosen in the settings, or the country of the IP address (a VPN or a trip abroad moves it). */
  source: 'chosen' | 'ip';
}

/** Where the user is, as the model is told: undefined when the user chose not to say, or nothing is known. */
export function userRegion(setting: RegionSetting | undefined, fromIp?: IpRegion): UserRegion | undefined {
  if (setting === 'none') return undefined;
  if (setting && setting !== 'auto' && isRegionCode(setting)) return { code: setting, source: 'chosen' };
  return fromIp && isRegionCode(fromIp.code) ? { code: fromIp.code, source: 'ip' } : undefined;
}

/** A region's name in a language ("CN" → "China", "中国"). */
export function regionName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
