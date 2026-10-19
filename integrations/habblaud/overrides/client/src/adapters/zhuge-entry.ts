import type { OfficeSnapshot } from '../../../shared/types';
import type { OfficeStore, EventSourceLike } from '../net/store';
import type { WorldApi } from '../world/api';
import { fallbackProjectStatus, syncAiOsStatus, toOfficeSnapshot, type ZhugeProjectStatus } from './zhuge-bridge';
import { isP3RoleId, p3AgentId, toP3OfficeSnapshot } from './zhuge-p3-bridge';
import { mountZhugeHud, showZhugeDecisions, showZhugeRole } from '../ui/zhuge-hud';

/** Habblaud-compatible SSE facade. Static JSON is read every 15s, and real CLI SSE is merged if present. */
class ZhugeStream implements EventSourceLike {
  private listeners = new Map<string, Set<(e: Event) => void>>();
  private live: OfficeSnapshot | null = null;
  private status: ZhugeProjectStatus = fallbackProjectStatus();
  private native: EventSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private rev = 0;
  private readonly startedAt = Date.now();
  readyState = 0;
  constructor(private url: string) { void Promise.resolve().then(() => this.start()); }
  addEventListener(type: string, handler: (e: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }
  private emit(type: string, payload?: unknown): void {
    if (this.closed) return;
    const event = payload === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(payload) });
    this.listeners.get(type)?.forEach(fn => fn(event));
  }
  private publish(): void {
    this.emit('snapshot', toOfficeSnapshot(this.status, this.live, ++this.rev, Date.now(), this.startedAt));
    mountZhugeHud(this.status, !!this.live);
  }
  private async refresh(): Promise<void> {
    await syncAiOsStatus('../status/project-status.json', status => {
      this.status = status;
      this.publish();
    });
  }
  private async start(): Promise<void> {
    // No cross-origin CLI access or credentials in the public static build.
    try {
      const response = await fetch('/api/snapshot', {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(1600),
      });
      if (response.ok) {
        const candidate: OfficeSnapshot = await response.json();
        if (Array.isArray(candidate.rooms) && Array.isArray(candidate.agents) && candidate.meta) {
          this.live = candidate;
          this.native = new EventSource(this.url);
          this.native.addEventListener('snapshot', event => {
            try {
              const v: OfficeSnapshot = JSON.parse((event as MessageEvent).data);
              if (Array.isArray(v.rooms) && Array.isArray(v.agents)) { this.live = v; this.publish(); }
            } catch { /* Bad SSE event is ignored. */ }
          });
          for (const name of ['feed', 'notice']) {
            this.native.addEventListener(name, event => {
              try { this.emit(name, JSON.parse((event as MessageEvent).data)); } catch { /* ignore */ }
            });
          }
          this.native.addEventListener('error', () => {
            if (this.native?.readyState === EventSource.CLOSED) {
              this.live = null;
              this.publish();
            }
          });
        }
      }
    } catch { /* GitHub Pages is expected to have no CLI backend. */ }
    if (this.closed) return;
    this.readyState = 1;
    this.emit('open');
    this.publish();
    await this.refresh();
    if (!this.closed) this.timer = setInterval(() => { void this.refresh(); }, 15_000);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
    this.native?.close();
    if (this.timer) clearInterval(this.timer);
    this.listeners.clear();
  }
}
let lastStream: ZhugeStream | null = null;
export function createZhugeStream(url: string): EventSourceLike {
  lastStream?.close();
  lastStream = new ZhugeStream(url);
  return lastStream;
}

/** Local, decorative P3 stream. It never requests TaskFlow, Supabase, or a status endpoint. */
class P3DisplayStream implements EventSourceLike {
  private listeners = new Map<string, Set<(e: Event) => void>>();
  private closed = false;
  private rev = 0;
  private readonly startedAt = Date.now();
  readyState = 0;
  constructor() { queueMicrotask(() => this.start()); }
  addEventListener(type: string, handler: (e: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }
  private emit(type: string, payload?: unknown): void {
    if (this.closed) return;
    const event = payload === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(payload) });
    this.listeners.get(type)?.forEach(fn => fn(event));
  }
  private start(): void {
    if (this.closed) return;
    this.readyState = 1;
    this.emit('open');
    this.emit('snapshot', toP3OfficeSnapshot(++this.rev, Date.now(), this.startedAt));
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
    this.listeners.clear();
  }
}

export function createP3DisplayStream(_url: string): EventSourceLike {
  return new P3DisplayStream();
}

export function bootAiOsPixelHomepage(store: OfficeStore, world: WorldApi): void {
  const isP3 = new URLSearchParams(location.search).get('p3') === '1';
  if (isP3) {
    // The preview outer shell owns navigation/details. Hide native Habblaud controls
    // but keep its original canvas, simulation, furniture, pathfinding and selection.
    const ui = document.getElementById('ui');
    if (ui) ui.hidden = true;
    world.setOptions({ followSelected: false, theme: 'none' });
    let framed = false;
    store.on('snapshot', snap => {
      if (framed || snap.meta.version !== 'Zhuge Pixel P3') return;
      framed = true;
      world.overview();
    });
    world.onSelect(sel => {
      if (sel?.type !== 'agent' || !window.parent || window.parent === window) return;
      const roleId = sel.id.startsWith('p3-role-') ? sel.id.slice('p3-role-'.length) : '';
      if (!isP3RoleId(roleId) || window.location.origin === 'null') return;
      window.parent.postMessage({ type: 'p3:agent-selected', roleId }, window.location.origin);
    });
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      if (event.data?.type !== 'p3:select-agent' || !isP3RoleId(event.data.roleId)) return;
      world.select({ type: 'agent', id: p3AgentId(event.data.roleId) }, { focus: true });
    });
    return;
  }

  world.onSelect(sel => {
    if (sel?.type !== 'agent') return;
    if (sel.id.startsWith('zhuge-crew-')) showZhugeRole(sel.id);
    else if (sel.id.startsWith('zhuge-')) showZhugeDecisions();
  });
}
