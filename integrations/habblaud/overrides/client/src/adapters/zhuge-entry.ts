import type { OfficeSnapshot } from '../../../shared/types';
import type { OfficeStore, EventSourceLike } from '../net/store';
import type { WorldApi } from '../world/api';
import { fallbackProjectStatus, syncAiOsStatus, toOfficeSnapshot, verifiedHabblaudSnapshot, type ZhugeProjectStatus } from './zhuge-bridge';
import { mountZhugeHud, showZhugeDecisions, showZhugeRole, showZhugeStatus } from '../ui/zhuge-hud';

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
    const now = Date.now();
    const connected = verifiedHabblaudSnapshot(this.live, this.native?.readyState === EventSource.OPEN, now);
    this.emit('snapshot', toOfficeSnapshot(this.status, this.live, ++this.rev, now, this.startedAt,
      this.native?.readyState === EventSource.OPEN));
    mountZhugeHud(this.status, !!connected);
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
          this.native.addEventListener('open', () => this.publish());
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
export function bootAiOsPixelHomepage(_store: OfficeStore, world: WorldApi): void {
  world.onSelect(sel => {
    if (sel?.type !== 'agent') return;
    if (sel.id.startsWith('zhuge-crew-')) showZhugeRole(sel.id);
    else if (sel.id.startsWith('zhuge-')) showZhugeDecisions();
  });
}
