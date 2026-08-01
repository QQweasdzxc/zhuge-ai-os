(function (root, factory) {
  const dependencies = {
    Portfolio: root?.InvestmentPortfolio || (typeof require === "function" ? require("../models/portfolio.js") : null),
    Position: root?.InvestmentPosition || (typeof require === "function" ? require("../models/position.js") : null),
    Transaction: root?.InvestmentTransaction || (typeof require === "function" ? require("../models/transaction.js") : null),
    Watchlist: root?.InvestmentWatchlistItem || (typeof require === "function" ? require("../models/watchlist-item.js") : null),
    Strategy: root?.InvestmentStrategy || (typeof require === "function" ? require("../models/strategy.js") : null),
    Settings: root?.InvestmentSettings || (typeof require === "function" ? require("../models/settings.js") : null)
  };
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MockInvestmentRepository = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Models) {
  "use strict";

  function create(options = {}) {
    const userId = String(options.userId || "");
    if (!userId) throw new TypeError("MockInvestmentRepository requires Shared Identity UUID.");
    const portfolioId = "portfolio-sit-core";
    const portfolio = Models.Portfolio.normalize({ id: portfolioId, userId, name: "核心投資組合", baseCurrency: "TWD" });
    const positions = [
      { symbol: "0050", name: "元大台灣50", market: "TW", currency: "TWD", quantity: 1200, averageCost: 148.2, lastPrice: 156.4 },
      { symbol: "2330", name: "台積電", market: "TW", currency: "TWD", quantity: 300, averageCost: 920, lastPrice: 1015 },
      { symbol: "2454", name: "聯發科", market: "TW", currency: "TWD", quantity: 100, averageCost: 1450, lastPrice: 1395 },
      { symbol: "AAPL", name: "Apple", market: "US", currency: "USD", quantity: 18, averageCost: 208.5, lastPrice: 217.3 },
      { symbol: "MSFT", name: "Microsoft", market: "US", currency: "USD", quantity: 12, averageCost: 420.2, lastPrice: 431.8 },
      { symbol: "NVDA", name: "NVIDIA", market: "US", currency: "USD", quantity: 30, averageCost: 154.6, lastPrice: 149.2 }
    ].map((value, index) => Models.Position.normalize({ ...value, id: `position-${index + 1}`, userId, portfolioId }));
    const transactions = [
      { id: "tx-1", tradeDate: "2026-07-29", tradeType: "BUY", symbol: "2330", name: "台積電", quantity: 100, price: 980, netAmount: 98142, currency: "TWD", note: "核心持股加碼" },
      { id: "tx-2", tradeDate: "2026-07-24", tradeType: "BUY", symbol: "AAPL", name: "Apple", quantity: 3, price: 211.2, netAmount: 633.6, currency: "USD", note: "分批建立部位" },
      { id: "tx-3", tradeDate: "2026-07-18", tradeType: "SELL", symbol: "2454", name: "聯發科", quantity: 20, price: 1420, netAmount: 28318, currency: "TWD", note: "降低集中度" }
    ].map(value => Models.Transaction.normalize({ ...value, userId, portfolioId }));
    const watchlist = [
      { symbol: "2881", name: "富邦金", market: "TW", status: "觀察中", theme: "金融", reason: "利率循環與股利政策", importance: "P2" },
      { symbol: "GOOGL", name: "Alphabet", market: "US", status: "等待價格", theme: "AI", reason: "雲端與 AI 成長動能", importance: "P1" },
      { symbol: "V", name: "Visa", market: "US", status: "研究中", theme: "支付", reason: "全球消費與支付網路", importance: "P3" }
    ].map((value, index) => Models.Watchlist.normalize({ ...value, id: `watch-${index + 1}`, userId }));
    const strategies = [
      { id: "strategy-1", title: "核心部位保持分散", evidence: "台股單一持股比重接近上限。", reason: "降低單一公司波動對整體資產的影響。", decision: "守", updatedAt: "2026-07-31T09:30:00+08:00" },
      { id: "strategy-2", title: "AI 產業等待價格確認", evidence: "成長動能仍在，但短線波動擴大。", reason: "保留現金並等待更好的風險報酬。", decision: "觀望", updatedAt: "2026-07-30T15:10:00+08:00" }
    ].map(value => Models.Strategy.normalize({ ...value, userId }));
    const settings = Models.Settings.normalize({ userId, baseCurrency: "TWD", privacyMode: true });

    const resolve = value => Promise.resolve(value);
    return Object.freeze({
      mode: "mock",
      loadPortfolio: () => resolve(portfolio),
      loadPositions: () => resolve(positions.slice()),
      loadTransactions: () => resolve(transactions.slice()),
      loadWatchlist: () => resolve(watchlist.slice()),
      loadStrategies: () => resolve(strategies.slice()),
      loadSettings: () => resolve(settings)
    });
  }

  return Object.freeze({ create });
});
