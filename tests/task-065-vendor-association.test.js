import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

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
