
// app.js (Pages-only, Bootstrap UI)
// Features:
// - P1/P2/P3 levels, 5 subjects
// - Read: instruction cards with full sentences; click word => lookup; Shift+click => add to workbook
// - Quiz: auto-generate 10 questions from instructions (MCQ + short answer)
// - Word Bank: >=220 entries per subject (local). Search + lookup modal shows EN/ZH + examples.
// - My Workbook: saved items (words + sentences) with tags and quick review
// - Settings: dataBase URL (route binding) + online dictionary toggle
// Notes:
// - Question banks are *original* practice prompts, not copied from any textbook.
// - You can replace data files with your own exported JSON without changing code.

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    level: localStorage.getItem("p1p3_level") || "p3",
    subject: localStorage.getItem("p1p3_subject") || "math",
    mode: "read",
    showZh: (localStorage.getItem("p1p3_showZh") || "1") === "1",
    dark: (localStorage.getItem("p1p3_dark") || "0") === "1",
    subjects: [],
    cache: new Map(), // url -> json
    instructions: [],
    words: [],
    idx: 0,
    workbook: loadWorkbook(),
    lookupTerm: null,
  };

  const modals = {
    lookup: null,
    settings: null,
  };

  function dataBase() {
    return (window.P1P3_CONFIG?.dataBase || "/data").replace(/\/$/, "");
  }

  async function fetchJSON(url) {
    const full = url.startsWith("http") ? url : `${dataBase()}${url.startsWith("/") ? "" : "/"}${url}`;
    if (state.cache.has(full)) return state.cache.get(full);
    const resp = await fetch(full, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load ${full}: ${resp.status}`);
    const data = await resp.json();
    state.cache.set(full, data);
    return data;
  }

  function savePrefs() {
    localStorage.setItem("p1p3_level", state.level);
    localStorage.setItem("p1p3_subject", state.subject);
    localStorage.setItem("p1p3_showZh", state.showZh ? "1" : "0");
    localStorage.setItem("p1p3_dark", state.dark ? "1" : "0");
  }

  function loadWorkbook() {
    try { return JSON.parse(localStorage.getItem("p1p3_workbook") || '{"items":[]}'); }
    catch { return { items: [] }; }
  }
  function saveWorkbook() {
    localStorage.setItem("p1p3_workbook", JSON.stringify(state.workbook));
  }
  function workbookHas(type, key) {
    return state.workbook.items.some(x => x.type === type && x.key === key);
  }
  function addWorkbook(item) {
    if (workbookHas(item.type, item.key)) return;
    state.workbook.items.unshift({ ...item, ts: Date.now() });
    saveWorkbook();
    renderMode();
    renderHomeCards();
  }
  function removeWorkbook(type, key) {
    state.workbook.items = state.workbook.items.filter(x => !(x.type === type && x.key === key));
    saveWorkbook();
    renderMode();
    renderHomeCards();
  }

  function subjectMeta() {
    return state.subjects.find(s => s.key === state.subject) || { key: state.subject, en: state.subject, zh: state.subject };
  }

  function setDark(on) {
    document.body.classList.toggle("dark", !!on);
    state.dark = !!on;
    savePrefs();
  }

  function tokenizeSentence(s) {
    // split into words, keep punctuation
    const parts = s.split(/(\b[\w']+\b)/g).filter(Boolean);
    return parts.map(p => {
      if (/^\b[\w']+\b$/.test(p)) return { t: "w", v: p };
      return { t: "p", v: p };
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  function makeSentenceHTML(en, zh) {
    const toks = tokenizeSentence(en);
    const enHtml = toks.map(tok => tok.t === "w"
      ? `<span class="tok" data-term="${escapeHtml(tok.v)}">${escapeHtml(tok.v)}</span>`
      : `<span>${escapeHtml(tok.v)}</span>`
    ).join("");
    const zhHtml = zh ? `<div class="text-muted mt-2">${escapeHtml(zh)}</div>` : "";
    return `<div class="sentence">${enHtml}</div>${state.showZh ? zhHtml : ""}`;
  }

  function findLocalWord(term) {
    const t = term.toLowerCase();
    return state.words.find(w => (w.term || "").toLowerCase() === t);
  }

  function findExamples(term, limit = 3) {
    const t = term.toLowerCase();
    const hits = [];
    for (const c of state.instructions) {
      if ((c.en || "").toLowerCase().includes(t)) hits.push(c);
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async function onlineLookup(term) {
    // dictionaryapi.dev for definition, MyMemory for zh translation
    if (!window.P1P3_CONFIG?.onlineDict) return null;
    const out = { defs: [], zh: null, phonetic: null };
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`);
      if (r.ok) {
        const j = await r.json();
        const e = j?.[0];
        out.phonetic = e?.phonetic || (e?.phonetics?.[0]?.text || null);
        const meanings = e?.meanings || [];
        for (const m of meanings.slice(0, 2)) {
          const defs = (m.definitions || []).slice(0, 2).map(d => d.definition).filter(Boolean);
          if (defs.length) out.defs.push({ pos: m.partOfSpeech, defs });
        }
      }
    } catch {}
    try {
      const r2 = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(term)}&langpair=en|zh-CN`);
      if (r2.ok) {
        const j2 = await r2.json();
        const t2 = j2?.responseData?.translatedText;
        if (t2 && typeof t2 === "string") out.zh = t2;
      }
    } catch {}
    if (!out.defs.length && !out.zh) return null;
    return out;
  }

  function speak(term) {
    try {
      const u = new SpeechSynthesisUtterance(term);
      u.lang = "en-US";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
  }

  async function openLookup(term) {
    state.lookupTerm = term;
    $("#lookupTitle").textContent = term;

    const local = findLocalWord(term);
    const examples = findExamples(term, 3);
    const online = await onlineLookup(term);

    const parts = [];
    if (local) {
      parts.push(`<div class="mb-2"><span class="pill me-2">${escapeHtml(local.pos || "word")}</span><strong>${escapeHtml(local.term)}</strong></div>`);
      parts.push(`<div class="fs-5">${escapeHtml(local.zh || "")}</div>`);
    } else {
      parts.push(`<div class="mb-2"><strong>${escapeHtml(term)}</strong></div>`);
    }

    if (online) {
      if (online.phonetic) parts.push(`<div class="text-muted mb-2">${escapeHtml(online.phonetic)}</div>`);
      if (!local?.zh && online.zh && state.showZh) parts.push(`<div class="fs-5">${escapeHtml(online.zh)}</div>`);
      if (online.defs.length) {
        parts.push(`<hr/><div class="fw-semibold mb-2">Definitions</div>`);
        for (const m of online.defs) {
          parts.push(`<div class="mb-2"><span class="pill me-2">${escapeHtml(m.pos || "")}</span>${m.defs.map(d => `<div>• ${escapeHtml(d)}</div>`).join("")}</div>`);
        }
      }
    }

    if (examples.length) {
      parts.push(`<hr/><div class="fw-semibold mb-2">Examples</div>`);
      for (const ex of examples) {
        parts.push(`<div class="border rounded-3 p-2 mb-2">${makeSentenceHTML(ex.en || "", ex.zh || "")}</div>`);
      }
    }

    $("#lookupBody").innerHTML = parts.join("");

    $("#addWorkbookBtn").onclick = () => {
      const zh = local?.zh || (online?.zh || "");
      addWorkbook({ type: "word", key: term.toLowerCase(), term, zh, subject: state.subject, level: state.level });
      modals.lookup.hide();
    };
    $("#speakBtn").onclick = () => speak(term);

    modals.lookup.show();
  }

  function bindSentenceClicks(root) {
    root.addEventListener("click", (e) => {
      const el = e.target.closest(".tok");
      if (!el) return;
      const term = el.getAttribute("data-term");
      if (!term) return;
      if (e.shiftKey) {
        // quick add
        const local = findLocalWord(term) || null;
        addWorkbook({ type: "word", key: term.toLowerCase(), term, zh: local?.zh || "", subject: state.subject, level: state.level });
        return;
      }
      openLookup(term);
    });
  }

  function renderSubjectNav() {
    const nav = $("#subjectNav");
    nav.innerHTML = "";
    nav.classList.add("nav-subject");
    const icons = { math:"bi-calculator", science:"bi-beaker", english:"bi-card-text", chinese:"bi-translate", social_studies:"bi-globe-asia-australia" };
    for (const s of state.subjects) {
      const a = document.createElement("a");
      a.href = "#";
      a.className = "nav-link";
      if (s.key === state.subject) a.classList.add("active");
      a.innerHTML = `<i class="bi ${icons[s.key] || "bi-journal"}"></i><span>${escapeHtml(s.en)} <span class="text-muted">(${escapeHtml(s.zh)})</span></span>`;
      a.onclick = (ev) => { ev.preventDefault(); state.subject = s.key; state.idx = 0; savePrefs(); loadSubject(); };
      nav.appendChild(a);
    }
    // My Workbook shortcut
    const hr = document.createElement("div");
    hr.className = "my-2 border-top";
    nav.appendChild(hr);

    const wb = document.createElement("a");
    wb.href="#";
    wb.className="nav-link";
    wb.innerHTML = `<i class="bi bi-star-fill text-warning"></i><span>My Workbook</span>`;
    wb.onclick = (ev)=>{ ev.preventDefault(); setMode("workbook"); };
    nav.appendChild(wb);

    const st = document.createElement("a");
    st.href="#";
    st.className="nav-link";
    st.innerHTML = `<i class="bi bi-gear"></i><span>Settings</span>`;
    st.onclick = (ev)=>{ ev.preventDefault(); modals.settings.show(); };
    nav.appendChild(st);
  }

  function renderLevelSelect() {
    const sel = $("#levelSelect");
    sel.innerHTML = "";
    for (const lv of ["p1","p2","p3"]) {
      const o = document.createElement("option");
      o.value = lv;
      o.textContent = lv.toUpperCase();
      if (lv === state.level) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      state.level = sel.value;
      state.idx = 0;
      savePrefs();
      loadSubject();
    };
  }

  function renderHomeCards() {
    const c = $("#homeCards");
    const s = subjectMeta();
    const wbCount = state.workbook.items.length;

    c.innerHTML = `
      <div class="col-12 col-lg-6">
        <div class="card card-mini shadow-sm">
          <div class="card-body d-flex align-items-center gap-3">
            <div class="icon"><i class="bi bi-book"></i></div>
            <div class="flex-grow-1">
              <div class="fw-semibold">Word Bank (词库)</div>
              <div class="text-muted small">${state.words.length}+ Words & Phrases • ${s.en} • ${state.level.toUpperCase()}</div>
            </div>
            <button class="btn btn-outline-primary btn-sm" id="gotoBank">Open</button>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-6">
        <div class="card card-mini shadow-sm">
          <div class="card-body d-flex align-items-center gap-3">
            <div class="icon"><i class="bi bi-star"></i></div>
            <div class="flex-grow-1">
              <div class="fw-semibold">My Workbook</div>
              <div class="text-muted small">Saved items for review • ${wbCount} items</div>
            </div>
            <button class="btn btn-outline-primary btn-sm" id="gotoWB">Open</button>
          </div>
        </div>
      </div>

      <div class="col-12">
        <div class="text-muted small mt-2">START PRACTICE</div>
      </div>

      <div class="col-12 col-lg-4">
        <div class="card card-mini shadow-sm h-100 border-start border-4 border-success">
          <div class="card-body">
            <div class="fw-semibold">Foundation (P1/P2)</div>
            <div class="text-muted small mb-3">Basic concepts check</div>
            <button class="btn btn-success btn-sm" id="gotoFoundation">Start</button>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-4">
        <div class="card card-mini shadow-sm h-100 border-start border-4 border-primary">
          <div class="card-body">
            <div class="fw-semibold">P3 Standard</div>
            <div class="text-muted small mb-3">Practice with instruction cards</div>
            <button class="btn btn-primary btn-sm" id="gotoStandard">Start</button>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-4">
        <div class="card card-mini shadow-sm h-100 border-start border-4 border-danger">
          <div class="card-body">
            <div class="fw-semibold">Mock Exam</div>
            <div class="text-muted small mb-3">20 Qns • 30 mins timer</div>
            <button class="btn btn-danger btn-sm" id="gotoMock">Start</button>
          </div>
        </div>
      </div>
    `;

    $("#gotoBank").onclick = () => setMode("bank");
    $("#gotoWB").onclick = () => setMode("workbook");
    $("#gotoFoundation").onclick = () => { state.level = "p1"; $("#levelSelect").value="p1"; savePrefs(); loadSubject(); setMode("quiz"); };
    $("#gotoStandard").onclick = () => { state.level = "p3"; $("#levelSelect").value="p3"; savePrefs(); loadSubject(); setMode("read"); };
    $("#gotoMock").onclick = () => { setMode("quiz", { mock: true }); };
  }

  function setMode(mode, opts = {}) {
    state.mode = mode;
    // tab UI
    $$("#modeTabs .nav-link").forEach(b => b.classList.toggle("active", b.getAttribute("data-mode") === mode));
    renderMode(opts);
  }

  function renderRead() {
    const panel = $("#modePanel");
    if (!state.instructions.length) {
      panel.innerHTML = `<div class="alert alert-warning mb-0">该学科暂无题库（请检查 data 路径或补充 instructions.json）。</div>`;
      return;
    }
    const card = state.instructions[state.idx] || state.instructions[0];
    const s = subjectMeta();
    panel.innerHTML = `
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div class="text-muted">${s.en.toUpperCase()} • ${state.level.toUpperCase()} • <span class="pill">${escapeHtml(card.topic || "practice")}</span></div>
        <div class="text-muted small">#${state.idx + 1}/${state.instructions.length}</div>
      </div>

      <div id="sentenceBox" class="border rounded-4 p-4 bg-body">
        ${makeSentenceHTML(card.en || "", card.zh || "")}
      </div>

      <div class="mode-actions mt-3">
        <button class="btn btn-outline-secondary" id="prevBtn"><i class="bi bi-arrow-left"></i> 上一张</button>
        <button class="btn btn-outline-secondary" id="nextBtn">下一张 <i class="bi bi-arrow-right"></i></button>
        <button class="btn btn-outline-primary" id="randBtn"><i class="bi bi-shuffle"></i> 随机一张</button>
        <button class="btn btn-primary" id="ttsSentenceBtn"><i class="bi bi-volume-up"></i> 读整句</button>
        <button class="btn btn-outline-warning" id="saveSentenceBtn"><i class="bi bi-star"></i> 保存句子</button>
      </div>
      <div class="small text-muted mt-2">
        快捷键：<span class="kbd">←</span>/<span class="kbd">→</span> 翻页；<span class="kbd">R</span> 随机；<span class="kbd">S</span> 保存句子。
      </div>
    `;
    const box = $("#sentenceBox");
    bindSentenceClicks(box);

    $("#prevBtn").onclick = () => { state.idx = (state.idx - 1 + state.instructions.length) % state.instructions.length; renderMode(); };
    $("#nextBtn").onclick = () => { state.idx = (state.idx + 1) % state.instructions.length; renderMode(); };
    $("#randBtn").onclick = () => { state.idx = Math.floor(Math.random() * state.instructions.length); renderMode(); };
    $("#ttsSentenceBtn").onclick = () => speak(card.en || "");
    $("#saveSentenceBtn").onclick = () => addWorkbook({ type:"sentence", key: `${state.level}:${state.subject}:${card.id}`, term: card.en, zh: card.zh || "", subject: state.subject, level: state.level });

    // keyboard
    window.onkeydown = (e) => {
      if (["INPUT","TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key === "ArrowLeft") $("#prevBtn")?.click();
      if (e.key === "ArrowRight") $("#nextBtn")?.click();
      if (e.key.toLowerCase() === "r") $("#randBtn")?.click();
      if (e.key.toLowerCase() === "s") $("#saveSentenceBtn")?.click();
    };
  }

  function renderWordBank(filter = "") {
    const panel = $("#modePanel");
    const q = filter.trim().toLowerCase();
    const items = q
      ? state.words.filter(w => (w.term || "").toLowerCase().includes(q) || (w.zh || "").toLowerCase().includes(q))
      : state.words;

    panel.innerHTML = `
      <div class="mb-3">
        <input id="bankSearch" class="form-control" placeholder="搜索单词/中文 (e.g. classify / measure / 公里)" value="${escapeHtml(filter)}">
      </div>
      <div class="list-group" id="bankList"></div>
    `;

    $("#bankSearch").oninput = (e) => renderWordBank(e.target.value);

    const list = $("#bankList");
    const limit = 200; // UI limit
    items.slice(0, limit).forEach(w => {
      const term = w.term;
      const zh = w.zh || "";
      const saved = workbookHas("word", term.toLowerCase());
      const row = document.createElement("div");
      row.className = "list-group-item d-flex align-items-center gap-3";
      row.innerHTML = `
        <div class="flex-grow-1">
          <div class="fw-semibold">${escapeHtml(term)}</div>
          <div class="text-muted small">${state.showZh ? escapeHtml(zh) : ""}</div>
        </div>
        <button class="btn btn-outline-secondary btn-sm" data-act="view">查看</button>
        <button class="btn ${saved ? "btn-outline-warning" : "btn-primary"} btn-sm" data-act="save">${saved ? "已加入" : "加入"}</button>
      `;
      row.querySelector('[data-act="view"]').onclick = () => openLookup(term);
      row.querySelector('[data-act="save"]').onclick = () => addWorkbook({ type:"word", key: term.toLowerCase(), term, zh, subject: state.subject, level: state.level });
      list.appendChild(row);
    });

    if (items.length > limit) {
      const note = document.createElement("div");
      note.className = "text-muted small mt-2";
      note.textContent = `已显示前 ${limit} 条结果（共 ${items.length} 条）。请继续输入关键词缩小范围。`;
      panel.appendChild(note);
    }
  }

  function pickRandom(arr, n) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }

  function buildQuizQuestions(count = 10) {
    const pool = state.instructions.length ? state.instructions : [];
    const picks = pickRandom(pool, Math.min(count, pool.length));
    // build MCQ by masking a number/word when possible
    return picks.map((c, idx) => {
      const en = c.en || "";
      // try number
      const nums = en.match(/\d+/g) || [];
      if (nums.length) {
        const target = nums[Math.floor(Math.random()*nums.length)];
        const blanked = en.replace(target, "____");
        const correct = target;
        const opts = new Set([correct]);
        while (opts.size < 4) {
          const v = String(Math.max(0, parseInt(correct,10) + (Math.floor(Math.random()*41)-20)));
          opts.add(v);
        }
        const choices = Array.from(opts);
        // shuffle
        for (let i=choices.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [choices[i],choices[j]]=[choices[j],choices[i]]; }
        return { id: c.id, type:"mcq", prompt: blanked, zh: c.zh || "", answer: correct, choices };
      }
      // else pick a keyword to blank
      const words = (en.match(/\b[a-zA-Z]{4,}\b/g) || []).filter(w => w.length<=12);
      if (words.length) {
        const target = words[Math.floor(Math.random()*words.length)];
        const blanked = en.replace(new RegExp(`\\b${target}\\b`), "____");
        const correct = target;
        const opts = new Set([correct]);
        while (opts.size < 4) {
          const w = state.words[Math.floor(Math.random()*state.words.length)]?.term || "test";
          opts.add(w);
        }
        const choices = Array.from(opts);
        for (let i=choices.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [choices[i],choices[j]]=[choices[j],choices[i]]; }
        return { id: c.id, type:"mcq", prompt: blanked, zh: c.zh || "", answer: correct, choices };
      }
      return { id: c.id, type:"short", prompt: en, zh: c.zh || "", answer: "" };
    });
  }

  function renderQuiz(opts = {}) {
    const panel = $("#modePanel");
    if (!state.instructions.length) {
      panel.innerHTML = `<div class="alert alert-warning mb-0">该学科暂无题库，无法生成测验。请补充 instructions.json。</div>`;
      return;
    }
    const total = opts.mock ? 20 : 10;
    const durationMin = opts.mock ? 30 : 8;
    const questions = buildQuizQuestions(total);
    const quizId = `quiz_${Date.now()}`;
    let remaining = durationMin * 60;

    panel.innerHTML = `
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div class="fw-semibold">${opts.mock ? "Mock Exam" : "Quick Quiz"} • ${total} Qns</div>
        <div class="text-muted">Timer: <span id="timer">${formatTime(remaining)}</span></div>
      </div>
      <div id="quizList"></div>
      <div class="mt-3 d-flex gap-2 flex-wrap">
        <button class="btn btn-primary" id="submitQuiz">提交</button>
        <button class="btn btn-outline-secondary" id="regenQuiz">重新生成</button>
      </div>
      <div id="quizResult" class="mt-3"></div>
    `;

    const list = $("#quizList");
    questions.forEach((q, i) => {
      const wrap = document.createElement("div");
      wrap.className = "mb-3";
      wrap.innerHTML = `
        <div class="fw-semibold mb-2">Q${i+1}. ${escapeHtml(q.prompt)}</div>
        ${state.showZh && q.zh ? `<div class="text-muted small mb-2">${escapeHtml(q.zh)}</div>` : ""}
        ${q.type==="mcq" ? `
          <div class="d-flex flex-column gap-1">
            ${q.choices.map((c, idx) => `
              <label class="d-flex align-items-center gap-2">
                <input type="radio" name="${quizId}_${i}" value="${escapeHtml(c)}">
                <span>${escapeHtml(c)}</span>
              </label>
            `).join("")}
          </div>
        ` : `
          <input class="form-control" placeholder="Your answer">
        `}
      `;
      list.appendChild(wrap);
    });

    const t = setInterval(() => {
      remaining--;
      $("#timer").textContent = formatTime(remaining);
      if (remaining <= 0) { clearInterval(t); $("#submitQuiz").click(); }
    }, 1000);

    $("#submitQuiz").onclick = () => {
      clearInterval(t);
      let correct = 0;
      const details = [];
      questions.forEach((q, i) => {
        if (q.type !== "mcq") return;
        const sel = $(`input[name="${quizId}_${i}"]:checked`);
        const val = sel ? sel.value : "";
        const ok = val === q.answer;
        if (ok) correct++;
        details.push({ i: i+1, ok, val, ans: q.answer, prompt: q.prompt });
      });
      const score = `${correct}/${details.length || total}`;
      $("#quizResult").innerHTML = `
        <div class="alert alert-info">
          Score: <strong>${score}</strong>
          <div class="small text-muted mt-1">提示：本测验根据题库自动生成（遮挡数字/关键词），用于快速检查概念。</div>
        </div>
      `;
    };

    $("#regenQuiz").onclick = () => renderQuiz(opts);
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function renderWorkbook() {
    const panel = $("#modePanel");
    const items = state.workbook.items;
    if (!items.length) {
      panel.innerHTML = `<div class="alert alert-secondary mb-0">你的单词本还是空的。去 Read 或 Word Bank 里点击 <i class="bi bi-bookmark-plus"></i> 加入吧。</div>`;
      return;
    }
    panel.innerHTML = `
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <div class="fw-semibold">My Workbook • ${items.length} items</div>
        <button class="btn btn-outline-danger btn-sm" id="clearWB">清空</button>
      </div>
      <div class="list-group" id="wbList"></div>
    `;
    const list = $("#wbList");
    items.slice(0, 500).forEach(it => {
      const row = document.createElement("div");
      row.className = "list-group-item d-flex align-items-start gap-3";
      const label = it.type === "word" ? "WORD" : "SENTENCE";
      row.innerHTML = `
        <div class="text-muted small" style="width:88px;"><span class="pill">${label}</span></div>
        <div class="flex-grow-1">
          <div class="fw-semibold">${escapeHtml(it.term || "")}</div>
          ${state.showZh && it.zh ? `<div class="text-muted small">${escapeHtml(it.zh)}</div>` : ""}
          <div class="text-muted small mt-1">${escapeHtml((it.level||"").toUpperCase())} • ${escapeHtml(it.subject || "")}</div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-secondary btn-sm" data-act="view">查看</button>
          <button class="btn btn-outline-danger btn-sm" data-act="del">删除</button>
        </div>
      `;
      row.querySelector('[data-act="view"]').onclick = () => {
        if (it.type === "word") openLookup(it.term);
        else {
          // sentence view
          $("#lookupTitle").textContent = "Sentence";
          $("#lookupBody").innerHTML = `<div class="border rounded-3 p-3">${makeSentenceHTML(it.term || "", it.zh || "")}</div>`;
          $("#addWorkbookBtn").onclick = () => {};
          $("#speakBtn").onclick = () => speak(it.term || "");
          modals.lookup.show();
        }
      };
      row.querySelector('[data-act="del"]').onclick = () => removeWorkbook(it.type, it.key);
      list.appendChild(row);
    });

    $("#clearWB").onclick = () => {
      if (!confirm("确定清空单词本？")) return;
      state.workbook.items = [];
      saveWorkbook();
      renderMode();
      renderHomeCards();
    };
  }

  function renderMode(opts = {}) {
    if (state.mode === "read") return renderRead();
    if (state.mode === "quiz") return renderQuiz(opts);
    if (state.mode === "bank") return renderWordBank($("#globalSearch").value || "");
    if (state.mode === "workbook") return renderWorkbook();
  }

  function bindTopControls() {
    $("#toggleZh").checked = state.showZh;
    $("#toggleZh").onchange = (e) => { state.showZh = e.target.checked; savePrefs(); renderHomeCards(); renderMode(); };

    $("#toggleDark").checked = state.dark;
    $("#toggleDark").onchange = (e) => setDark(e.target.checked);

    $("#globalSearch").oninput = (e) => {
      // global search: jump to word bank
      if (state.mode !== "bank") setMode("bank");
      renderWordBank(e.target.value);
    };

    // mode tabs
    $$("#modeTabs .nav-link").forEach(b => {
      b.onclick = () => setMode(b.getAttribute("data-mode"));
    });

    // Settings modal
    $("#openSettingsLink").onclick = (e) => { e.preventDefault(); modals.settings.show(); };
    $("#saveSettingsBtn").onclick = () => {
      const v = ($("#dataBaseInput").value || "/data").trim();
      localStorage.setItem("p1p3_dataBase", v || "/data");
      window.P1P3_CONFIG.dataBase = v || "/data";
      const on = $("#enableOnlineDict").checked;
      localStorage.setItem("p1p3_onlineDict", on ? "1" : "0");
      window.P1P3_CONFIG.onlineDict = on;
      $("#dataBaseLabel").textContent = window.P1P3_CONFIG.dataBase;
      state.cache.clear();
      modals.settings.hide();
      init().catch(err => alert(err.message));
    };
  }

  async function loadSubject() {
    savePrefs();
    const s = subjectMeta();
    $("#pageTitle").textContent = `${s.en.toUpperCase()}`;
    // load instructions + words
    try {
      state.instructions = await fetchJSON(`/${state.level}/${state.subject}/instructions.json`);
      state.words = await fetchJSON(`/${state.level}/${state.subject}/words.json`);
    } catch (e) {
      console.error(e);
      state.instructions = [];
      state.words = [];
    }
    renderHomeCards();
    renderMode();
  }

  async function init() {
    $("#dataBaseLabel").textContent = dataBase();
    // register SW
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(()=>{});
    }
    modals.lookup = new bootstrap.Modal($("#lookupModal"));
    modals.settings = new bootstrap.Modal($("#settingsModal"));

    // settings initial values
    $("#dataBaseInput").value = window.P1P3_CONFIG.dataBase;
    $("#enableOnlineDict").checked = !!window.P1P3_CONFIG.onlineDict;

    setDark(state.dark);

    state.subjects = await fetchJSON("/subjects.json");
    renderLevelSelect();
    renderSubjectNav();
    bindTopControls();
    await loadSubject();
  }

  init().catch(err => {
    console.error(err);
    $("#pageTitle").textContent = "Failed to load";
    $("#modePanel").innerHTML = `<div class="alert alert-danger">加载失败：${escapeHtml(err.message)}</div>`;
  });
})();
