import { describe, expect, it, vi } from 'vitest';
import {
  createWeatherAdapter,
  toWeatherVisualContract,
  unknownWeatherState,
  WEATHER_CITIES,
  type WeatherGateway,
} from './zhuge-weather';

const NOW = Date.parse('2026-10-19T08:05:00.000Z');
const freshTaipei = {
  contract: 'zhuge-weather-v1', city: WEATHER_CITIES[0], condition: 'rainy', temperatureC: 24.2, precipitationMm: 1.5,
  precipitationObservedAt: '2026-10-19T08:00:00.000Z', precipitationSourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0002-001?format=JSON',
  strongWind: { status: 'none', source: 'CWA', sourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-006?format=JSON', observedAt: '2026-10-19T08:00:00.000Z', freshness: 'fresh' },
  typhoonWarning: { status: 'unknown', source: 'CWA', sourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-001?format=JSON', observedAt: '', freshness: 'unknown' },
  observedAt: '2026-10-19T08:00:00.000Z', fetchedAt: new Date(NOW).toISOString(), source: 'CWA',
  sourceUrl: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?format=JSON', freshness: 'fresh', errorCode: '',
} as const;

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('P2 #73 real weather read contract', () => {
  it('defaults to Taipei and exposes only a fail-closed unknown state without Shared Gateway', async () => {
    const storage = new MemoryStorage();
    const gateway = vi.fn(() => null);
    const adapter = createWeatherAdapter({ getGateway: gateway, storage, now: () => NOW });
    expect(adapter.getCity().id).toBe('taipei');
    expect(WEATHER_CITIES.length).toBeGreaterThanOrEqual(20);
    await adapter.refresh();
    expect(adapter.getState().condition).toBe('unknown');
    expect(adapter.getState().errorCode).toBe('SHARED_GATEWAY_UNAVAILABLE');
    expect(gateway).toHaveBeenCalledOnce();
  });

  it('selects a city manually, persists it, and calls only the authenticated read-only gateway operation', async () => {
    const storage = new MemoryStorage();
    const invokeFunction = vi.fn(async (_name: string, _body: Record<string, unknown>) => ({ ...freshTaipei, city: WEATHER_CITIES[1], condition: 'cloudy' }));
    const gateway: WeatherGateway = { invokeFunction };
    const adapter = createWeatherAdapter({ getGateway: () => gateway, storage, now: () => NOW });
    adapter.selectCity('newTaipei');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(adapter.getCity().id).toBe('newTaipei');
    expect(adapter.getState().condition).toBe('cloudy');
    expect(storage.getItem('zhuge-pixel-weather-city-v1')).toBe('newTaipei');
    expect(invokeFunction).toHaveBeenCalledWith('zhuge-skyeye-read', { operation: 'weather', city_id: 'newTaipei' });
    expect(JSON.stringify(invokeFunction.mock.calls)).not.toMatch(/authorization|access_token|api_key/i);
  });

  it('does not invent sunny weather on network, auth, invalid-response, or stale failures', async () => {
    const storage = new MemoryStorage();
    const failed = createWeatherAdapter({
      getGateway: () => ({ invokeFunction: async () => { throw Object.assign(new Error('denied'), { code: 'AUTH_REQUIRED' }); } }), storage, now: () => NOW,
    });
    await failed.refresh();
    expect(failed.getState().condition).toBe('unknown');
    expect(failed.getState().errorCode).toBe('AUTH_REQUIRED');

    const stale = toWeatherVisualContract({ ...freshTaipei, freshness: 'stale', condition: 'sunny' }, NOW);
    expect(stale.condition).toBe('unknown');
    expect(stale.precipitation).toBe('unknown');
  });

  it('uses Taipei timezone and an explicit explainable solar approximation across midnight', () => {
    const base = unknownWeatherState(WEATHER_CITIES[0], NOW);
    const midday = toWeatherVisualContract(base, Date.parse('2026-10-19T04:00:00.000Z')); // 12:00 Asia/Taipei
    const midnight = toWeatherVisualContract(base, Date.parse('2026-10-18T16:00:00.000Z')); // 00:00 Asia/Taipei
    expect(midday.dayNight).toBe('day');
    expect(midnight.dayNight).toBe('night');
    expect(midday.sun.method).toBe('solar_approximation');
    expect(midday.sun.timezone).toBe('Asia/Taipei');
    expect(midday.condition).toBe('unknown');
  });

  it('survives blocked localStorage without inventing a city or weather result', async () => {
    const blockedStorage = {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
    };
    const adapter = createWeatherAdapter({ getGateway: () => null, storage: blockedStorage, now: () => NOW });
    await adapter.refresh();
    expect(adapter.getCity().id).toBe('taipei');
    expect(adapter.getState().condition).toBe('unknown');
    expect(adapter.getState().errorCode).toBe('SHARED_GATEWAY_UNAVAILABLE');
  });
});
