/* Zhuge AI OS Storage Migration (TASK-001)
 *
 * Browser storage is an operational cache only.  Migrations are versioned,
 * scoped to approved key prefixes, and never call localStorage.clear().
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeStorageMigration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_SCHEMA_VERSION = 2;

  function storageAdapter(storage) {
    const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    return {
      get(key) { try { return target?.getItem(key) ?? null; } catch { return null; } },
      set(key, value) { try { target?.setItem(key, String(value)); } catch { /* cache is optional */ } },
      remove(key) { try { target?.removeItem(key); } catch { /* cache is optional */ } },
      keys() {
        try { return target ? Array.from({ length: target.length }, (_, i) => target.key(i)).filter(Boolean) : []; }
        catch { return []; }
      }
    };
  }

  function readVersion(adapter, key) {
    const parsed = Number.parseInt(adapter.get(key) || "0", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function run(options = {}) {
    const adapter = storageAdapter(options.storage);
    const versionKey = String(options.versionKey || "zhuge_storage_schema_version");
    const targetVersion = Number(options.targetVersion || STORAGE_SCHEMA_VERSION);
    const migrations = options.migrations || {};
    const allowedPrefixes = Array.isArray(options.allowedPrefixes) ? options.allowedPrefixes.map(String) : [];
    let version = readVersion(adapter, versionKey);
    const applied = [];
    while (version < targetVersion) {
      const nextVersion = version + 1;
      const migrate = migrations[nextVersion];
      if (typeof migrate === "function") migrate({ storage: adapter, allowedPrefixes, from: version, to: nextVersion });
      version = nextVersion;
      applied.push(version);
      adapter.set(versionKey, version);
    }
    return Object.freeze({ version, applied, allowedPrefixes });
  }

  function migrateLegacyKey(options = {}) {
    const adapter = storageAdapter(options.storage);
    const from = String(options.from || "");
    const to = String(options.to || "");
    const prefixes = Array.isArray(options.allowedPrefixes) ? options.allowedPrefixes.map(String) : [];
    if (!from || !to || !prefixes.some(prefix => from.startsWith(prefix) || to.startsWith(prefix))) return false;
    const value = adapter.get(from);
    if (value === null || adapter.get(to) !== null) return false;
    adapter.set(to, value);
    adapter.remove(from);
    return true;
  }

  return Object.freeze({ STORAGE_SCHEMA_VERSION, storageAdapter, run, migrateLegacyKey });
});
