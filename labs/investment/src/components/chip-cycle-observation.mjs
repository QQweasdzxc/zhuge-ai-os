const esc = value => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

const pct = value => value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(2)}%`;
const shares = value => value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toLocaleString("zh-TW")} 股`;

export function renderChipCycleObservation(result) {
  if (!result) return "";
  const scoreRows = (result.stageScores || []).map(stage => `<li><strong>${esc(stage.id)} ${esc(stage.label)}</strong> · ${Number(stage.score)}/${Number(stage.maxScore)}${stage.eligible ? "" : ` · 缺 ${esc((stage.unknownFactors || []).join("、"))}`}</li>`).join("");
  const observations = (result.sourceObservations || []).map(item => `<li><strong>${esc(item.label)}</strong>：${esc(item.value)} · ${esc(item.source)} · ${esc(item.asOf || "日期未提供")}</li>`).join("");
  const rows = result.status === "AVAILABLE"
    ? `<div class="metric-row"><div class="metric"><label>20 日報酬</label><strong>${pct(result.returnPct)}</strong></div><div class="metric"><label>區間寬度</label><strong>${pct(result.rangePct)}</strong></div><div class="metric"><label>上漲日量占比</label><strong>${pct(result.upVolumeSharePct)}</strong></div><div class="metric"><label>5 日法人合計</label><strong>${shares(result.institutionalNet5Sessions)}</strong></div></div>`
    : `<p class="empty-state">未判定階段：${(result.missing || []).map(esc).join("；") || "可計算資料未達分數門檻，或候選分數接近"}。</p>`;
  return `<section class="surface chip-cycle-observation" data-chip-cycle-status="${esc(result.status)}" data-chip-cycle-stage="${esc(result.stage || result.phase)}" data-chip-cycle-rule="${esc(result.ruleVersion || "")}"><div class="section-title"><h3>Wyckoff / 量價週期觀察</h3><span>${esc(result.phaseLabel || result.stage || result.phase)}</span></div>${rows}<p>${esc(result.reason || "階段候選理由未提供")}</p><p class="tiny-note">證據覆蓋度 ${esc(result.sufficiency?.level || "UNKNOWN")} · ${result.sufficiency?.score == null ? "—" : `${Number(result.sufficiency.score)}%`} · 不是階段機率</p>${observations ? `<ul class="evidence-facts">${observations}</ul>` : ""}<details><summary>五階段分數、規則與來源證據</summary><ul class="evidence-facts">${scoreRows}${(result.evidence || []).map(item => `<li>${esc(item)}</li>`).join("")}</ul></details><p class="tiny-note">${esc(result.note || "")}</p><p class="tiny-note">TDCC 多週級距：${esc(result.tdccHistory || "未納入")}</p></section>`;
}
