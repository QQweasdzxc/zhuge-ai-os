import { describe, expect, it } from 'vitest';
import { LOCALES } from '../i18n';
import { WORLD_LOCALES } from './protocol';
import { toWorldLocale } from './locale';

describe('local UI to Habblaud World locale boundary', () => {
  it('preserves supported protocol locales and maps local-only zh-TW to English', () => {
    for (const locale of WORLD_LOCALES) expect(toWorldLocale(locale)).toBe(locale);
    expect(LOCALES.map((locale) => locale.id)).toContain('zh-TW');
    expect(toWorldLocale('zh-TW')).toBe('en');
  });
});
