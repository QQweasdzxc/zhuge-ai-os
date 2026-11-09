// Family Learning Archipelago API V1 — capability-token family scope, server-authoritative class/XP/promotion.
const BASE = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ORIGINS = [
  "https://chengyu-quest-family.onrender.com",
  "https://vocab-quest-family.onrender.com",
  "https://learning-archipelago-family.onrender.com"
];
function originFor(req) {
  const o = req.headers.get("Origin");
  return ORIGINS.includes(o) ? o : ORIGINS[0];
}
function cors(req) {
  return {
    "Access-Control-Allow-Origin": originFor(req),
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,apikey,authorization",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}
function respond(req, value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json"
    }
  });
}
function fail(req, msg, status = 400) {
  return respond(req, {
    ok: false,
    error: msg
  }, status);
}
function uuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function safe(v, n = 100) {
  return typeof v === "string" ? v.trim().slice(0, n) : "";
}
async function sha(v) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [
    ...new Uint8Array(d)
  ].map((x)=>x.toString(16).padStart(2, "0")).join("");
}
async function db(table, qs = "", method = "GET", body = undefined) {
  const r = await fetch(BASE + "/rest/v1/" + table + (qs ? "?" + qs : ""), {
    method,
    headers: {
      "apikey": KEY,
      "Authorization": "Bearer " + KEY,
      "Content-Type": "application/json",
      ...method !== "GET" ? {
        "Prefer": "return=representation"
      } : {}
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await r.json().catch(()=>null);
  if (!r.ok) {
    console.error("adventure db", table, r.status, JSON.stringify(data).slice(0, 500));
    throw new Error("雲端資料暫時無法完成操作");
  }
  return data;
}
const shuffled = (a)=>{
  const arr = [
    ...a
  ];
  for(let i = arr.length - 1; i > 0; i--){
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [arr[i], arr[n]] = [
      arr[n],
      arr[i]
    ];
  }
  return arr;
};
const threshold = (level)=>50 * level * (level + 1);
function publicHero(h) {
  return {
    id: h.id,
    name: h.display_name,
    profession: h.profession,
    avatarStyle: h.avatar_style || null,
    totalXP: h.total_xp,
    level: h.verified_level,
    nextXP: threshold(h.verified_level),
    eligible: !!h.profession && h.total_xp >= threshold(h.verified_level) && h.verified_level < 100
  };
}
function visibleExam(e) {
  if (!e) return null;
  return {
    id: e.id,
    fromLevel: e.level_before,
    count: (e.questions || []).length,
    questions: (e.questions || []).map((q, i)=>({
        index: i,
        kind: q.kind,
        stem: q.stem,
        choices: q.choices
      })),
    startedAt: e.started_at
  };
}
function choiceSet(correct, others) {
  const candidates = [
    ...new Set(others.filter((x)=>x && x !== correct))
  ];
  const vals = shuffled([
    correct,
    ...shuffled(candidates).slice(0, 3)
  ]);
  if (vals.length < 4) throw new Error("題庫可用選項不足");
  return {
    choices: vals,
    answerIndex: vals.indexOf(correct)
  };
}
function idiomQuiz(pool, count) {
  if (pool.length < Math.max(count, 4)) throw new Error("成語題庫不足");
  const picked = shuffled(pool).slice(0, count);
  return picked.map((p, i)=>{
    const kind = i % 3, word = p.word;
    if (kind === 0) {
      const s = choiceSet(p.meaning, pool.filter((x)=>x.word !== word).map((x)=>x.meaning));
      return {
        kind: "idiom-meaning",
        stem: "「" + word + "」的意思是什麼？",
        ...s
      };
    }
    if (kind === 1) {
      const s = choiceSet(word, pool.filter((x)=>x.word !== word).map((x)=>x.word));
      return {
        kind: "idiom-reverse",
        stem: "哪個成語最符合這個意思？" + p.meaning,
        ...s
      };
    }
    const example = String(p.example || "").replace(word, "＿＿");
    const s = choiceSet(word, pool.filter((x)=>x.word !== word).map((x)=>x.word));
    return {
      kind: "idiom-context",
      stem: "哪個成語最適合填入句子？" + example,
      ...s
    };
  });
}
function englishQuiz(pool, count) {
  if (pool.length < Math.max(count, 4)) throw new Error("英文題庫不足");
  const picked = shuffled(pool).slice(0, count);
  return picked.map((p, i)=>{
    if (i % 2 === 0) {
      const s = choiceSet(p.zh, pool.filter((x)=>x.en !== p.en).map((x)=>x.zh));
      return {
        kind: "english-meaning",
        stem: "英文單字「" + p.en + "」的中文意思是什麼？",
        ...s
      };
    }
    const s = choiceSet(p.en, pool.filter((x)=>x.en !== p.en).map((x)=>x.en));
    return {
      kind: "english-reverse",
      stem: "哪個英文單字最符合「" + p.zh + "」？",
      ...s
    };
  });
}
async function familyFor(world, token) {
  const hash = await sha(token);
  const table = world === "chengyu" ? "chengyu_family_spaces" : "vocab_family_spaces";
  let fs = await db(table, "secret_hash=eq." + hash + "&select=id&limit=1");
  let sourceFamilyId = fs[0]?.id;
  if (!sourceFamilyId) {
    // A family member may enter any island using the single hub link.
    const other = world === "chengyu" ? "vocab" : "chengyu";
    const siblings = await db(other + "_family_spaces", "secret_hash=eq." + hash + "&select=id&limit=1");
    if (!siblings.length) return null;
    const mapped = await db("learning_adventure_family_bindings", "world=eq." + other + "&source_family_id=eq." + siblings[0].id + "&select=adventure_family_id&limit=1");
    if (!mapped.length) return null;
    const target = await db("learning_adventure_family_bindings", "world=eq." + world + "&adventure_family_id=eq." + mapped[0].adventure_family_id + "&select=source_family_id&limit=1");
    sourceFamilyId = target[0]?.source_family_id;
    if (!sourceFamilyId) return null;
  }
  const bindings = await db("learning_adventure_family_bindings", "world=eq." + world + "&source_family_id=eq." + sourceFamilyId + "&select=adventure_family_id&limit=1");
  if (!bindings.length) return null;
  return {
    world,
    sourceFamilyId,
    adventureFamilyId: bindings[0].adventure_family_id
  };
}
async function heroFor(family, learnerId) {
  const table = family.world === "chengyu" ? "chengyu_family_learners" : "vocab_family_learners";
  const learners = await db(table, "family_id=eq." + family.sourceFamilyId + "&id=eq." + learnerId + "&select=id,name&limit=1");
  if (!learners.length) return null;
  const links = await db("learning_adventure_hero_links", "world=eq." + family.world + "&source_learner_id=eq." + learnerId + "&select=hero_id&limit=1");
  if (!links.length) return null;
  const heroes = await db("learning_adventure_heroes", "id=eq." + links[0].hero_id + "&adventure_family_id=eq." + family.adventureFamilyId + "&select=id,adventure_family_id,display_name,profession,avatar_style,total_xp,verified_level&limit=1");
  return heroes[0] || null;
}
async function activeExam(heroId, level) {
  const a = await db("learning_adventure_promotion_exams", "hero_id=eq." + heroId + "&level_before=eq." + level + "&completed_at=is.null&select=*&limit=1");
  return a[0] || null;
}
async function buildQuestions(family, hero) {
  const ledger = await db("learning_adventure_xp_ledger", "hero_id=eq." + hero.id + "&select=world,amount&limit=3000");
  const counts = {
    chengyu: 0,
    vocab: 0
  };
  for (const x of ledger)counts[x.world] = (counts[x.world] || 0) + Math.max(0, Number(x.amount) || 0);
  const needBoth = counts.chengyu > 0 && counts.vocab > 0;
  let nChengyu = needBoth ? 5 : counts.chengyu > 0 ? 10 : 0;
  let nVocab = 10 - nChengyu;
  if (counts.vocab === 0 && counts.chengyu > 0) nVocab = 0;
  if (!nChengyu && !nVocab) throw new Error("請先完成學習島的題目再挑戰晉級");
  const quiz = [];
  if (nChengyu) {
    const linked = await db("learning_adventure_hero_links", "hero_id=eq." + hero.id + "&world=eq.chengyu&select=source_learner_id&limit=1");
    let maxZone = 1;
    if (linked.length) {
      const recent = await db("chengyu_family_attempts", "learner_id=eq." + linked[0].source_learner_id + "&select=zone,correct_count,question_count,result_status&limit=100");
      for(let z = 1; z <= 6; z++){
        if (recent.some((a)=>Number(a.zone) === z && a.result_status === "completed" && a.question_count >= 5 && a.correct_count / a.question_count >= 0.8)) maxZone = Math.max(maxZone, z + 1);
      }
    }
    const bank = await db("learning_adventure_exam_bank", "zone=lte." + Math.min(6, maxZone) + "&select=word,meaning,example,zone&limit=200");
    quiz.push(...idiomQuiz(bank, nChengyu));
  }
  if (nVocab) {
    const b = await db("learning_adventure_family_bindings", "world=eq.vocab&adventure_family_id=eq." + family.adventureFamilyId + "&select=source_family_id&limit=1");
    if (!b.length) throw new Error("尚未開通英文學習島");
    const [units, playerLinks] = await Promise.all([
      db("vocab_family_units", "family_id=eq." + b[0].source_family_id + "&select=id,words&limit=150"),
      db("learning_adventure_hero_links", "hero_id=eq." + hero.id + "&world=eq.vocab&select=source_learner_id&limit=1")
    ]);
    const studied = playerLinks.length ? await db("vocab_family_attempts", "learner_id=eq." + playerLinks[0].source_learner_id + "&select=unit_id&limit=300") : [];
    const seenUnitIds = new Set(studied.map((a)=>a.unit_id).filter(Boolean));
    const didGeneralReview = studied.some((a)=>a.unit_id == null);
    const studiedUnits = didGeneralReview || !seenUnitIds.size ? units : units.filter((u)=>seenUnitIds.has(u.id));
    const seen = new Set(), words = [];
    for (const unit of studiedUnits)for (const item of Array.isArray(unit.words) ? unit.words : []){
      const en = safe(item.en, 50), zh = safe(item.zh, 150);
      if (!en || !zh || seen.has(en.toLowerCase())) continue;
      seen.add(en.toLowerCase());
      words.push({
        en,
        zh
      });
    }
    quiz.push(...englishQuiz(words, nVocab));
  }
  if (quiz.length !== 10) throw new Error("升級試煉題數不完整");
  return shuffled(quiz);
}
// Daily review uses a saved run and server question banks, never a client completion flag.
async function dailyReviewStart(family, hero, reviewWorld) {
  const world = reviewWorld || family.world;
  if (![
    'chengyu',
    'vocab'
  ].includes(world)) throw Error('學習島不正確');
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei'
  }).format(new Date());
  let sessions = await db('learning_adventure_daily_reviews', 'adventure_family_id=eq.' + family.adventureFamilyId + '&hero_id=eq.' + hero.id + '&world=eq.' + world + '&day=eq.' + day + '&select=*');
  if (sessions.length) return dailyVisible(sessions[0]);
  const links = await db('learning_adventure_hero_links', 'hero_id=eq.' + hero.id + '&world=eq.' + world + '&select=source_learner_id&limit=1');
  if (!links.length) throw Error('請先到這座島完成一回合練習');
  const binding = await db('learning_adventure_family_bindings', 'adventure_family_id=eq.' + family.adventureFamilyId + '&world=eq.' + world + '&select=source_family_id&limit=1');
  if (!binding.length) throw Error('尚未連接這座學習島');
  const release = await db('learning_adventure_learning_release', 'singleton=eq.true&select=starts_at');
  const since = new Date(day + 'T00:00:00+08:00').toISOString();
  const lower = new Date(release[0].starts_at) > new Date(since) ? release[0].starts_at : since;
  const runs = await db(world + '_family_attempts', 'family_id=eq.' + binding[0].source_family_id + '&learner_id=eq.' + links[0].source_learner_id + '&created_at=gte.' + encodeURIComponent(lower) + '&result_status=in.(completed,game_over)&select=id,answers,result_status,created_at&order=created_at.desc&limit=1');
  if (!runs.length || !runs[0].answers?.length) throw Error('先完成今日一回合，再回來訂正或複習');
  const source = runs[0], wrong = [
    ...new Set(source.answers.filter((a)=>a.correct === false).map((a)=>a.word))
  ];
  let words = wrong, reviewType = 'correction';
  if (!words.length) {
    reviewType = 'review';
    const previous = await db(world + '_family_attempts', 'family_id=eq.' + binding[0].source_family_id + '&learner_id=eq.' + links[0].source_learner_id + '&id=neq.' + source.id + '&select=answers&order=created_at.desc&limit=30');
    words = [
      ...new Set(previous.flatMap((x)=>(x.answers || []).map((a)=>a.word)))
    ];
    if (!words.length) {
      words = [
        ...new Set(source.answers.map((a)=>a.word))
      ];
      reviewType = 'first_review';
    }
    words = shuffled(words).slice(0, 3);
  }
  let questions = [];
  if (world === 'chengyu') {
    const bank = await db('learning_adventure_exam_bank', 'select=word,meaning,example,zone&limit=500');
    questions = words.map((word)=>{
      const item = bank.find((x)=>x.word === word), choices = choiceSet(item.meaning, bank.filter((x)=>x.word !== word).map((x)=>x.meaning));
      return {
        kind: 'idiom-review',
        stem: '「' + word + '」的意思是什麼？',
        ...choices
      };
    });
  } else {
    const units = await db('vocab_family_units', 'family_id=eq.' + binding[0].source_family_id + '&select=words&limit=150');
    const bank = units.flatMap((u)=>Array.isArray(u.words) ? u.words : []);
    questions = words.map((word)=>{
      const item = bank.find((x)=>String(x.en).toLowerCase() === String(word).toLowerCase());
      if (!item?.zh) throw Error('題庫尚未找到這個單字，暫不發獎');
      if (reviewType === 'correction' && source.answers.some((a)=>a.word === word && a.correct === false && a.stage === 1)) return {
        kind: 'vocab-spelling',
        stem: '請拼出「' + item.zh + '」的英文單字',
        answerText: String(item.en).trim().toLowerCase().replace(/\s+/g, ' '),
        acceptedTexts: [
          item.en,
          ...Array.isArray(item.aliases) ? item.aliases : []
        ].map((x)=>String(x).trim().toLowerCase().replace(/\s+/g, ' '))
      };
      return {
        kind: 'vocab-review',
        stem: '哪個英文單字是「' + item.zh + '」？',
        ...(()=>{
          const candidates = [
            ...new Set(bank.map((x)=>x.en).filter((x)=>x && x !== item.en))
          ];
          const choices = shuffled([
            item.en,
            ...shuffled(candidates).slice(0, 3),
            ...candidates.length ? [] : [
              '以上皆非'
            ]
          ]);
          return {
            choices,
            answerIndex: choices.indexOf(item.en)
          };
        })()
      };
    });
  }
  if (!questions.length) throw Error('沒有可驗證的複習題目');
  const row = {
    adventure_family_id: family.adventureFamilyId,
    hero_id: hero.id,
    world,
    day,
    source_attempt_id: source.id,
    questions: questions.map((q)=>({
        ...q,
        reviewType
      }))
  };
  try {
    sessions = await db('learning_adventure_daily_reviews', '', 'POST', row);
  } catch  {
    sessions = await db('learning_adventure_daily_reviews', 'hero_id=eq.' + hero.id + '&world=eq.' + world + '&day=eq.' + day + '&select=*');
    if (!sessions.length) throw Error('暫時無法建立複習');
  }
  return dailyVisible(sessions[0]);
}
function dailyVisible(r) {
  return {
    id: r.id,
    world: r.world,
    day: r.day,
    completed: !!r.completed_at,
    reviewType: r.questions[0]?.reviewType || 'review',
    questions: r.questions.map((q, index)=>({
        index,
        kind: q.kind,
        stem: q.stem,
        choices: q.choices
      }))
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: cors(req)
  });
  if (req.method !== "POST") return fail(req, "僅支援 POST", 405);
  const origin = req.headers.get("Origin");
  if (origin && !ORIGINS.includes(origin)) return fail(req, "不允許的網站來源", 403);
  if (!BASE || !KEY) return fail(req, "服務尚未設定", 503);
  let input;
  try {
    input = await req.json();
  } catch  {
    return fail(req, "請提供正確的資料");
  }
  if (input?.action === "setupParent") {
    if (typeof input.setupToken !== "string" || !/^[0-9a-f]{64}$/.test(input.setupToken) || typeof input.pin !== "string" || !/^[0-9]{6,12}$/.test(input.pin)) return fail(req, "請確認設定連結與 6 至 12 位數字 PIN", 403);
    try {
      const result = await db("rpc/learning_adventure_complete_parent_setup", "", "POST", {
        p_setup_token: input.setupToken,
        p_pin: input.pin
      });
      return respond(req, result, result.ok ? 200 : 403);
    } catch (e) {
      return fail(req, "設定暫時無法完成，請稍後再試", 503);
    }
  }
  const token = safe(input?.token, 150), world = input?.world, learnerId = input?.learnerId, action = input?.action;
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token) || ![
    "chengyu",
    "vocab"
  ].includes(world)) return fail(req, "請使用正確的家庭連結及玩家", 403);
  if (![
    "listPlayers",
    "leaderboard",
    "addPlayer"
  ].includes(action) && !uuid(learnerId)) return fail(req, "請選擇玩家", 403);
  try {
    const family = await familyFor(world, token);
    if (!family) return fail(req, "找不到家庭冒險檔案", 403);
    if (action === "leaderboard") {
      // Ignore all caller-supplied family/hero IDs. familyFor resolved the capability.
      const players = await db("rpc/learning_adventure_leaderboard", "", "POST", {p_family: family.adventureFamilyId});
      return respond(req, {ok:true, players});
    }
    if (action === "listPlayers") {
      const t = world === "chengyu" ? "chengyu_family_learners" : "vocab_family_learners";
      const players = await db(t, "family_id=eq." + family.sourceFamilyId + "&select=id,name,created_at&order=created_at.asc&limit=100");
      return respond(req, {
        ok: true,
        players
      });
    }
    if (action === "addPlayer") {
      const name = safe(input?.name, 24);
      if (!name || name.length > 24 || /[<>\r\n]/.test(name)) return fail(req, "請輸入 1 至 24 個字的玩家名字");
      const t = world === "chengyu" ? "chengyu_family_learners" : "vocab_family_learners";
      let rows = await db(t, "family_id=eq." + family.sourceFamilyId + "&name=eq." + encodeURIComponent(name) + "&select=id,name&limit=1");
      if (!rows.length) {
        const existing = await db(t, "family_id=eq." + family.sourceFamilyId + "&select=id&limit=101");
        if (existing.length >= 100) return fail(req, "家庭玩家已達人數上限");
        rows = await db(t, "", "POST", {
          family_id: family.sourceFamilyId,
          name
        });
      }
      return respond(req, {
        ok: true,
        player: {
          id: rows[0].id,
          name: rows[0].name
        }
      });
    }
    const hero = await heroFor(family, learnerId);
    if (!hero) return fail(req, "找不到對應的冒險者", 403);
    if (action === "startDailyReview") {
      try {
        return respond(req, {
          ok: true,
          review: await dailyReviewStart(family, hero, input.reviewWorld)
        });
      } catch (e) {
        return fail(req, e.message || "暫時無法開始每日複習");
      }
    }
    if (action === "submitDailyReview") {
      if (!uuid(input.reviewId) || !Array.isArray(input.answers) || input.answers.length > 1500 || input.answers.some((x)=>typeof x === 'string' ? x.length > 120 : !Number.isInteger(x) || x < 0 || x > 3)) return fail(req, "請完成全部複習題目");
      const result = await db("rpc/learning_adventure_complete_daily_review", "", "POST", {
        p_family: family.adventureFamilyId,
        p_hero: hero.id,
        p_review: input.reviewId,
        p_answers: input.answers
      });
      const wallet = await db("rpc/learning_adventure_wallet", "", "POST", {
        p_family: family.adventureFamilyId,
        p_hero: hero.id,
        p_claim_login: false
      });
      return respond(req, {
        ...result,
        wallet
      }, result.ok ? 200 : 400);
    }
    if (action === "parentLogin") {
      if (typeof input.pin !== "string" || !/^[0-9]{6,12}$/.test(input.pin)) return fail(req, "請輸入家長 PIN", 403);
      const result = await db("rpc/learning_adventure_parent_login", "", "POST", {
        p_family: family.adventureFamilyId,
        p_pin: input.pin
      });
      return respond(req, result, result.ok ? 200 : 403);
    }
    if (action === "setReward" || action === "listParentRewards") {
      if (typeof input.parentSession !== "string" || !/^[0-9a-f]{64}$/.test(input.parentSession)) return fail(req, "請先完成家長驗證", 403);
      const allowed = await db("rpc/learning_adventure_parent_valid", "", "POST", {
        p_family: family.adventureFamilyId,
        p_token: input.parentSession
      });
      if (!allowed) return fail(req, "家長驗證已失效，請重新驗證", 403);
      if (action === "listParentRewards") {
        const rewards = await db("learning_adventure_rewards", "adventure_family_id=eq." + family.adventureFamilyId + "&proposed=eq.false&select=id,title,price,available&order=created_at.asc");
        return respond(req, {
          ok: true,
          rewards
        });
      }
      if (input.rewardId != null && !uuid(input.rewardId)) return fail(req, "獎品識別不正確");
      if (typeof input.title !== "string" || input.title.trim().length < 1 || input.title.length > 80 || !Number.isInteger(input.price) || input.price < 1 || input.price > 100000 || typeof input.available !== "boolean") return fail(req, "請確認獎品名稱與金幣價格");
      const result = await db("rpc/learning_adventure_parent_set_reward", "", "POST", {
        p_family: family.adventureFamilyId,
        p_parent_session: input.parentSession,
        p_reward: input.rewardId || null,
        p_title: input.title,
        p_price: input.price,
        p_available: input.available
      });
      return respond(req, result, result.ok ? 200 : 400);
    }
    if (action === "redeem") {
      if (!uuid(input.rewardId) || !uuid(input.clientRequestId) || !Number.isInteger(input.expectedPrice) || input.expectedPrice < 1) return fail(req, "請重新確認獎勵及價格");
      const result = await db("rpc/learning_adventure_redeem", "", "POST", {
        p_family: family.adventureFamilyId,
        p_hero: hero.id,
        p_reward: input.rewardId,
        p_expected_price: input.expectedPrice,
        p_request: input.clientRequestId
      });
      if (!result.ok) return fail(req, result.error || "兌換未完成");
      const wallet = await db("rpc/learning_adventure_wallet", "", "POST", {
        p_family: family.adventureFamilyId,
        p_hero: hero.id,
        p_claim_login: false
      });
      return respond(req, {
        ...result,
        wallet
      });
    }
    if (action === "listRedemptions" || action === "confirmRedemption") {
      const parentSession = safe(input.parentSession, 65);
      if (!/^[0-9a-f]{64}$/.test(parentSession)) return fail(req, "請先完成家長驗證", 403);
      const allowed = await db("rpc/learning_adventure_parent_valid", "", "POST", {
        p_family: family.adventureFamilyId,
        p_token: parentSession
      });
      if (!allowed) return fail(req, "家長驗證已失效，請重新驗證", 403);
      if (action === "listRedemptions") {
        const [rows, heroes] = await Promise.all([
          db("learning_adventure_redemptions", "adventure_family_id=eq." + family.adventureFamilyId + "&status=eq.pending&select=id,hero_id,title,price,status,created_at&order=created_at.asc&limit=100"),
          db("learning_adventure_heroes", "adventure_family_id=eq." + family.adventureFamilyId + "&select=id,display_name")
        ]);
        return respond(req, {
          ok: true,
          redemptions: rows.map((r)=>({
              ...r,
              learnerName: heroes.find((h)=>h.id === r.hero_id)?.display_name || "冒險者"
            }))
        });
      }
      if (!uuid(input.redemptionId) || ![
        "fulfilled",
        "rejected"
      ].includes(input.decision)) return fail(req, "兌換結果不正確");
      const result = await db("rpc/learning_adventure_decide_redemption", "", "POST", {
        p_family: family.adventureFamilyId,
        p_parent_session: parentSession,
        p_redemption: input.redemptionId,
        p_decision: input.decision
      });
      if (!result.ok) return fail(req, result.error || "兌換紀錄未更新");
      return respond(req, result);
    }
    if (action === "listOwnRedemptions") {
      const redemptions = await db("learning_adventure_redemptions", "adventure_family_id=eq." + family.adventureFamilyId + "&hero_id=eq." + hero.id + "&select=id,title,price,status,created_at,decided_at&order=created_at.desc&limit=100");
      return respond(req, {
        ok: true,
        redemptions
      });
    }
    if (action === "listRewards") {
      const rewards = await db("learning_adventure_rewards", "adventure_family_id=eq." + family.adventureFamilyId + "&available=eq.true&proposed=eq.false&select=id,title,price,available&order=price.asc");
      const parents = await db("learning_adventure_parent_credentials", "adventure_family_id=eq." + family.adventureFamilyId + "&select=adventure_family_id&limit=1");
      return respond(req, {
        ok: true,
        rewards,
        redemptionEnabled: parents.length > 0,
        setupRequired: parents.length === 0
      });
    }
    if (action === "getWallet" || action === "claimLogin") {
      // IDs are resolved from the verified family capability and learner mapping, never input.heroId.
      const result = await db("rpc/learning_adventure_wallet", "", "POST", {
        p_family: family.adventureFamilyId,
        p_hero: hero.id,
        p_claim_login: action === "claimLogin"
      });
      return respond(req, {
        ok: true,
        wallet: result
      });
    }
    if (action === "load") {
      const [ledger, exams] = await Promise.all([
        db("learning_adventure_xp_ledger", "hero_id=eq." + hero.id + "&select=world,amount&limit=3000"),
        db("learning_adventure_promotion_exams", "hero_id=eq." + hero.id + "&select=id,level_before,correct_count,passed,completed_at,started_at&order=started_at.desc&limit=20")
      ]);
      const islandXP = {
        chengyu: 0,
        vocab: 0
      };
      for (const x of ledger)islandXP[x.world] = (islandXP[x.world] || 0) + Number(x.amount || 0);
      const pending = await activeExam(hero.id, hero.verified_level);
      return respond(req, {
        ok: true,
        hero: publicHero(hero),
        islandXP,
        exams,
        pendingExam: visibleExam(pending)
      });
    }
    if (action === "setAvatarStyle") {
      const style = input?.avatarStyle;
      if (![
        "boy",
        "girl"
      ].includes(style)) return fail(req, "請選擇男生或女生角色造型");
      const rows = await db("learning_adventure_heroes", "id=eq." + hero.id + "&adventure_family_id=eq." + family.adventureFamilyId, "PATCH", {
        avatar_style: style
      });
      if (!rows.length) return fail(req, "無法更新角色造型", 409);
      return respond(req, {
        ok: true,
        hero: publicHero(rows[0])
      });
    }
    if (action === "chooseProfession") {
      const role = input?.profession;
      if (![
        "warrior",
        "mage",
        "ranger",
        "guardian"
      ].includes(role)) return fail(req, "請選擇職業");
      if (!hero.avatar_style) return fail(req, "請先選擇角色造型");
      const rows = await db("learning_adventure_heroes", "id=eq." + hero.id + "&adventure_family_id=eq." + family.adventureFamilyId + "&profession=is.null", "PATCH", {
        profession: role
      });
      if (!rows.length) {
        const fresh = await heroFor(family, learnerId);
        return fail(req, fresh?.profession ? "職業已選定；未經確認不能重選" : "無法設定職業", 409);
      }
      return respond(req, {
        ok: true,
        hero: publicHero(rows[0])
      });
    }
    if (action === "startExam") {
      if (!hero.profession) return fail(req, "請先選擇冒險職業");
      if (hero.verified_level >= 100) return fail(req, "已達最高等級");
      if (hero.total_xp < threshold(hero.verified_level)) return fail(req, "XP 尚未達到升級門檻");
      let exam = await activeExam(hero.id, hero.verified_level);
      if (!exam) {
        const questions = await buildQuestions(family, hero);
        const newExam = await db("learning_adventure_promotion_exams", "", "POST", {
          hero_id: hero.id,
          level_before: hero.verified_level,
          questions
        });
        exam = newExam[0];
      }
      return respond(req, {
        ok: true,
        exam: visibleExam(exam),
        hero: publicHero(hero)
      });
    }
    if (action === "submitExam") {
      const examId = input?.examId, answers = input?.answers;
      if (!uuid(examId) || !Array.isArray(answers) || answers.length !== 10 || !answers.every((n)=>Number.isInteger(n) && n >= 0 && n <= 3)) return fail(req, "試煉必須完成十道選擇題");
      const exams = await db("learning_adventure_promotion_exams", "id=eq." + examId + "&hero_id=eq." + hero.id + "&select=*&limit=1");
      const exam = exams[0];
      if (!exam) return fail(req, "找不到試煉", 404);
      if (exam.completed_at) return fail(req, "這次試煉已經交卷，請重新挑戰", 409);
      if (exam.level_before !== hero.verified_level) return fail(req, "冒險者等級已更新，請重新開啟", 409);
      if (hero.total_xp < threshold(hero.verified_level)) return fail(req, "XP 不足");
      const correct = exam.questions.reduce((acc, q, i)=>acc + (q.answerIndex === answers[i] ? 1 : 0), 0);
      const passed = correct >= 8;
      const completed = await db("learning_adventure_promotion_exams", "id=eq." + examId + "&hero_id=eq." + hero.id + "&completed_at=is.null", "PATCH", {
        answers,
        correct_count: correct,
        passed,
        completed_at: new Date().toISOString()
      });
      if (!completed.length) return fail(req, "試煉已交卷，請重新開啟", 409);
      if (passed) {
        await db("learning_adventure_heroes", "id=eq." + hero.id + "&verified_level=eq." + hero.verified_level + "&total_xp=gte." + threshold(hero.verified_level), "PATCH", {
          verified_level: hero.verified_level + 1
        });
      }
      const fresh = await heroFor(family, learnerId);
      return respond(req, {
        ok: true,
        correct,
        total: 10,
        passed,
        hero: publicHero(fresh),
        review: exam.questions.map((q, i)=>({
            stem: q.stem,
            chosen: q.choices[answers[i]],
            expected: q.choices[q.answerIndex],
            correct: q.answerIndex === answers[i]
          }))
      });
    }
    return fail(req, "不支援的操作");
  } catch (error) {
    console.error("adventure operation error", String(error));
    return fail(req, "處理冒險資料時發生問題，請稍後再試", 503);
  }
});
