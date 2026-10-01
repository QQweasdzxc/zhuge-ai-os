const XMLParser = globalThis.XMLParser?.default ?? globalThis.XMLParser;

if (typeof XMLParser !== "function") {
  throw new Error("FAST_XML_PARSER_VENDOR_UNAVAILABLE");
}

export { XMLParser };
