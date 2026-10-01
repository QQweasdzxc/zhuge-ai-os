import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(import.meta.dir, "../evidence/provider-audit");
await mkdir(dir, { recursive: true });
const requests = [
  { id: "twse-schema", url: "https://openapi.twse.com.tw/v1/swagger.json" },
  { id: "tpex-schema", url: "https://www.tpex.org.tw/openapi/swagger.json" },
  { id: "taifex-schema", url: "https://openapi.taifex.com.tw/swagger.json" },
  { id: "tdcc-discovery", url: "https://openapi.tdcc.com.tw/swagger-ui/swagger-initializer.js" },
  { id: "genspark-license", url: "https://api.github.com/repos/dvorak0727/Genspark-Stock-AI/license" },
  { id: "genspark-root", url: "https://api.github.com/repos/dvorak0727/Genspark-Stock-AI/contents/" },
];
const receipts = [];
for (const request of requests) {
  try {
    const response = await fetch(request.url, { headers: { "User-Agent": "Zhuge-Local-Research-Lab-Phase1-ReadOnly-Audit", "Accept": "application/json,text/plain;q=0.9" }, signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    const receipt = { ...request, status: response.status, fetchedAt: new Date().toISOString(), size: text.length, contentType: response.headers.get("content-type") };
    receipts.push(receipt);
    await Bun.write(resolve(dir, `${request.id}.txt`), text);
    console.log(JSON.stringify(receipt));
  } catch (error) {
    const receipt = { ...request, status: null, fetchedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "REQUEST_FAILED" };
    receipts.push(receipt); console.log(JSON.stringify(receipt));
  }
}
await Bun.write(resolve(dir, "receipts.json"), JSON.stringify(receipts, null, 2));
