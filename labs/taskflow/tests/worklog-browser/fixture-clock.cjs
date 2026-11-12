// Fixtures are explicitly November 12, 2026. Keep timer progression real while
// fixing only Date, so overnight CI exercises the same seeded day and month.
const playwright=require('playwright');
module.exports={...playwright,chromium:new Proxy(playwright.chromium,{get(target,key){if(key!=='launch'){const v=target[key];return typeof v==='function'?v.bind(target):v;}return async(...args)=>{const browser=await target.launch(...args);const newPage=browser.newPage.bind(browser);browser.newPage=async(...options)=>{const page=await newPage(...options);await page.clock.setFixedTime(new Date('2026-11-12T12:00:00+08:00'));return page;};return browser;};}})};
