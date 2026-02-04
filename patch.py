import pathlib, re
root = pathlib.Path(__file__).resolve().parent
app_path = root / 'app.js'
css_path = root / 'styles.css'
html_path = root / 'index.html'

text = app_path.read_text('utf-8')

# 1) Add lookupShowZh state (modal-only Chinese toggle)
if 'lookupShowZh' not in text:
    text = text.replace('const state = {', 'const state = {\n  lookupShowZh: false,', 1)

# 2) Clear quiz timer when switching modes (prevents crashes/"卡死")
text = re.sub(
    r'function setMode\(mode\) \{\n\s*state\.mode = mode;',
    'function setMode(mode) {\n    // stop any running quiz timer (prevents crashes when switching tabs)\n    if (state.quizTimerId) { clearInterval(state.quizTimerId); state.quizTimerId = null; }\n    state.mode = mode;',
    text,
    count=1,
)

# 3) Patch openLookup: modal Chinese controlled by lookupShowZh + render examples
#    We replace only the local block (safe, no big refactor)
text = text.replace(
    "$('#lookupTitle').textContent = term;\n    $('#lookupZh').textContent = local.zh || '';\n    $('#lookupDef').textContent = local.def || '';",
    "$('#lookupTitle').textContent = term;\n    $('#lookupZh').textContent = (state.lookupShowZh && local && local.zh) ? local.zh : '';\n    $('#lookupDef').textContent = (local && local.def) ? local.def : '';",
)

# inject example renderer after lookupDef assignment (id lookupExamples in HTML)
if 'lookupExamples' not in text:
    marker = "$('#lookupDef').textContent = (local && local.def) ? local.def : '';"
    insert = marker + "\n\n    const exWrap = document.getElementById('lookupExamples');\n    if (exWrap) {\n      exWrap.innerHTML = '';\n      const exs = (local && Array.isArray(local.examples)) ? local.examples : [];\n      if (exs.length) {\n        exs.slice(0, 8).forEach((ex) => {\n          const item = document.createElement('div');\n          item.className = 'ex-item';\n          const en = document.createElement('div');\n          en.className = 'ex-en';\n          en.textContent = ex.en || '';\n          item.appendChild(en);\n          if (state.lookupShowZh && ex.zh) {\n            const zh = document.createElement('div');\n            zh.className = 'ex-zh';\n            zh.textContent = ex.zh;\n            item.appendChild(zh);\n          }\n          exWrap.appendChild(item);\n        });\n      } else {\n        exWrap.innerHTML = '<div class=\"text-muted small\">No examples.</div>';\n      }\n    }"
    text = text.replace(marker, insert)

# online dictionary: show zh only when lookupShowZh
text = text.replace('if (state.showZh && online.zh) {', 'if (state.lookupShowZh && online.zh) {')

# 4) Fix quiz timer crash: interval must guard missing element
text = text.replace(
    "const timerEl = $('#quizTimer');\n    let remaining = totalSeconds;\n\n    if (state.quizTimerId) clearInterval(state.quizTimerId);\n    state.quizTimerId = setInterval(() => {\n      remaining -= 1;\n      const m = Math.floor(remaining / 60);\n      const s = remaining % 60;\n      timerEl.textContent = `${m}:${String(s).padStart(2,'0')}`;",
    "let remaining = totalSeconds;\n\n    if (state.quizTimerId) clearInterval(state.quizTimerId);\n    state.quizTimerId = setInterval(() => {\n      const timerEl = document.getElementById('quizTimer');\n      if (!timerEl) { clearInterval(state.quizTimerId); state.quizTimerId = null; return; }\n      remaining -= 1;\n      const m = Math.floor(remaining / 60);\n      const s = remaining % 60;\n      timerEl.textContent = `${m}:${String(s).padStart(2,'0')}`;",
)

# 5) Replace renderWordBank with auto-fill grid + debounced search + robust field access

def replace_function(src: str, name: str, new_body: str) -> str:
    m = re.search(rf"function {name}\([^\)]*\) \{{", src)
    if not m:
        raise RuntimeError(f"function {name} start not found")
    i = m.end()
    depth = 1
    while i < len(src):
        ch = src[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
        i += 1
    else:
        raise RuntimeError(f"function {name} end not found")
    return src[:m.start()] + new_body + src[end:]

render_wordbank = r"""function renderWordBank(filter = "") {
    const container = $('#modeContainer');
    container.innerHTML = '';

    const ds = getDataset();
    const words = (ds && Array.isArray(ds.words)) ? ds.words : [];
    const q = (filter || '').trim().toLowerCase();

    const top = document.createElement('div');
    top.className = 'd-flex flex-wrap align-items-center justify-content-between gap-2 mb-3';
    top.innerHTML = `
      <div>
        <div class="h5 mb-0">Word Bank</div>
        <div class="text-muted small">${words.length} items (words + phrases)</div>
      </div>
      <div class="d-flex flex-wrap gap-2 align-items-center">
        <input id="wbSearch" class="form-control" style="min-width:260px" placeholder="Search word / phrase / 中文" value="${escapeHtml(filter||'')}" />
      </div>
    `;
    container.appendChild(top);

    const grid = document.createElement('div');
    grid.className = 'wb-grid';
    container.appendChild(grid);

    const list = q ? words.filter(w => {
      const lemma = (w && (w.lemma||w.term||w.word) ? String(w.lemma||w.term||w.word) : '');
      const zh = (w && w.zh) ? String(w.zh) : '';
      const defn = (w && w.def) ? String(w.def) : '';
      return lemma.toLowerCase().includes(q) || zh.toLowerCase().includes(q) || defn.toLowerCase().includes(q);
    }) : words;

    const frag = document.createDocumentFragment();
    list.slice(0, 1000).forEach((w) => {
      const lemma = (w && (w.lemma||w.term||w.word)) ? String(w.lemma||w.term||w.word) : '';
      if (!lemma) return;
      const zh = (w && w.zh) ? String(w.zh) : '';
      const tag = (w && w.tag) ? String(w.tag) : '';
      const exCount = (w && Array.isArray(w.examples)) ? w.examples.length : 0;

      const card = document.createElement('div');
      card.className = 'wb-card';
      card.innerHTML = `
        <div class="wb-top">
          <div class="wb-lemma">${escapeHtml(lemma)}</div>
          ${tag ? `<span class="badge text-bg-light border">${escapeHtml(tag)}</span>` : ''}
        </div>
        <div class="wb-zh text-muted">${escapeHtml(zh)}</div>
        <div class="wb-meta">${exCount ? `${exCount} example${exCount>1?'s':''}` : 'examples ready'}</div>
        <div class="wb-actions">
          <button class="btn btn-outline-primary btn-sm wb-open">Open</button>
          <button class="btn btn-primary btn-sm wb-add">Add</button>
        </div>
      `;
      card.querySelector('.wb-open').onclick = () => openLookup(lemma);
      card.querySelector('.wb-add').onclick = () => addToWorkbook(lemma);
      frag.appendChild(card);
    });

    grid.appendChild(frag);

    const input = $('#wbSearch');
    if (input) {
      let t = null;
      input.oninput = () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => renderWordBank(input.value), 120);
      };
    }
  }"""

text = replace_function(text, 'renderWordBank', render_wordbank)

app_path.write_text(text, 'utf-8')

# --- Patch HTML: add modal toggle + examples container ---
html = html_path.read_text('utf-8')
if 'lookupExamples' not in html:
    # insert examples block after lookupDef
    html = html.replace(
        '<div id="lookupDef" class="small text-muted"></div>',
        '<div id="lookupDef" class="small text-muted"></div>\n<div class="mt-3">\n  <div class="small fw-semibold mb-2">Examples</div>\n  <div id="lookupExamples" class="lookup-examples"></div>\n</div>'
    )
# add a button in modal header to toggle Chinese in modal
if 'id="toggleLookupZh"' not in html:
    html = html.replace(
        '<h5 class="modal-title" id="lookupTitle">...</h5>',
        '<h5 class="modal-title" id="lookupTitle">...</h5>\n<button id="toggleLookupZh" type="button" class="btn btn-outline-secondary btn-sm ms-2">中文</button>'
    )
html_path.write_text(html, 'utf-8')

# --- Patch CSS: word bank grid + example styles ---
css = css_path.read_text('utf-8')
if '.wb-grid' not in css:
    css += "\n\n/* Word Bank grid (auto-fill) */\n.wb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;}\n.wb-card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:14px;box-shadow:0 2px 10px rgba(0,0,0,.04);display:flex;flex-direction:column;min-height:132px;}\n.wb-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}\n.wb-lemma{font-weight:700;font-size:1.05rem;line-height:1.2;}\n.wb-zh{margin-top:6px;min-height:1.2em;}\n.wb-meta{margin-top:8px;color:rgba(0,0,0,.55);font-size:.85rem;}\n.wb-actions{margin-top:auto;display:flex;gap:8px;justify-content:flex-end;}\n.lookup-examples{display:flex;flex-direction:column;gap:10px;}\n.ex-item{padding:10px 12px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:rgba(13,110,253,.03);}\n.ex-en{font-size:.95rem;}\n.ex-zh{font-size:.9rem;color:rgba(0,0,0,.6);margin-top:4px;}\n"
css_path.write_text(css, 'utf-8')

print('patched ok')
