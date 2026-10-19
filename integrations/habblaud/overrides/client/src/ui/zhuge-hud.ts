import type { ZhugeProjectStatus } from '../adapters/zhuge-bridge';
import { isFreshStatus, ZHUGE_CAST } from '../adapters/zhuge-bridge';
import { WEATHER_CITIES, toWeatherVisualContract, type WeatherCity, type WeatherState } from '../adapters/zhuge-weather';
import './zhuge-hud.css';

let current: ZhugeProjectStatus | null = null;
let currentLive = false;
let weatherAdapter: {
  getCity(): WeatherCity;
  getState(): WeatherState;
  selectCity(cityId: string): void;
  subscribe(listener: (state: WeatherState) => void): () => void;
} | null = null;
let stopWeatherSubscription: (() => void) | null = null;
function el(tag: string, value = ''): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = value;
  return e;
}
export function showZhugeDecisions(): void {
  if (!current) return;
  let panel = document.getElementById('zhuge-decision-panel');
  if (!panel) {
    panel = el('aside');
    panel.id = 'zhuge-decision-panel';
    document.body.append(panel);
  }
  panel.replaceChildren();
  const heading = el('h2', '待裁示事項');
  const close = el('button', '關閉') as HTMLButtonElement;
  close.onclick = () => { if (panel) panel.hidden = true; };
  panel.append(heading, close);
  for (const blocked of current.blocked_items || []) {
    const item = el('article');
    item.append(el('strong', blocked.title), el('p', blocked.reason));
    panel.append(item);
  }
  if (!current.blocked_items?.length) panel.append(el('p', '目前沒有待裁示紀錄。'));
  panel.append(el('h3', '下一步'));
  const list = el('ol');
  for (const action of current.next_actions || [])
    list.append(el('li', action.title + (action.assignee ? '（' + action.assignee + '）' : '')));
  panel.append(list);
  panel.hidden = false;
}
/** Static modules and PRs remain a read-only project summary, never scene people. */
export function showZhugeStatus(): void {
  if (!current) return;
  let panel = document.getElementById('zhuge-decision-panel');
  if (!panel) {
    panel = el('aside');
    panel.id = 'zhuge-decision-panel';
    document.body.append(panel);
  }
  panel.replaceChildren();
  const close = el('button', '關閉') as HTMLButtonElement;
  close.setAttribute('type', 'button');
  close.onclick = () => { if (panel) panel.hidden = true; };
  const updated = Date.parse(current.updated_at);
  const freshness = isFreshStatus(current) ? '快照仍在有效時間內' : '快照已過期';
  const observed = Number.isFinite(updated) ? new Date(updated).toLocaleString('zh-TW') : '時間無效';
  panel.append(el('h2', '專案狀態｜唯讀快照'), close,
    el('p', current.project_name + '｜' + current.overall_status),
    el('p', '最後更新：' + observed + '｜' + freshness),
    el('p', '來源：status/project-status.json。這是靜態專案紀錄，不代表任何人或 AI 正在工作。'),
    el('p', current.summary || '尚無摘要。'));
  panel.append(el('h3', '模組資訊'));
  if (current.active_modules.length) {
    const modules = el('ul');
    for (const item of current.active_modules) {
      const row = el('li', item.name + '｜' + item.status + (item.description ? '｜' + item.description : ''));
      modules.append(row);
    }
    panel.append(modules);
  } else panel.append(el('p', '尚無模組快照。'));
  panel.append(el('h3', 'GitHub PR 紀錄'));
  if (current.recent_prs.length) {
    const prs = el('ul');
    for (const item of current.recent_prs) {
      const row = el('li');
      row.append(el('span', item.id + '｜' + item.title + '｜' + item.status));
      if (item.url && /^https:\/\/github\.com\//.test(item.url)) {
        const link = el('a', ' 開啟 GitHub');
        (link as HTMLAnchorElement).href = item.url;
        (link as HTMLAnchorElement).target = '_blank';
        (link as HTMLAnchorElement).rel = 'noopener noreferrer';
        row.append(link);
      }
      prs.append(row);
    }
    panel.append(prs);
  } else panel.append(el('p', '尚無 PR 紀錄。'));
  panel.hidden = false;
}
/** Accessible roster uses the existing modal; it never overrides runtime status. */
export function showZhugeRole(agentId: string): void {
  const role = ZHUGE_CAST.find(candidate => candidate.id === agentId);
  if (!role) return;
  let panel = document.getElementById('zhuge-decision-panel');
  if (!panel) {
    panel = el('aside');
    panel.id = 'zhuge-decision-panel';
    document.body.append(panel);
  }
  panel.replaceChildren();
  const title = el('h2', '固定角色 · 角色介紹');
  const close = el('button', '關閉');
  close.setAttribute('type', 'button');
  close.onclick = () => { if (panel) panel.hidden = true; };
  const roster = el('nav');
  roster.className = 'zhuge-role-roster';
  roster.setAttribute('aria-label', '切換辦公室角色');
  for (const person of ZHUGE_CAST) {
    const item = el('button', person.name);
    item.setAttribute('type', 'button');
    item.setAttribute('aria-pressed', String(person.id === agentId));
    item.onclick = () => showZhugeRole(person.id);
    roster.append(item);
  }
  const name = el('h3', role.name + '｜' + role.duty);
  const content = el('p', role.intro);
  const status = el('p', '目前呈現：角色待命（場景裝飾）');
  status.className = 'zhuge-role-label';
  const truth = el('p', '資料說明：固定像素角色不是真人位置或 Provider Session，也不代表 AI 正在工作。即時工程狀態只在可信來源驗證成功時顯示。');
  truth.className = 'zhuge-role-provenance';
  panel.append(title, close, roster, name, content, status, truth);
  panel.hidden = false;
}

function readableWeather(state: WeatherState): string {
  if (state.freshness !== 'fresh' || state.condition === 'unknown') return '尚無可驗證的最新天氣狀態';
  return ({ sunny: '晴', cloudy: '陰／多雲', rainy: '雨', unknown: '尚無可驗證的最新天氣狀態' } as const)[state.condition];
}

function renderWeatherPanel(): void {
  if (!weatherAdapter) return;
  let panel = document.getElementById('zhuge-weather-panel');
  if (!panel) {
    panel = el('aside');
    panel.id = 'zhuge-weather-panel';
    document.body.append(panel);
  }
  const wasOpen = !panel.hidden;
  const state = weatherAdapter.getState();
  const city = weatherAdapter.getCity();
  const visual = toWeatherVisualContract(state);
  panel.replaceChildren();
  panel.hidden = !wasOpen;
  const heading = el('h2', '像素辦公室環境｜唯讀資料');
  const close = el('button', '關閉') as HTMLButtonElement;
  close.type = 'button';
  close.addEventListener('click', () => { if (panel) panel.hidden = true; });
  const label = el('label', '觀察城市') as HTMLLabelElement;
  label.htmlFor = 'zhuge-weather-city';
  const select = document.createElement('select');
  select.id = 'zhuge-weather-city';
  select.setAttribute('aria-label', '觀察城市');
  for (const item of WEATHER_CITIES) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    option.selected = item.id === city.id;
    select.append(option);
  }
  select.addEventListener('change', () => {
    weatherAdapter?.selectCity(select.value);
    // Keep the city/source label in sync even if an asynchronous gateway
    // refresh is still resolving for the previous selection.
    renderWeatherPanel();
  });
  const freshness = state.freshness === 'fresh' ? '資料有效' : state.freshness === 'stale' ? '資料已過期' : '尚未取得資料';
  const conditionText = state.freshness === 'stale' ? '資料無法更新；目前天氣未知。' : readableWeather(state);
  const temperature = visual.temperatureC === null ? '氣溫未知' : `氣溫 ${visual.temperatureC.toFixed(1)}°C`;
  const precipitation = visual.precipitationMm === null ? '降水未知' : `近 10 分鐘降水 ${visual.precipitationMm.toFixed(1)} mm`;
  const observed = Date.parse(state.observedAt);
  const fetched = Date.parse(state.fetchedAt);
  const observedText = Number.isFinite(observed) ? new Date(observed).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '無觀測時間';
  const fetchedText = Number.isFinite(fetched) ? new Date(fetched).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚未取得';
  const warning = state.typhoonWarning.status === 'active' && state.freshness === 'fresh'
    ? 'CWA 官方資料顯示颱風警報發布中。'
    : state.typhoonWarning.status === 'none' && state.freshness === 'fresh'
      ? 'CWA 官方資料未列出目前颱風警報。'
      : '颱風警報狀態未知；不以雨勢推斷。';
  const wind = state.strongWind.status === 'active' && state.freshness === 'fresh'
    ? 'CWA 官方陸上強風特報發布中。'
    : state.strongWind.status === 'none' && state.freshness === 'fresh'
      ? 'CWA 官方資料未列出目前陸上強風特報。'
      : '強風警示狀態未知。';
  panel.append(heading, close, label, select,
    el('p', `${city.name}｜${conditionText}`),
    el('p', `${temperature}｜${precipitation}`),
    el('p', `狀態：${freshness}｜觀測：${observedText}｜讀取：${fetchedText}`),
    el('p', `降水：${visual.precipitation === 'yes' ? '觀測到' : visual.precipitation === 'no' ? '觀測為零' : '未知'}｜${wind}`),
    el('p', warning),
    el('p', `日夜：${visual.dayNight === 'day' ? '白天' : visual.dayNight === 'night' ? '夜間' : '未知'}（${visual.sun.sunriseLocal || '--:--'} 日出／${visual.sun.sunsetLocal || '--:--'} 日落，天文近似，${visual.sun.timezone}）`),
    el('p', `來源：${state.source}｜${state.sourceUrl}`),
    el('p', state.errorCode ? `資料狀態碼：${state.errorCode}` : '只在來源有效且資料新鮮時提供天氣視覺狀態。'));
  panel.hidden = false;
}

export function mountZhugeWeatherControl(adapter: NonNullable<typeof weatherAdapter>): void {
  stopWeatherSubscription?.();
  weatherAdapter = adapter;
  stopWeatherSubscription = adapter.subscribe(state => {
    const visual = toWeatherVisualContract(state);
    document.documentElement.dataset.zhugeWeather = visual.condition;
    document.documentElement.dataset.zhugeDaynight = visual.dayNight;
    window.dispatchEvent(new CustomEvent('zhuge:weather-state', { detail: visual }));
    const panel = document.getElementById('zhuge-weather-panel');
    if (panel && !panel.hidden) renderWeatherPanel();
    if (current) mountZhugeHud(current, currentLive);
  });
}

function weatherLabel(): string {
  if (!weatherAdapter) return '🌦 天氣未知';
  return `🌦 ${weatherAdapter.getCity().name}｜${readableWeather(weatherAdapter.getState())}`;
}

export function mountZhugeHud(status: ZhugeProjectStatus, live = false): void {
  current = status;
  currentLive = live;
  let bar = document.getElementById('zhuge-aios-hud');
  if (!bar) {
    bar = el('header');
    bar.id = 'zhuge-aios-hud';
    document.body.append(bar);
  }
  bar.replaceChildren();
  const fresh = isFreshStatus(status);
  const dot = el('span', '●');
  dot.className = 'zhuge-hud-dot zhuge-light-' + (fresh ? status.overall_status : 'stale');
  const title = el('strong', status.project_name || 'AI OS');
  title.className = 'zhuge-hud-title';
  const phase = el('span', '階段：' + status.current_phase);
  const milestone = el('span', '里程碑：' + status.current_milestone);
  const blocked = el('button', '🙋 ' + (status.blocked_items?.length || 0) + ' 項待裁示');
  blocked.addEventListener('click', () => showZhugeDecisions());
  const project = el('button', '📋 專案狀態');
  project.setAttribute('type', 'button');
  project.addEventListener('click', () => showZhugeStatus());
  const roster = el('button', '👥 人員');
  roster.setAttribute('type', 'button');
  roster.addEventListener('click', () => showZhugeRole(ZHUGE_CAST[0].id));
  const weather = el('button', weatherLabel());
  weather.setAttribute('type', 'button');
  weather.setAttribute('aria-label', '查看唯讀天氣與日夜資料');
  weather.addEventListener('click', () => {
    renderWeatherPanel();
    const panel = document.getElementById('zhuge-weather-panel');
    if (panel) panel.hidden = false;
  });
  const source = el('span', (live ? 'CLI 即時 + ' : '') + (fresh ? '狀態快照' : '過期狀態快照'));
  const classic = el('a', '經典報表');
  (classic as HTMLAnchorElement).href = new URL('../status-classic.html', location.href).href;
  (classic as HTMLAnchorElement).target = '_top';
  // Keep the native HUD actions, but let phone users explore the scene before opening engineering details.
  // Preserve open state when the read-only snapshot refreshes every 15 seconds.
  const menu = el('button', '☰') as HTMLButtonElement;
  menu.className = 'zhuge-hud-menu-toggle';
  menu.type = 'button';
  menu.setAttribute('aria-label', '展開或收合辦公室資訊');
  menu.setAttribute('aria-expanded', String(bar.dataset.open === 'true'));
  menu.addEventListener('click', () => {
    bar.dataset.open = bar.dataset.open === 'true' ? 'false' : 'true';
    menu.setAttribute('aria-expanded', String(bar.dataset.open === 'true'));
  });
  bar.append(dot, title, phase, milestone, blocked, project, roster, weather, source, classic, menu);
}
