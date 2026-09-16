const test = require("node:test");
const assert = require("node:assert/strict");
const Hub = require("../shared/components/global-floating-hub.js");

function fakeElement({ hidden = false, dataset = {} } = {}) {
  const listeners = new Map();
  const attributes = {};
  return {
    hidden,
    dataset,
    attributes,
    src: "",
    contentWindow: {},
    addEventListener(name, callback) {
      const rows = listeners.get(name) || [];
      rows.push(callback);
      listeners.set(name, rows);
    },
    removeEventListener(name, callback) {
      listeners.set(name, (listeners.get(name) || []).filter(item => item !== callback));
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    focus() { this.focused = true; },
    click(event = {}) {
      (listeners.get("click") || []).forEach(callback => callback({
        preventDefault() {},
        stopPropagation() {},
        ...event
      }));
    }
  };
}

function fakeDocument() {
  const selectors = {
    "[data-hub-toggle]": fakeElement(),
    "[data-hub-menu]": fakeElement({ hidden: true }),
    "[data-hub-assistant-open]": fakeElement(),
    "[data-hub-chat-overlay]": fakeElement({ hidden: true }),
    "[data-hub-chat-frame]": fakeElement({ dataset: { src: "/zhuge/modules/worklog/chat/?app=1&hub=1" } }),
    "[data-hub-chat-close]": fakeElement()
  };
  let markup = "";
  const rootNode = fakeElement();
  rootNode.isConnected = true;
  rootNode.querySelector = selector => selectors[selector] || null;
  rootNode.remove = () => { rootNode.isConnected = false; };
  const documentListeners = new Map();
  return {
    rootNode,
    selectors,
    get markup() { return markup; },
    body: { appendChild() {} },
    querySelector() { return null; },
    createElement() {
      return {
        set innerHTML(value) { markup = value; },
        get firstElementChild() { return rootNode; }
      };
    },
    addEventListener(name, callback) {
      const rows = documentListeners.get(name) || [];
      rows.push(callback);
      documentListeners.set(name, rows);
    },
    removeEventListener(name, callback) {
      documentListeners.set(name, (documentListeners.get(name) || []).filter(item => item !== callback));
    }
  };
}

test("Hub assistant opens the existing WorkLog compact chat in-page without changing the host URL", async () => {
  const originalDocument = global.document;
  const originalLocation = global.location;
  const hostUrl = "https://os.example/zhuge/modules/investment/?tab=holdings";
  const fakeDoc = fakeDocument();
  global.location = {
    pathname: "/zhuge/modules/investment/",
    search: "?tab=holdings",
    href: hostUrl,
    origin: "https://os.example"
  };
  global.document = fakeDoc;

  try {
    await Hub.mount({
      userId: "user-1",
      service: {
        getCurrent: async () => ({ status: "APPROVED", email: "owner@example.com" }),
        isApproved: access => access.status === "APPROVED"
      },
      creatorResolver: { resolve: async () => ({ is_creator: false }) }
    });

    assert.match(fakeDoc.markup, /data-hub-assistant-open/);
    assert.match(fakeDoc.markup, /data-src="\/zhuge\/modules\/worklog\/chat\/\?app=1&amp;hub=1"/);
    assert.match(fakeDoc.markup, /工時小幫手/);

    fakeDoc.selectors["[data-hub-assistant-open]"].click();

    assert.equal(fakeDoc.selectors["[data-hub-menu]"].hidden, true);
    assert.equal(fakeDoc.selectors["[data-hub-chat-overlay]"].hidden, false);
    assert.equal(fakeDoc.selectors["[data-hub-chat-frame]"].src, "/zhuge/modules/worklog/chat/?app=1&hub=1");
    assert.equal(fakeDoc.selectors["[data-hub-assistant-open]"].attributes["aria-expanded"], "true");
    assert.equal(global.location.href, hostUrl);

    fakeDoc.selectors["[data-hub-chat-close]"].click();
    assert.equal(fakeDoc.selectors["[data-hub-chat-overlay]"].hidden, true);
    assert.equal(global.location.href, hostUrl);
  } finally {
    await Hub.unmount();
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
    if (originalLocation === undefined) delete global.location;
    else global.location = originalLocation;
  }
});
