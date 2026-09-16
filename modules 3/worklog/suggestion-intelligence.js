// P5.3 Suggestion Intelligence
// Pure candidate preparation only: normalize, generalize, match Work Memory, and deduplicate.
// This module does not render UI, mutate Work Memory, or persist data.

const SuggestionIntelligence = (() => {
  const WORK_MEMORY_MATCH_THRESHOLD = 0.84;
  const SUGGESTION_DEDUP_THRESHOLD = 0.88;

  const GENERALIZATION_RULES = [
    {
      title: "採購案件管理",
      patterns: [
        /檢查.{0,8}請款.{0,8}文件/,
        /追蹤.{0,8}驗收/,
        /確認.{0,8}交貨/,
        /確認.{0,8}議價.{0,8}紀錄/,
        /追蹤.{0,8}採購.{0,8}(案件|進度)/
      ]
    },
    {
      title: "供應商管理",
      patterns: [
        /供應商.{0,8}(評鑑|名單|資格|管理)/,
        /(評鑑|管理).{0,8}供應商/
      ]
    },
    {
      title: "新人報到管理",
      patterns: [
        /(新人|新進).{0,8}(報到|帳號|教育訓練|識別證)/,
        /(報到|帳號|識別證).{0,8}(新人|新進)/
      ]
    },
    {
      title: "教育訓練管理",
      patterns: [
        /(安排|建立|追蹤|確認).{0,8}(教育訓練|課程|研習)/,
        /(教育訓練|課程|研習).{0,8}(安排|紀錄|追蹤)/
      ]
    }
  ];

  function normalize(value = "") {
    return String(value || "")
      .toLowerCase()
      .replace(/[　\s\-＿_()（）【】「」『』,，.。/／:：]/g, "")
      .replace(/工作|事項|處理|管理|作業|流程|紀錄|追蹤|整理/g, "");
  }

  function levenshteinDistance(a = "", b = "") {
    const left = [...a];
    const right = [...b];
    const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i++) dp[i][0] = i;
    for (let j = 0; j <= right.length; j++) dp[0][j] = j;
    for (let i = 1; i <= left.length; i++) {
      for (let j = 1; j <= right.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[left.length][right.length];
  }

  function similarity(a = "", b = "") {
    const rawA = String(a || "").trim();
    const rawB = String(b || "").trim();
    const left = normalize(rawA);
    const right = normalize(rawB);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.92;
    const maxLen = Math.max([...left].length, [...right].length) || 1;
    const distanceScore = 1 - (levenshteinDistance(left, right) / maxLen);
    const charsA = new Set([...left]);
    const charsB = new Set([...right]);
    const intersection = [...charsA].filter(character => charsB.has(character)).length;
    const union = new Set([...charsA, ...charsB]).size || 1;
    return Math.max(distanceScore, (intersection / union) * 0.92);
  }

  function generalize(candidate = {}) {
    const originalTitle = String(candidate.title || "").trim();
    if (candidate.workDna) return { title: originalTitle, generalized: false, originalTitle };
    const context = [originalTitle, candidate.content, ...(candidate.triggers || [])].filter(Boolean).join(" ");
    const rule = GENERALIZATION_RULES.find(item => item.patterns.some(pattern => pattern.test(context)));
    return {
      title: rule?.title || originalTitle,
      generalized: !!rule && rule.title !== originalTitle,
      originalTitle
    };
  }

  function bestWorkMemoryMatch(titles = [], acceptedWorks = []) {
    let best = null;
    for (const work of acceptedWorks) {
      for (const title of titles) {
        const score = similarity(title, work);
        if (!best || score > best.score) best = { name: work, score };
      }
    }
    return best;
  }

  function mergeCandidate(target, incoming) {
    target.sources = [...new Set([...target.sources, ...incoming.sources])];
    target.originalTitles = [...new Set([...target.originalTitles, ...incoming.originalTitles])];
    target.rawCandidates.push(...incoming.rawCandidates);
    target.generalized = target.generalized || incoming.generalized;
    target.confidence = Math.max(target.confidence, incoming.confidence);
    target.defaultDuration = target.defaultDuration || incoming.defaultDuration;
    return target;
  }

  function prepareCandidates(rawCandidates = [], acceptedWorks = []) {
    const accepted = [...new Set(acceptedWorks.map(value => String(value || "").trim()).filter(Boolean))];
    const prepared = [];
    const references = [];

    for (const raw of rawCandidates) {
      const generalized = generalize(raw);
      if (!generalized.title) continue;
      const match = bestWorkMemoryMatch([generalized.title, generalized.originalTitle], accepted);
      if (match && match.score >= WORK_MEMORY_MATCH_THRESHOLD) {
        references.push({
          candidate: generalized.originalTitle,
          generalizedAs: generalized.title,
          workMemory: match.name,
          score: match.score
        });
        continue;
      }

      const item = {
        title: generalized.title,
        content: String(raw.content || "").trim(),
        generalized: generalized.generalized,
        originalTitles: [generalized.originalTitle].filter(Boolean),
        sources: [String(raw.source || "").trim()].filter(Boolean),
        defaultDuration: Number(raw.defaultDuration || 1),
        confidence: Number(raw.confidence || 0),
        rawCandidates: [raw]
      };
      const duplicate = prepared.find(existing => similarity(existing.title, item.title) >= SUGGESTION_DEDUP_THRESHOLD);
      if (duplicate) mergeCandidate(duplicate, item);
      else prepared.push(item);
    }

    const items = prepared.map(item => {
      const actionCount = item.originalTitles.length;
      const sourceCount = item.sources.length;
      const reason = item.generalized || actionCount > 1
        ? `我把 ${actionCount} 個相近動作整理成「${item.title}」，避免把同一類工作拆成多項建議。`
        : sourceCount > 1
          ? `我在 ${sourceCount} 份資料裡都看到「${item.title}」，因此整理成一則建議。`
          : item.content || `我從工作資料裡看到「${item.title}」，覺得它可能值得加入「我的工作」。`;
      return { ...item, reason };
    });

    return {
      items,
      diagnostics: {
        rawCount: rawCandidates.length,
        suggestionCount: items.length,
        referencedExistingCount: references.length,
        references
      }
    };
  }

  return Object.freeze({
    normalize,
    similarity,
    generalize,
    bestWorkMemoryMatch,
    prepareCandidates,
    thresholds: Object.freeze({
      workMemoryMatch: WORK_MEMORY_MATCH_THRESHOLD,
      suggestionDedup: SUGGESTION_DEDUP_THRESHOLD
    })
  });
})();
