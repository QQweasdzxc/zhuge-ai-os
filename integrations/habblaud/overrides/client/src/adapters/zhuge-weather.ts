export type WeatherCondition = 'sunny' | 'cloudy' | 'rainy' | 'unknown';
export type EvidenceFreshness = 'fresh' | 'stale' | 'unknown';
export type AlertStatus = 'active' | 'none' | 'unknown';

export interface WeatherCity {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export const WEATHER_CITIES: readonly WeatherCity[] = Object.freeze([
  { id: 'taipei', name: '臺北市', lat: 25.033, lng: 121.5654 },
  { id: 'newTaipei', name: '新北市', lat: 25.0169, lng: 121.4628 },
  { id: 'keelung', name: '基隆市', lat: 25.1276, lng: 121.7392 },
  { id: 'taoyuan', name: '桃園市', lat: 24.9936, lng: 121.301 },
  { id: 'hsinchu', name: '新竹市', lat: 24.8138, lng: 120.9675 },
  { id: 'hsinchuCounty', name: '新竹縣', lat: 24.8387, lng: 121.0177 },
  { id: 'taichung', name: '臺中市', lat: 24.1477, lng: 120.6736 },
  { id: 'changhua', name: '彰化縣', lat: 24.0518, lng: 120.5161 },
  { id: 'nantou', name: '南投縣', lat: 23.9609, lng: 120.9719 },
  { id: 'yunlin', name: '雲林縣', lat: 23.7092, lng: 120.4313 },
  { id: 'chiayi', name: '嘉義市', lat: 23.4801, lng: 120.4491 },
  { id: 'chiayiCounty', name: '嘉義縣', lat: 23.4589, lng: 120.2919 },
  { id: 'tainan', name: '臺南市', lat: 22.9999, lng: 120.2269 },
  { id: 'kaohsiung', name: '高雄市', lat: 22.6273, lng: 120.3014 },
  { id: 'pingtung', name: '屏東縣', lat: 22.5519, lng: 120.5487 },
  { id: 'yilan', name: '宜蘭縣', lat: 24.7021, lng: 121.7378 },
  { id: 'hualien', name: '花蓮縣', lat: 23.9872, lng: 121.6015 },
  { id: 'taitung', name: '臺東縣', lat: 22.7972, lng: 121.0714 },
  { id: 'penghu', name: '澎湖縣', lat: 23.5711, lng: 119.5793 },
  { id: 'kinmen', name: '金門縣', lat: 24.4493, lng: 118.3767 },
  { id: 'lienchiang', name: '連江縣', lat: 26.1605, lng: 119.9517 },
]);

export interface WeatherState {
  contract: 'zhuge-weather-v1';
  city: WeatherCity;
  condition: WeatherCondition;
  temperatureC: number | null;
  precipitationMm: number | null;
  precipitationObservedAt: string;
  precipitationSourceUrl: string;
  strongWind: { status: AlertStatus; source: string; sourceUrl: string; observedAt: string; freshness: EvidenceFreshness };
  typhoonWarning: { status: AlertStatus; source: string; sourceUrl: string; observedAt: string; freshness: EvidenceFreshness };
  observedAt: string;
  fetchedAt: string;
  source: 'CWA';
  sourceUrl: string;
  freshness: EvidenceFreshness;
  errorCode: string;
}

export interface WeatherVisualContract {
  contract: 'zhuge-weather-visual-v1';
  city: WeatherCity;
  condition: WeatherCondition;
  precipitation: 'yes' | 'no' | 'unknown';
  precipitationMm: number | null;
  temperatureC: number | null;
  strongWind: AlertStatus;
  typhoonWarning: AlertStatus;
  dayNight: 'day' | 'night' | 'unknown';
  sun: { sunriseLocal: string; sunsetLocal: string; method: 'solar_approximation'; timezone: 'Asia/Taipei' };
  observedAt: string;
  fetchedAt: string;
  source: 'CWA' | 'unavailable';
  sourceUrl: string;
  freshness: EvidenceFreshness;
  errorCode: string;
}

export interface WeatherGateway {
  invokeFunction(name: string, body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}
interface WeatherStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SELECTED_CITY_KEY = 'zhuge-pixel-weather-city-v1';
const CACHED_WEATHER_KEY = 'zhuge-pixel-weather-state-v1';
const REQUEST_MIN_INTERVAL_MS = 5 * 60 * 1000;
const CITY_BY_ID = new Map(WEATHER_CITIES.map(city => [city.id, city]));
const CWA_ORIGIN = 'https://opendata.cwa.gov.tw/';

export function unknownWeatherState(city: WeatherCity, now = Date.now(), errorCode = 'WEATHER_UNKNOWN'): WeatherState {
  return {
    contract: 'zhuge-weather-v1', city, condition: 'unknown', temperatureC: null, precipitationMm: null,
    precipitationObservedAt: '', precipitationSourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0002-001?format=JSON',
    strongWind: { status: 'unknown', source: 'CWA 官方陸上強風特報', sourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-006?format=JSON', observedAt: '', freshness: 'unknown' },
    typhoonWarning: { status: 'unknown', source: 'CWA 官方颱風警報', sourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-001?format=JSON', observedAt: '', freshness: 'unknown' },
    observedAt: '', fetchedAt: new Date(now).toISOString(), source: 'CWA', sourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?format=JSON', freshness: 'unknown', errorCode,
  };
}

function partsForTaipei(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value || 0);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}

function solarMinutes(year: number, month: number, day: number, city: WeatherCity) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(year, 0, 0)) / 86400000);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const latitude = city.lat * Math.PI / 180;
  const zenith = 90.833 * Math.PI / 180;
  const cosineHourAngle = Math.cos(zenith) / (Math.cos(latitude) * Math.cos(declination)) - Math.tan(latitude) * Math.tan(declination);
  if (!Number.isFinite(cosineHourAngle) || cosineHourAngle < -1 || cosineHourAngle > 1) return null;
  const hourAngleDegrees = Math.acos(cosineHourAngle) * 180 / Math.PI;
  const sunrise = 720 - 4 * (city.lng + hourAngleDegrees) - equationOfTime + 480;
  const sunset = 720 - 4 * (city.lng - hourAngleDegrees) - equationOfTime + 480;
  return { sunrise: (sunrise + 1440) % 1440, sunset: (sunset + 1440) % 1440 };
}

function displayTime(minutes: number | null): string {
  if (minutes === null) return '';
  const normalized = Math.round(minutes) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function toWeatherVisualContract(state: WeatherState, now = Date.now()): WeatherVisualContract {
  const date = partsForTaipei(now);
  const solar = solarMinutes(date.year, date.month, date.day, state.city);
  const localMinutes = date.hour * 60 + date.minute;
  const inDaylight = solar !== null && localMinutes >= solar.sunrise && localMinutes < solar.sunset;
  const current = state.freshness === 'fresh' ? state.condition : 'unknown';
  return {
    contract: 'zhuge-weather-visual-v1', city: state.city, condition: current,
    precipitation: state.freshness !== 'fresh' || state.precipitationMm === null ? 'unknown' : state.precipitationMm > 0 ? 'yes' : 'no',
    precipitationMm: state.freshness === 'fresh' ? state.precipitationMm : null,
    temperatureC: state.freshness === 'fresh' ? state.temperatureC : null,
    strongWind: state.freshness === 'fresh' ? state.strongWind.status : 'unknown',
    typhoonWarning: state.freshness === 'fresh' ? state.typhoonWarning.status : 'unknown',
    dayNight: solar === null ? 'unknown' : inDaylight ? 'day' : 'night',
    sun: { sunriseLocal: displayTime(solar?.sunrise ?? null), sunsetLocal: displayTime(solar?.sunset ?? null), method: 'solar_approximation', timezone: 'Asia/Taipei' },
    observedAt: state.observedAt, fetchedAt: state.fetchedAt, source: state.freshness === 'unknown' ? 'unavailable' : 'CWA', sourceUrl: state.sourceUrl,
    freshness: state.freshness, errorCode: state.errorCode,
  };
}

function normalizeWeatherResponse(input: unknown, city: WeatherCity, now: number): WeatherState {
  const row = input as Partial<WeatherState> | null;
  const fetched = Date.parse(row?.fetchedAt || '');
  const valid = !!row && row.contract === 'zhuge-weather-v1' && row.city?.id === city.id &&
    row.source === 'CWA' && typeof row.sourceUrl === 'string' && row.sourceUrl.startsWith(CWA_ORIGIN) &&
    typeof row.precipitationObservedAt === 'string' && typeof row.precipitationSourceUrl === 'string' && row.precipitationSourceUrl.startsWith(CWA_ORIGIN) &&
    ['sunny', 'cloudy', 'rainy', 'unknown'].includes(String(row.condition)) &&
    ['fresh', 'stale', 'unknown'].includes(String(row.freshness)) && Number.isFinite(fetched) && fetched <= now + 60_000 &&
    (row.temperatureC === null || (Number.isFinite(row.temperatureC) && row.temperatureC! >= -90 && row.temperatureC! <= 70)) &&
    (row.precipitationMm === null || (Number.isFinite(row.precipitationMm) && row.precipitationMm! >= 0)) &&
    row.strongWind?.source === 'CWA' && typeof row.strongWind.sourceUrl === 'string' && row.strongWind.sourceUrl.startsWith(CWA_ORIGIN) && ['active', 'none', 'unknown'].includes(String(row.strongWind.status)) &&
    row.typhoonWarning?.source === 'CWA' && typeof row.typhoonWarning.sourceUrl === 'string' && row.typhoonWarning.sourceUrl.startsWith(CWA_ORIGIN) && ['active', 'none', 'unknown'].includes(String(row.typhoonWarning.status));
  if (!valid) return unknownWeatherState(city, now, 'WEATHER_RESPONSE_INVALID');
  const stale = now - fetched > 30 * 60 * 1000 || row.freshness === 'stale';
  return {
    ...(row as WeatherState), condition: stale ? 'unknown' : row.condition!,
    temperatureC: stale ? null : Number.isFinite(row.temperatureC) ? row.temperatureC! : null,
    precipitationMm: stale ? null : Number.isFinite(row.precipitationMm) ? row.precipitationMm! : null,
    precipitationObservedAt: stale ? '' : row.precipitationObservedAt!,
    freshness: stale ? 'stale' : row.freshness!, errorCode: stale ? 'CWA_RESPONSE_STALE' : String(row.errorCode || ''),
    strongWind: stale ? { ...row.strongWind!, status: 'unknown' } : row.strongWind!,
    typhoonWarning: stale ? { ...row.typhoonWarning!, status: 'unknown' } : row.typhoonWarning!,
  };
}

function staleCopy(value: WeatherState, now: number, errorCode: string): WeatherState {
  return { ...value, condition: 'unknown', temperatureC: null, precipitationMm: null, freshness: 'stale', errorCode,
    precipitationObservedAt: '',
    strongWind: { ...value.strongWind, status: 'unknown', freshness: 'stale' },
    typhoonWarning: { ...value.typhoonWarning, status: 'unknown', freshness: 'stale' },
    fetchedAt: new Date(now).toISOString() };
}

export function createWeatherAdapter(options: {
  getGateway: () => WeatherGateway | null;
  storage?: WeatherStorage | null;
  now?: () => number;
  minRequestIntervalMs?: number;
}) {
  const storage = options.storage ?? null;
  const nowFn = options.now || Date.now;
  const interval = options.minRequestIntervalMs ?? REQUEST_MIN_INTERVAL_MS;
  let storedCityId = 'taipei';
  try { storedCityId = storage?.getItem(SELECTED_CITY_KEY) || 'taipei'; } catch { /* Private browsing storage is optional. */ }
  let selected = CITY_BY_ID.get(storedCityId) || WEATHER_CITIES[0];
  let state = unknownWeatherState(selected, nowFn(), 'WEATHER_NOT_LOADED');
  const listeners = new Set<(state: WeatherState) => void>();
  const cache = new Map<string, WeatherState>();
  const attempted = new Map<string, number>();
  const inFlight = new Map<string, Promise<WeatherState>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let onlineListener: (() => void) | null = null;
  const notify = () => listeners.forEach(listener => listener(state));

  try {
    const saved = JSON.parse(storage?.getItem(CACHED_WEATHER_KEY) || 'null') as WeatherState | null;
    const savedCity = saved?.city && CITY_BY_ID.get(saved.city.id);
    if (saved && savedCity && saved.contract === 'zhuge-weather-v1' && savedCity.id === selected.id) {
      state = staleCopy({ ...saved, city: savedCity }, nowFn(), 'CACHED_WEATHER_STALE');
      cache.set(savedCity.id, state);
    }
  } catch { /* Storage is best-effort; never use malformed persisted data. */ }

  async function refresh(force = false): Promise<WeatherState> {
    const city = selected;
    const now = nowFn();
    const cached = cache.get(city.id);
    if (!force && cached && cached.freshness === 'fresh' && now - Date.parse(cached.fetchedAt) < interval) {
      state = cached;
      notify();
      return state;
    }
    const running = inFlight.get(city.id);
    if (running) return running;
    if (!force && now - (attempted.get(city.id) || 0) < interval) {
      state = cached ? staleCopy(cached, now, 'WEATHER_REFRESH_THROTTLED') : unknownWeatherState(city, now, 'WEATHER_REFRESH_THROTTLED');
      notify();
      return state;
    }
    attempted.set(city.id, now);
    const task = (async () => {
      const gateway = options.getGateway();
      if (!gateway) throw Object.assign(new Error('Shared Gateway unavailable'), { code: 'SHARED_GATEWAY_UNAVAILABLE' });
      const result = await gateway.invokeFunction('zhuge-skyeye-read', { operation: 'weather', city_id: city.id });
      const normalized = normalizeWeatherResponse(result, city, nowFn());
      cache.set(city.id, normalized);
      try { storage?.setItem(CACHED_WEATHER_KEY, JSON.stringify(normalized)); } catch { /* Cache remains in memory. */ }
      if (selected.id === city.id) { state = normalized; notify(); }
      return normalized;
    })().catch(error => {
      const failedAt = nowFn();
      const failed = cached ? staleCopy(cached, failedAt, String(error?.code || 'WEATHER_REQUEST_FAILED')) : unknownWeatherState(city, failedAt, String(error?.code || 'WEATHER_REQUEST_FAILED'));
      if (selected.id === city.id) { state = failed; notify(); }
      return failed;
    }).finally(() => inFlight.delete(city.id));
    inFlight.set(city.id, task);
    state = cached ? staleCopy(cached, now, 'WEATHER_REFRESHING') : unknownWeatherState(city, now, 'WEATHER_LOADING');
    notify();
    return task;
  }

  function selectCity(cityId: string): void {
    selected = CITY_BY_ID.get(cityId) || WEATHER_CITIES[0];
    try { storage?.setItem(SELECTED_CITY_KEY, selected.id); } catch { /* City remains selected for this session. */ }
    const cached = cache.get(selected.id);
    state = cached && nowFn() - Date.parse(cached.fetchedAt) < interval
      ? cached
      : cached ? staleCopy(cached, nowFn(), 'CACHED_WEATHER_STALE') : unknownWeatherState(selected, nowFn(), 'WEATHER_NOT_LOADED');
    notify();
    void refresh();
  }

  function subscribe(listener: (state: WeatherState) => void): () => void {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  function start(): () => void {
    void refresh();
    timer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh(); }, 10 * 60 * 1000);
    onlineListener = () => { void refresh(true); };
    if (typeof window !== 'undefined') window.addEventListener('online', onlineListener);
    return stop;
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    if (onlineListener && typeof window !== 'undefined') window.removeEventListener('online', onlineListener);
    onlineListener = null;
    listeners.clear();
  }

  return { getCity: () => selected, getState: () => state, refresh, selectCity, subscribe, start, stop };
}
