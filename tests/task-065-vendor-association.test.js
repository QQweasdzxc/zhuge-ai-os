import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function createElement() {
  return {
    disabled: false,
    hidden: false,
    value: "",
    innerHTML: "",
    textContent: "",
    dataset: {},
    listeners: new Map(),
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    querySelector() { return null; },
    focus() {},
    async emit(name, event = {}) { return this.listeners.get(name)?.(event); }
  };
}

async function mountVendorAssociation({ link, vendors, serviceOverride = null }) {
  const selectors = [
    "[data-gas-vendor-association-state]",
    "[data-gas-vendor-search]",
    "[data-gas-vendor-results]",
    "[data-gas-vendor-selected]",
    "[data-gas-vendor-open]",
    "[data-gas-vendor-selector]",
    "[data-gas-vendor-confirm]",
    "[data-gas-vendor-cancel]",
    "[data-gas-vendor-pending]",
    "[data-gas-vendor-view]",
    "[data-gas-vendor-save]",
    "[data-gas-vendor-clear]",
    "[data-gas-vendor-detail]"
  ];
  const elements = new Map(selectors.map(selector => [selector, createElement()]));
  const host = { querySelector: selector => elements.get(selector) || null };
  const container = {
    querySelector: selector => selector === "[data-gas-vendor-association-root]" ? host : null
  };
  let currentLink = link;
  const writes = [];
  const service = serviceOverride || {
    async getTaskVendorLink() { return currentLink; },
    async setTaskVendorLink(taskId, vendorId) {
      writes.push({ taskId, vendorId });
      currentLink = vendorId ? { vendorId } : { vendorId: "" };
      return currentLink;
    }
  };
  class MockVendorSheetService {
    async list() { return vendors; }
  }
  const runtimeWindow = {
    VendorSheetService: { VendorSheetService: MockVendorSheetService },
    setTimeout(callback) { callback?.(); return 0; }
  };
  vm.runInNewContext(read("app/Board/procurement/vendor-task-association.js"), { window: runtimeWindow });
  await runtimeWindow.ZhugeGasVendorAssociation.mount({ container, task: { id: "task-test" }, service });
  return { elements, service, writes, getLink: () => currentLink };
}

test("GAS Vendor Association is a consumer extension over the shared C Drawer", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const service = read("shared/board/board-read-service.js");
  const page = read("app/Board/procurement/index.html");
  const extension = read("app/Board/procurement/vendor-task-association.js");

  assert.match(runtime, /taskDrawerExtensions\(\)/);
  assert.match(runtime, /mountTaskDrawerExtensions/);
  assert.match(runtime, /consumerExtensions: \{ taskDrawer: root\.ZhugeGasVendorAssociation/);
  assert.match(service, /getTaskVendorLink: instanceGetTaskVendorLink/);
  assert.match(service, /setTaskVendorLink: instanceSetTaskVendorLink/);
  assert.match(page, /vendor-task-association\.js/);
  assert.match(extension, /getTaskVendorLink/);
  assert.match(extension, /setTaskVendorLink/);
  assert.match(extension, /new VendorSheetService/);
  assert.match(extension, /查看廠商資料/);
  assert.match(extension, /Google Sheet/);
  assert.doesNotMatch(extension, /\[\s*["']vendorId["']\s*,/i);
});

test("shared board adapter normalizes the vendor-link RPC response for the GAS drawer", () => {
  const source = read("shared/board/board-read-service.js");

  assert.match(source, /function normalizeTaskVendorLink\(row\)/);
  assert.match(source, /vendor_id \?\? source\.vendorId/);
  assert.match(source, /board_instance_get_task_vendor_link[\s\S]*?\.then\(normalizeTaskVendorLink\)/);
  assert.match(source, /board_instance_set_task_vendor_link[\s\S]*?\.then\(normalizeTaskVendorLink\)/);
  assert.match(source, /vendorId,/);
});

test("GAS Vendor selector R2 stays collapsed until search and confirms in the drawer", () => {
  const source = read("app/Board/procurement/vendor-task-association.js");

  assert.match(source, /data-gas-vendor-selector/);
  assert.match(source, /data-gas-vendor-open/);
  assert.match(source, /data-gas-vendor-confirm/);
  assert.match(source, /if \(!query\) return \[\]/);
  assert.doesNotMatch(source, /if \(!query\) return state\.vendors\.slice/);
  assert.match(source, /data-gas-vendor-selector-close/);
  assert.doesNotMatch(source, /window\.open\(/);
});

test("unlinked GAS cards keep the Vendor selector blank for every empty Vendor ID form", async () => {
  const vendors = [
    { vendorId: "", vendorName: "千騰" },
    { vendorId: "GAS-V0001", vendorName: "千勝" }
  ];
  const links = [null, { vendorId: null }, { vendorId: undefined }, { vendorId: "" }, { vendorId: "   " }];

  for (const link of links) {
    const { elements } = await mountVendorAssociation({ link, vendors });
    assert.equal(elements.get("[data-gas-vendor-selected]").innerHTML, "尚未關聯");
    assert.equal(elements.get("[data-gas-vendor-save]").disabled, true);
    assert.equal(elements.get("[data-gas-vendor-clear]").disabled, true);
    assert.equal(elements.get("[data-gas-vendor-association-state]").textContent, "尚未關聯廠商。");
  }
});

test("an existing GAS Vendor Association still resolves its original Vendor", async () => {
  const { elements } = await mountVendorAssociation({
    link: { vendorId: "GAS-V0001" },
    vendors: [{ vendorId: "GAS-V0001", vendorName: "千勝" }]
  });

  assert.match(elements.get("[data-gas-vendor-selected]").innerHTML, /千勝/);
  assert.equal(elements.get("[data-gas-vendor-clear]").disabled, false);
});

test("search, explicit Vendor choice, save, and reload preserve the canonical Association", async () => {
  const vendors = [{ vendorId: "GAS-V0001", vendorName: "千勝" }];
  const first = await mountVendorAssociation({ link: null, vendors });
  const search = first.elements.get("[data-gas-vendor-search]");
  search.value = "千勝";
  await first.elements.get("[data-gas-vendor-open]").emit("click");
  await search.emit("input");
  await first.elements.get("[data-gas-vendor-results]").emit("click", {
    target: {
      closest(selector) {
        return selector === "[data-gas-vendor-choice]"
          ? { dataset: { gasVendorChoice: "GAS-V0001" } }
          : null;
      }
    }
  });
  await first.elements.get("[data-gas-vendor-confirm]").emit("click");
  await first.elements.get("[data-gas-vendor-save]").emit("click");

  assert.deepEqual(first.writes, [{ taskId: "task-test", vendorId: "GAS-V0001" }]);
  assert.match(first.elements.get("[data-gas-vendor-selected]").innerHTML, /千勝/);
  assert.equal(first.getLink().vendorId, "GAS-V0001");

  const reloaded = await mountVendorAssociation({ link: first.getLink(), vendors });
  assert.match(reloaded.elements.get("[data-gas-vendor-selected]").innerHTML, /千勝/);
  assert.equal(reloaded.getLink().vendorId, "GAS-V0001");
});

test("GAS Vendor Association Cloud contract stores only a formal Vendor ID", () => {
  const migration = read("docs/supabase/20260911_task_065_gas_vendor_task_link.sql");
  const acl = read("docs/supabase/20260911_task_065_gas_vendor_task_link_acl.sql");

  assert.match(migration, /create table if not exists public\.board_task_vendor_links/);
  assert.match(migration, /vendor_id text not null check \(vendor_id ~ '\^GAS-V\[0-9\]\{4\}\$'\)/);
  assert.match(migration, /unique \(task_id\)/);
  assert.match(migration, /board_task_can_read\(task_id\)/);
  assert.match(migration, /board_task_can_write\(p_task_id\)/);
  assert.match(migration, /v_prefix[\s\S]*<> 'GAS'/);
  assert.match(migration, /vendor_association_updated/);
  assert.match(migration, /source_of_truth', 'google_sheet'/);
  assert.doesNotMatch(migration, /vendor_name|company|products|contact_name/i);
  assert.match(acl, /revoke execute[\s\S]*from public, anon/);
  assert.match(acl, /grant execute[\s\S]*to authenticated/);
  const aclHardening = read("docs/supabase/20260911_task_065_gas_vendor_task_link_acl_hardening.sql");
  assert.match(aclHardening, /revoke all on table public\.board_task_vendor_links[\s\S]*from public, anon, authenticated/);
  assert.match(aclHardening, /grant select on table public\.board_task_vendor_links to authenticated/);
});

test("Vendor list keeps toolbar and header outside the independently scrolling data region", () => {
  const client = read("app/Board/procurement/vendor-list.js");
  const css = read("app/Board/procurement/procurement.css");
  assert.match(client, /class="vendor-page" data-vendor-page/);
  assert.match(client, /class="vendor-table-wrap"><table/);
  assert.match(css, /data-procurement-panel="vendors"\]:not\(\[hidden\]\)[\s\S]*height:calc\(100vh - 210px\)/);
  assert.match(css, /vendor-table-wrap\{[\s\S]*flex:1 1 auto/);
  assert.match(css, /vendor-table th\{height:42px;position:sticky;top:0/);
  assert.match(css, /vendor-mobile-list\{[\s\S]*overflow:auto/);
});
