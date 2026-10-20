import type { Locale } from '../i18n';
import { WORLD_LOCALES, type WorldLocale } from './protocol';

/** Keep local UI language independent from the Habblaud World wire locale set. */
export function toWorldLocale(locale: Locale): WorldLocale {
  return (WORLD_LOCALES as readonly string[]).includes(locale) ? locale as WorldLocale : 'en';
}
