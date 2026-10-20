/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../../../shared/i18n';
import { activityDetailForLocale, activityTextForLocale, zhTW, zhTwActivityText } from './zh-TW';

describe('TaskFlow zh-TW Habblaud locale', () => {
  it('translates settings/help anchor labels and explanations in Taiwanese Traditional Chinese', () => {
    const keys = [
      'Configurações', 'Mostrar nomes', 'Etiqueta com o nome acima de cada personagem.',
      'Modo demonstração', 'Coloca agentes fictícios no escritório, junto com os reais.',
      'Ciclo dia/noite', 'Como ler o escritório', 'Arraste o escritório para mover a câmera e use a rolagem do mouse (ou pinça) para dar zoom.',
      'GitHub no escritório', 'Contas e uso', 'Abrir ou fechar o feed de atividade',
      'Sair deste aparelho', 'Este navegador não oferece notificações.',
    ];
    for (const key of keys) {
      expect(zhTW[key], `missing zh-TW translation: ${key}`).toBeTruthy();
      expect(zhTW[key]).not.toBe(key);
    }
  });

  it('shows native agent event kinds in Traditional Chinese and keeps names/tools separate', () => {
    expect(zhTwActivityText({ id: 'activity-1', kind: 'edit', tool: 'Edit' })).toBe('正在編輯程式碼｜Edit');
    expect(zhTwActivityText({ id: 'activity-2', kind: 'test' })).toBe('正在執行測試');
    expect(zhTwActivityText({ id: 'social:fixture-1', kind: 'other', tool: 'Social' })).toBe('虛擬角色生活互動');
  });

  it('keeps Settings, Help, navigation, activity, search, and empty-state labels covered by zh-TW', () => {
    const ui = resolve(fileURLToPath(new URL('.', import.meta.url)), '../ui');
    const files = [
      'settings.ts', 'settings-sound.ts', 'help.ts', 'topbar.ts', 'sidebar.ts', 'history.ts',
      'widgets.ts', 'feed.ts', 'overlays.ts', 'notify.ts',
    ];
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(resolve(ui, file), 'utf8');
      const keys = [...source.matchAll(/\btr\(\s*(['"])(.*?)\1/g)].map((match) => match[2].replace(/\\n/g, '\n'));
      for (const key of keys) {
        if (!zhTW[key] || zhTW[key] === key) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing, 'visible core UI translations missing from zh-TW').toEqual([]);
  });

  it('localizes only activity summaries in zh-TW and does not expose untranslated detail strings', () => {
    const original = getLocale();
    setLocale('zh-TW');
    const activity = { id: 'evt-1', kind: 'test' as const, icon: '✓', text: 'Rodando testes', detail: 'Executando npm test', at: 1 };
    expect(activityTextForLocale(activity)).toBe('正在執行測試');
    expect(activityDetailForLocale(activity)).toBeUndefined();
    setLocale('en');
    expect(activityTextForLocale(activity)).toBe('Rodando testes');
    expect(activityDetailForLocale(activity)).toBe('Executando npm test');
    setLocale(original);
  });
});
