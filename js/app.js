/* 파이브릭스 단어블록 — 화면, 작업대, 허브 연결·실행, 듀얼쇼크, 머신러닝 전송, 허브 중계 */
(function () {
  "use strict";
  const PBW = window.PBW;
  const $ = (id) => document.getElementById(id);
  const HUB_KEY = "pbw-hub";
  const wsKey = (hub) => "pbw-ws-" + hub;
  const HUB_LABEL = new Proxy({}, { get: (_, k) => PBW.hubInfo(String(k)).name });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  /* ---------- 코드 색칠 ---------- */
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const TOK = /(#.*$)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(from|import|while|for|in|if|elif|else|not|and|or|True|False|None|break|continue|pass|def|return|global|async|await|lambda|class|try|except|finally|is)\b|\b(Port|Color|Direction|Stop|Button)\.([A-Z_0-9]+)\b|\b(\d+(?:\.\d+)?)\b/gm;
  function paint(code) {
    return code.replace(/\n$/, "").split("\n").map((line) => {
      let html = "", last = 0, m;
      TOK.lastIndex = 0;
      while ((m = TOK.exec(line))) {
        html += esc(line.slice(last, m.index));
        if (m[1]) html += `<span class="t-com">${esc(m[1])}</span>`;
        else if (m[2]) html += `<span class="t-str">${esc(m[2])}</span>`;
        else if (m[3]) html += `<span class="t-kw">${m[3]}</span>`;
        else if (m[4]) html += `${m[4]}.<span class="t-const">${m[5]}</span>`;
        else if (m[6]) html += `<span class="t-num">${m[6]}</span>`;
        last = TOK.lastIndex;
      }
      html += esc(line.slice(last));
      return `<span class="l">${html || " "}</span>`;
    }).join("");
  }

  /* ---------- 대화상자 (alert/confirm/prompt 대체) ---------- */
  // 파이브릭스(MicroPython)는 한글 이름도 돼요. 숫자로 시작하지만 않으면 돼요
  const VAR_RE = /^[\p{L}_][\p{L}\p{N}_ ()]*$/u;
  const PY_WORDS = new Set(["and", "or", "not", "if", "else", "elif", "while", "for", "in", "def", "return", "True", "False", "None", "pass", "break",
    "continue", "import", "from", "global", "class", "lambda", "try", "except", "hub", "robot", "timer", "wait", "radio", "network", "huskylens"]);
  function openDialog({ message, hint, input, value, validate, cancel = true }) {
    return new Promise((resolve) => {
      const dlg = $("dlg"), inp = $("dlg-input"), err = $("dlg-err");
      $("dlg-msg").textContent = message;
      $("dlg-hint").hidden = !hint; $("dlg-hint").textContent = hint || "";
      inp.hidden = !input; inp.value = value ?? "";
      err.hidden = true;
      $("dlg-cancel").hidden = !cancel;
      dlg.hidden = false;
      setTimeout(() => (input ? (inp.focus(), inp.select()) : $("dlg-ok").focus()), 0);
      const done = (r) => { dlg.hidden = true; $("dlg-ok").onclick = $("dlg-cancel").onclick = inp.onkeydown = null; resolve(r); };
      $("dlg-ok").onclick = () => {
        if (!input) return done(true);
        const msg = validate ? validate(inp.value.trim()) : "";
        if (msg) { err.textContent = msg; err.hidden = false; return; }
        done(inp.value);
      };
      $("dlg-cancel").onclick = () => done(input ? null : false);
      inp.onkeydown = (e) => { if (e.key === "Enter") $("dlg-ok").click(); if (e.key === "Escape") $("dlg-cancel").click(); };
    });
  }
  Blockly.dialog.setAlert((message, cb) => openDialog({ message, cancel: false }).then(() => cb && cb()));
  Blockly.dialog.setConfirm((message, cb) => openDialog({ message }).then((ok) => cb(!!ok)));
  Blockly.dialog.setPrompt((message, def, cb) => {
    const isVar = /변수|리스트/.test(message);
    openDialog({
      message, input: true, value: def,
      hint: isVar ? "한글·영어 모두 돼요. 예: 속도, 라인_에러, speed" : "",
      validate: isVar ? (v) => !VAR_RE.test(v) ? "글자, 숫자, 밑줄(_)로 지어 주세요. 숫자로 시작할 수는 없어요."
        : PY_WORDS.has(v) ? `'${v}'는 이미 쓰이는 이름이라 다른 이름이 좋아요.` : "" : null,
    }).then(cb);
  });

  /* ---------- 테마 ---------- */
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const BLOCK = { start: "#C98A00", drive: "#D33C8C", motor: "#2B7FD6", sensor: "#0E9898", hub: "#7E57E8", loop: "#E07A1F",
    math: "#3A9A52", text: "#5E6B86", vars: "#DE4F3A", list: "#E8622E", proc: "#D6457E",
    display: "#6A5ACD", screen: "#0F8A7E", graph: "#B7791F", music: "#C2410C", ext: "#64748B", sound: "#C04FC0", pad: "#3A4BB0", ml: "#B8458F", husky: "#1F7FA8", comm: "#5C6BC0" };
  function makeTheme() {
    const styles = {};
    for (const k of ["drive", "motor", "sensor", "hub", "loop", "pad", "ml", "husky", "comm", "list", "display", "screen", "graph", "music", "sound"]) styles[k + "_blocks"] = { colourPrimary: BLOCK[k] };
    return Blockly.Theme.defineTheme("pybricks-" + Date.now(), {
      base: Blockly.Themes.Classic,
      blockStyles: Object.assign(styles, {
        start_blocks: { colourPrimary: BLOCK.start, hat: "cap" },
        logic_blocks: { colourPrimary: BLOCK.math }, math_blocks: { colourPrimary: BLOCK.math }, text_blocks: { colourPrimary: BLOCK.text },
        variable_blocks: { colourPrimary: BLOCK.vars }, variable_dynamic_blocks: { colourPrimary: BLOCK.vars },
        procedure_blocks: { colourPrimary: BLOCK.proc }, list_blocks: { colourPrimary: BLOCK.list },
      }),
      categoryStyles: Object.fromEntries(Object.entries(BLOCK).map(([k, c]) => [k + "_cat", { colour: c }])),
      componentStyles: {
        workspaceBackgroundColour: css("--surface"), toolboxBackgroundColour: css("--surface"),
        toolboxForegroundColour: css("--ink"), flyoutBackgroundColour: css("--bg"),
        flyoutForegroundColour: css("--ink"), flyoutOpacity: 0.97, scrollbarColour: css("--line"),
        insertionMarkerColour: css("--ink"), insertionMarkerOpacity: 0.25,
      },
      fontStyle: { family: '"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', weight: "600", size: 11 },
      startHats: true,
    });
  }

  /* ---------- 작업대 ---------- */
  let ws, hub = store.get(HUB_KEY) || "", lastCode = null;
  const toast = (msg, ms = 2800) => { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); };
  PBW.toast = toast;

  /* ---------- 확장 기능 ---------- */
  const extKey = (h) => "pbw-ext-" + h;
  const getExts = (h) => { try { return new Set(JSON.parse(store.get(extKey(h)) || "[]")); } catch (e) { return new Set(); } };
  const setExts = (h, set) => store.set(extKey(h), JSON.stringify([...set]));
  function refreshToolbox() { if (ws) ws.updateToolbox(PBW.toolbox(hub, getExts(hub))); }
  function ensureExtsFor(state) {
    const need = PBW.extensionsUsed(state), have = getExts(hub);
    let changed = false;
    for (const e of need) if (!have.has(e)) { have.add(e); changed = true; }
    if (changed) { setExts(hub, have); refreshToolbox(); }
  }
  function openExtDialog() {
    const have = getExts(hub);
    $("ext-list").innerHTML = PBW.EXTENSIONS.map((e) => `<button class="extcard${have.has(e.id) ? " on" : ""}" data-ext="${e.id}" aria-pressed="${have.has(e.id)}">
      <span class="exticon">${e.icon}</span><b>${e.name}</b><span>${e.desc}</span><i>${have.has(e.id) ? "✓ 켜짐" : "추가하기"}</i></button>`).join("");
    $("ext").hidden = false;
  }
  $("ext-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ext]");
    if (!b) return;
    const have = getExts(hub), id = b.dataset.ext;
    if (have.has(id)) {
      const inUse = ws && ws.getAllBlocks(false).some((x) => PBW.extensionsUsed({ type: x.type }).has(id));
      if (inUse) { toast("작업대에 이 확장 블록이 있어서 끌 수 없어요. 블록을 먼저 지워 주세요."); return; }
      have.delete(id);
    } else have.add(id);
    setExts(hub, have); refreshToolbox(); openExtDialog();
  });
  $("ext-close").addEventListener("click", () => { $("ext").hidden = true; });
  $("ext").addEventListener("click", (e) => { if (e.target.id === "ext") $("ext").hidden = true; });

  function render() {
    lastCode = PBW.generate(ws);
    $("out").innerHTML = paint(lastCode.code);
    $("mode").hidden = !lastCode.async;
  }
  function save() { store.set(wsKey(hub), JSON.stringify(Blockly.serialization.workspaces.save(ws))); }
  function migrateOld(state) {
    // 예전 버전: 시작 블록 안에 주행 설정이 있던 형식
    const st = state && state.blocks && state.blocks.blocks && state.blocks.blocks.find((b) => b.type === "pb_start");
    if (st && st.fields && st.fields.LEFT) {
      const setup = { type: "pb_drive_setup", fields: st.fields };
      const first = st.inputs && st.inputs.DO && st.inputs.DO.block;
      if (first) setup.next = { block: first };
      st.inputs = { ...(st.inputs || {}), DO: { block: setup } };
      delete st.fields;
    }
    return state;
  }
  function load(state) {
    ensureExtsFor(state);
    Blockly.Events.disable();
    try { ws.clear(); Blockly.serialization.workspaces.load(migrateOld(state), ws); }
    catch (e) { ws.clear(); Blockly.serialization.workspaces.load(PBW.emptyProgram(), ws); toast("저장된 블록 일부를 불러오지 못했어요."); }
    finally { Blockly.Events.enable(); }
    if (PBW.Project) PBW.Project.applyLocks();
    ws.clearUndo(); ws.scrollCenter(); render(); save();
  }
  function fillHubSel() {
    if ($("hubsel").options.length) return;
    $("hubsel").innerHTML = PBW.HUB_ORDER.map((id) => `<option value="${id}">${PBW.HUBS[id].name}</option>`).join("");
  }
  function setHub(h, { initial, state } = {}) {
    if (!PBW.HUBS[h]) h = "spike";
    fillHubSel();
    if (!initial && ws) save();
    hub = h; store.set(HUB_KEY, h);
    PBW.setHub(h);
    document.documentElement.dataset.hub = h;
    const hi = PBW.hubInfo(h);
    $("hubsel").value = h;
    document.documentElement.style.setProperty("--hubc", hi.color);
    $("connect").textContent = hi.conn === "serial" ? `🔌 ${hi.short} 연결 ▾` : `🔵 ${hi.short} 연결`;
    $("example").innerHTML = `<option value="">예제 불러오기…</option>` + PBW.examples(h).map((e) => `<option value="${e.id}">${e.name}</option>`).join("");
    if (!ws) return;
    // 열려 있던 블록 목록은 닫아요 (안 닫으면 앞 허브의 블록이 그대로 보여요)
    try { ws.getToolbox().clearSelection(); } catch (e) {}
    try { ws.getFlyout() && ws.getFlyout().hide(); } catch (e) {}
    ws.updateToolbox(PBW.toolbox(h, getExts(h)));
    // 포트 칸은 지금 고른 허브 것만 보여줘요
    const ph = hubs.find((x) => x.kind === h && x.portview && x.lastD);
    if (ph) renderTiles(ph, ph.lastD); else { $("ports").hidden = true; tileHub = null; }
    let saved = null;
    try { saved = JSON.parse(store.get(wsKey(h)) || "null"); } catch (e) {}
    if (!saved && h === "spike") { try { saved = JSON.parse(store.get("pybricks-wordblocks-v1") || "null"); } catch (e) {} }
    load(state || (saved && saved.blocks ? saved : PBW.examples(h)[0].make()));
    if (!state && PBW.Project) PBW.Project.onHubChanged();
    updateRobotUi();
  }

  function boot() {
    PBW.setHub(hub || "spike");
    ws = Blockly.inject("blockly", {
      toolbox: PBW.toolbox(hub || "spike", getExts(hub || "spike")), theme: makeTheme(), renderer: "zelos", media: "media/", sounds: false,
      trashcan: false, maxInstances: { pb_start: 1 },
      zoom: { controls: true, wheel: true, pinch: true, startScale: 0.72, maxScale: 2, minScale: 0.35, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: "#8A92A6", snap: false },
    });
    $("loading").hidden = true;
    PBW.registerWorkspace(ws);
    PBW.registerProcedures(ws);
    ws.registerToolboxCategoryCallback("PBW_EXT", () => {
      setTimeout(() => { openExtDialog(); try { ws.getToolbox().clearSelection(); } catch (e) {} }, 0);
      return [{ kind: "label", text: "확장 기능 창에서 골라요" }];
    });
    ws.addChangeListener(Blockly.Events.disableOrphans);
    let t;
    ws.addChangeListener((e) => { if (e.isUiEvent) return; clearTimeout(t); t = setTimeout(() => { PBW.Project.applyLocks(); render(); save(); }, 120); });
    // 음악 블록을 누르면 소리를 미리 들려줘요 (허브가 없어도 돼요)
    ws.addChangeListener((e) => {
      if (e.type !== Blockly.Events.CLICK || !e.blockId || !PBW.Sound) return;
      const b = ws.getBlockById(e.blockId);
      if (b && b.type === "pb_play_rec") { PBW.Rec.play(b.getFieldValue("SND")); return; }
      if (b && PBW.Stage && /^pb_(win|line|bar)_/.test(b.type)) { previewStage(b); return; }
      if (!b || !/^pb_(instr|drum|note_hub|note_value)$/.test(b.type)) return;
      const numOf = (name, def) => {
        const t = b.getInputTargetBlock && b.getInputTargetBlock(name);
        if (!t) return def;
        if (t.type === "math_number") return Number(t.getFieldValue("NUM"));
        if (t.type === "pb_note_value") return 12 * (Number(t.getFieldValue("OCT")) + 1) + Number(t.getFieldValue("NAME"));
        return def;
      };
      const note = b.type === "pb_note_value" ? 12 * (Number(b.getFieldValue("OCT")) + 1) + Number(b.getFieldValue("NAME")) : numOf("NOTE", 60);
      const beats = Math.min(2, numOf("BEATS", 1));
      if (b.type === "pb_drum") PBW.Sound.handle(`@S|drum:${b.getFieldValue("DRUM")}|0|${beats}|120`);
      else PBW.Sound.handle(`@S|${b.type === "pb_instr" ? b.getFieldValue("INST") : "piano"}|${note}|${beats}|120`);
    });
    // 디스플레이·그래프 블록을 누르면 앱 화면 창에 미리 보여줘요 (숫자·글자를 직접 적은 경우)
    function previewStage(b) {
      const lit = (name) => {
        const t = b.getInputTargetBlock(name);
        if (!t) return null;
        if (t.type === "math_number") return Number(t.getFieldValue("NUM"));
        if (t.type === "text") return t.getFieldValue("TEXT");
        return null;
      };
      const c = b.getFieldValue("COLOR"), v = lit("VALUE");
      const H = PBW.Stage.handle;
      switch (b.type) {
        case "pb_win_img": case "pb_win_img_for": return H("@W|img|" + b.getFieldValue("IMG"));
        case "pb_win_text": return H("@W|text|" + (lit("TEXT") ?? "(값)"));
        case "pb_win_bg": return H("@W|bg|" + b.getFieldValue("BG"));
        case "pb_win_clear": return H("@W|clear");
        case "pb_win_hide": return H("@W|hide");
        case "pb_line_open": return H("@G|lineopen");
        case "pb_line_add": return v !== null && H(`@G|line|${c}|${v}`);
        case "pb_line_clear": return H("@G|lineclear|" + c);
        case "pb_line_clear_all": return H("@G|lineclearall");
        case "pb_bar_open": return H("@G|baropen");
        case "pb_bar_set": if (v === null) return; stageBars[c] = v; return H(`@G|bar|${c}|${v}`);
        case "pb_bar_change": stageBars[c] = (stageBars[c] || 0) + (v || 0); return H(`@G|bar|${c}|${stageBars[c]}`);
        case "pb_bar_clear": for (const k in stageBars) delete stageBars[k]; return H("@G|barclear");
      }
    }
    const stageBars = {};
    new ResizeObserver(() => Blockly.svgResize(ws)).observe($("blockly"));
    const retheme = () => ws.setTheme(makeTheme());
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);
    new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    PBW.ML.init();
    PBW.Rec.init();
    PBW.Project.init({
      ws: () => ws, hub: () => hub, code: () => (lastCode ? lastCode.code : PBW.generate(ws).code),
      getExts, setExts: (h, set) => { setExts(h, set); if (h === hub) refreshToolbox(); },
      load, toast, applyLocks: () => PBW.Project.applyLocks(),
      openState: (h, state) => { if (h !== hub) setHub(h, { state }); else load(state); },
      prompt: (msg, def) => openDialog({ message: msg, input: true, value: def }),
      confirm: (msg) => openDialog({ message: msg }).then((ok) => !!ok),
    });
    if (hub) setHub(hub, { initial: true });
    else { setHub("spike", { initial: true }); $("welcome").hidden = false; }
  }

  PBW.onSoundsChanged = () => {
    if (!ws) return;
    for (const b of ws.getAllBlocks(false)) {
      const fld = b.getField && b.getField("SND");
      if (fld) { try { fld.getOptions(false); fld.doValueUpdate_(fld.getValue()); fld.forceRerender(); } catch (e) {} }
    }
    render();
  };
  // 머신러닝 이름이 바뀌면 블록에 보이는 이름도 바꿔요
  PBW.onMlClassesChanged = () => {
    if (!ws) return;
    for (const b of ws.getAllBlocks(false)) {
      const fld = b.getField && b.getField("CLS");
      if (!fld) continue;
      try { fld.getOptions(false); fld.doValueUpdate_(fld.getValue()); fld.forceRerender(); } catch (e) {}
    }
    render();
  };

  /* ---------- 버튼: 작업대 ---------- */
  // 허브 고르기: 위쪽 목록과 첫 화면 버튼 (js/hubs.js 의 허브 목록으로 만들어요)
  fillHubSel();
  $("hubsel").addEventListener("change", (e) => { if (e.target.value !== hub) setHub(e.target.value); });
  const HUB_DESC = { spike: "블루투스로 연결해요. 로봇 인벤터 허브도 돼요.", ev3: "Pybricks 펌웨어를 설치한 EV3를 USB로 연결해요.",
    essential: "블루투스 · 포트 2개", technic: "블루투스 · 포트 4개", city: "블루투스 · 포트 2개" };
  $("welcome-pick").innerHTML = PBW.HUB_ORDER.map((id, i) => `<button data-hubpick="${id}" class="${i < 2 ? "" : "small"}" style="--hubc:${PBW.HUBS[id].color}"><b>${PBW.HUBS[id].name}</b><span>${HUB_DESC[id] || ""}</span></button>`).join("");
  $("welcome-pick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hubpick]"); if (!b) return;
    if (b.dataset.hubpick !== hub) setHub(b.dataset.hubpick);
    $("welcome").hidden = true;
  });
  $("example").addEventListener("change", (e) => {
    const ex = PBW.examples(hub).find((x) => x.id === e.target.value);
    e.target.value = "";
    if (ex) load(ex.make());
  });
  $("undo").addEventListener("click", () => ws && ws.undo(false));
  $("redo").addEventListener("click", () => ws && ws.undo(true));
  function copyText(text, okMsg) {
    const fallback = () => {
      const r = document.createRange(); r.selectNodeContents($("out"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      toast("코드를 선택했어요. 길게 누르거나 Ctrl+C로 복사하세요.");
    };
    try { navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback); } catch (e) { fallback(); }
  }
  /* ---------- 파이썬 코드 숨기기·패널 크기·아래 출력 창 ---------- */
  const side = document.querySelector(".side");
  function setCodeHidden(hidden) {
    document.querySelector(".work").classList.toggle("code-hidden", hidden);
    $("code-open").hidden = !hidden;
    store.set("pbw-codehidden", hidden ? "1" : "");
  }
  $("code-fold").addEventListener("click", () => setCodeHidden(true));
  $("code-open").addEventListener("click", () => setCodeHidden(false));
  setCodeHidden(store.get("pbw-codehidden") === "1");
  // 출력 창: 접기·펼치기, 위쪽 막대를 끌어서 높이 조절
  const consoleEl = $("console");
  function setConsoleOpen(open) {
    consoleEl.classList.toggle("collapsed", !open);
    $("console-toggle").setAttribute("aria-expanded", String(open));
    store.set("pbw-console", open ? "open" : "closed");
    if (open) $("term").scrollTop = $("term").scrollHeight;
  }
  PBW.openConsole = () => setConsoleOpen(true);
  $("console-toggle").addEventListener("click", () => setConsoleOpen(consoleEl.classList.contains("collapsed")));
  // 처음에는 노트북은 펼쳐서, 좁은 화면(태블릿 세로·휴대폰)은 접어서 시작해요
  { const pref = store.get("pbw-console"); setConsoleOpen(pref === null || pref === undefined ? innerWidth >= 900 : pref !== "closed"); }
  const setConsoleH = (px) => { px = Math.round(Math.max(70, Math.min(innerHeight * 0.6, px))); consoleEl.style.setProperty("--consoleh", px + "px"); store.set("pbw-consoleh", String(px)); };
  if (Number(store.get("pbw-consoleh"))) setConsoleH(Number(store.get("pbw-consoleh")));
  $("console-grip").addEventListener("pointerdown", (e) => {
    const grip = $("console-grip"), start = e.clientY, h0 = $("term").getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId); grip.classList.add("drag");
    const move = (ev) => setConsoleH(h0 + (start - ev.clientY));
    const up = () => { grip.classList.remove("drag"); grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
  $("console-grip").addEventListener("keydown", (e) => {
    const h = $("term").getBoundingClientRect().height;
    if (e.key === "ArrowUp") { setConsoleH(h + 30); e.preventDefault(); }
    if (e.key === "ArrowDown") { setConsoleH(h - 30); e.preventDefault(); }
  });
  // ⋯ 메뉴 (펌웨어 설치, 허브 없이 체험, 자동 포트 보기)
  {
    const btn = $("more-btn"), menu = $("moremenu");
    btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) { menu.style.left = ""; menu.style.right = ""; if (menu.getBoundingClientRect().left < 8) { menu.style.left = "0"; menu.style.right = "auto"; } } });
    document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    menu.addEventListener("click", (e) => { if (e.target.closest("button, a")) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
  }
  const work = document.querySelector(".work"), split = $("splitter");
  const setSide = (px) => {
    if (px == null) { work.style.removeProperty("--sidew"); store.set("pbw-sidew", ""); return; }
    const max = Math.max(320, work.clientWidth - 360);
    px = Math.round(Math.max(280, Math.min(max, px)));
    work.style.setProperty("--sidew", px + "px"); store.set("pbw-sidew", String(px));
  };
  if (Number(store.get("pbw-sidew"))) setSide(Number(store.get("pbw-sidew")));
  split.addEventListener("pointerdown", (e) => {
    split.setPointerCapture(e.pointerId); split.classList.add("drag");
    const right = work.getBoundingClientRect().right - parseFloat(getComputedStyle(work).paddingRight);
    const move = (ev) => setSide(right - ev.clientX - 6);
    const up = () => { split.classList.remove("drag"); split.removeEventListener("pointermove", move); split.removeEventListener("pointerup", up); };
    split.addEventListener("pointermove", move); split.addEventListener("pointerup", up);
  });
  split.addEventListener("dblclick", () => setSide(null));
  split.addEventListener("keydown", (e) => {
    const cur = side.getBoundingClientRect().width;
    if (e.key === "ArrowLeft") { setSide(cur + 40); e.preventDefault(); }
    if (e.key === "ArrowRight") { setSide(cur - 40); e.preventDefault(); }
  });
  $("copy").addEventListener("click", () => copyText(lastCode ? lastCode.code : "", "복사했어요! Pybricks Code에 붙여넣어도 돼요."));
  const setTab = (code) => {
    $("app").classList.toggle("show-code", code);
    $("tab-blocks").setAttribute("aria-selected", String(!code));
    $("tab-code").setAttribute("aria-selected", String(code));
    if (!code && ws) setTimeout(() => Blockly.svgResize(ws), 0);
  };
  $("tab-blocks").addEventListener("click", () => setTab(false));
  $("tab-code").addEventListener("click", () => setTab(true));
  $("ml-open").addEventListener("click", () => PBW.ML.open());
  $("ext-open").addEventListener("click", openExtDialog);
  /* ---------- 펌웨어 설치 ---------- */
  const FW_STEPS = {
    spike: [
      "허브에서 <b>USB 케이블을 빼고</b>, 허브를 <b>꺼요</b>.",
      "허브의 <b>블루투스 버튼</b>(오른쪽 위 작은 버튼)을 <b>누른 채로</b> 있어요.",
      "누른 채로 <b>USB 케이블을 노트북에 꽂아요</b>.",
      "블루투스 불빛이 <b>분홍 → 초록 → 파랑 → 꺼짐</b>으로 깜빡이면 버튼을 <b>떼요</b>.",
      "아래 <b>설치 시작</b>을 누르고, 창에서 <b>LEGO Technic Large Hub in DFU Mode</b>를 골라 <b>연결</b>을 눌러요.",
    ],
    ev3: [
      "EV3를 <b>USB 케이블로 노트북에 연결</b>하고, EV3를 <b>꺼요</b>.",
      "EV3의 <b>오른쪽 버튼을 누른 채로</b> 있어요.",
      "누른 채로 <b>가운데 버튼</b>을 눌러 EV3를 켜요.",
      "화면에 <b>Updating...</b> 이 나오면 두 버튼을 모두 <b>떼요</b>.",
      "아래 <b>설치 시작</b>을 누르고, 창에서 <b>LEGO EV3 Firmware Update</b>를 골라 <b>연결</b>을 눌러요.",
    ],
  };
  let fwBusy = false;
  function openFw() {
    const ev3 = hub === "ev3";
    if (!FW_STEPS[hub]) {   // 웹앱에서 설치할 수 없는 허브
      $("fw-title").textContent = `Pybricks 펌웨어 설치 (${HUB_LABEL[hub]})`;
      $("fw-intro").innerHTML = `${HUB_LABEL[hub]}는 웹앱에서 펌웨어를 설치할 수 없어요. 크롬에서 <a href="https://code.pybricks.com" target="_blank" rel="noopener">Pybricks Code</a>를 열고 설정(⚙) → '펌웨어 설치'로 한 번만 설치한 다음, 이 웹앱으로 돌아와 연결하면 돼요.`;
      $("fw-steps").innerHTML = ""; $("fw-win").hidden = true; $("fw-restore").textContent = "";
      $("fw-status").textContent = ""; $("fw-progress").hidden = true;
      $("fw-start").hidden = true; $("fw").hidden = false;
      return;
    }
    $("fw-start").hidden = false;
    $("fw-title").textContent = `Pybricks 펌웨어 설치 (${HUB_LABEL[hub]})`;
    $("fw-intro").textContent = `${HUB_LABEL[hub]}의 레고 공식 펌웨어를 Pybricks ${PBW.Firmware.version}로 바꿔요. 허브마다 한 번만 하면 되고, 2~3분 걸려요. 배터리를 충분히 충전해 주세요.`;
    $("fw-steps").innerHTML = FW_STEPS[hub].map((t) => `<li>${t}</li>`).join("");
    $("fw-win").hidden = ev3 || !/Windows/i.test(navigator.userAgent);
    $("fw-restore").textContent = ev3
      ? "레고 공식 펌웨어로 되돌리려면 Pybricks Code의 '공식 펌웨어 복원'이나 레고 EV3 앱을 쓰면 돼요."
      : "레고 공식 펌웨어로 되돌리려면 Pybricks Code의 '공식 펌웨어 복원'을 쓰고, 그다음 레고 SPIKE 앱에서 허브를 업데이트하면 돼요.";
    $("fw-status").textContent = ""; $("fw-status").className = "fw-status";
    $("fw-progress").hidden = true;
    $("fw").hidden = false;
  }
  const fwCheck = () => {
    const okName = !$("fw-name").value || PBW.nameFits($("fw-name").value);
    $("fw-name-err").hidden = okName;
    $("fw-start").disabled = fwBusy || !okName || !$("fw-agree").checked;
  };
  $("fw-open").addEventListener("click", openFw);
  $("fw-name").addEventListener("input", fwCheck);
  $("fw-agree").addEventListener("change", fwCheck);
  $("fw-close").addEventListener("click", () => { if (!fwBusy) $("fw").hidden = true; });
  $("fw-start").addEventListener("click", async () => {
    const st = $("fw-status"), bar = $("fw-progress");
    // 연결돼 있던 같은 종류 허브는 먼저 끊어요
    for (const h of hubs.filter((x) => x.kind === hub)) { try { await h.disconnect(); } catch (e) {} }
    fwBusy = true; fwCheck(); $("fw-close").disabled = true;
    st.className = "fw-status"; st.textContent = "허브를 고르는 창을 기다리는 중…";
    try {
      const fn = hub === "ev3" ? PBW.Firmware.installEv3 : PBW.Firmware.installSpike;
      const version = await fn({
        hubName: $("fw-name").value.trim(),
        onStatus: (m) => (st.textContent = m + "… 케이블을 빼지 마세요"),
        onProgress: (p) => { bar.hidden = false; bar.value = p; },
      });
      bar.value = 1;
      st.className = "fw-status ok";
      st.textContent = hub === "ev3"
        ? `설치 완료! Pybricks ${version}이(가) 들어갔어요. EV3가 다시 켜지면 '${PBW.hubInfo(hub).short} 연결'을 눌러 보세요.`
        : `설치 완료! Pybricks ${version}이(가) 들어갔어요. USB 케이블을 빼고 허브 가운데 버튼을 눌러 켠 다음 '${PBW.hubInfo(hub).short} 연결'을 눌러 보세요.`;
      term(`펌웨어 설치 완료 (${HUB_LABEL[hub]}, Pybricks ${version})`, "dim");
    } catch (e) {
      bar.hidden = true;
      st.className = "fw-status bad";
      st.textContent = e.noDevice
        ? (hub === "ev3" ? "EV3를 찾지 못했어요. 화면에 Updating... 이 떠 있는지 확인하고 다시 눌러 주세요."
          : "허브를 찾지 못했어요. 블루투스 불빛이 분홍·초록·파랑으로 깜빡이는지 확인하고 다시 눌러 주세요." + (/Windows/i.test(navigator.userAgent) ? " 윈도우라면 아래 드라이버 안내도 확인해 주세요." : ""))
        : e.message || String(e);
      if (e.official) {
        const a = document.createElement("a");
        a.href = PBW.Firmware.officialUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = " Pybricks 공식 사이트 열기 ↗";
        st.appendChild(a);
      }
    } finally {
      fwBusy = false; $("fw-close").disabled = false; fwCheck();
    }
  });

  $("about-open").addEventListener("click", () => { $("about").hidden = false; $("about-close").focus(); });
  $("about-close").addEventListener("click", () => { $("about").hidden = true; });
  $("about").addEventListener("click", (e) => { if (e.target.id === "about") $("about").hidden = true; });

  /* ---------- 허브 연결·실행 ---------- */
  const hubs = [];   // 연결된 허브 목록 (스파이크·EV3 여러 대 가능)
  /* ---------- 오류를 쉬운 말로 + 코드 줄 표시 ---------- */
  const ERR_HINTS = [
    [/ZeroDivisionError/, "0으로 나누었어요. 나누는 수(나머지 블록 포함)가 0이 되지 않게 해 주세요."],
    [/ENODEV|No device|\[Errno 19\]/, "그 포트에 장치가 없어요. 블록에 고른 포트와 실제로 꽂은 포트가 같은지 확인해 주세요."],
    [/EBUSY|\[Errno 16\]/, "같은 포트를 두 번 쓰고 있어요. 주행 모터와 다른 모터가 같은 포트인지 확인해 주세요."],
    [/unsupported types|can't convert str|must be a number|not str/, "숫자 자리에 글자가 들어갔어요. 글자 블록 대신 숫자를 넣었는지 확인해 주세요."],
    [/IndexError/, "리스트에 없는 번호를 썼어요."],
    [/OverflowError/, "숫자가 너무 커요. 허브는 약 10억보다 큰 정수를 다루지 못해요."],
    [/MemoryError/, "허브 메모리가 모자라요. 프로그램이나 리스트를 줄여 보세요."],
    [/NameError/, "아직 정하지 않은 이름을 썼어요."],
    [/ValueError/, "블록에 넣은 값이 허브가 받을 수 없는 범위예요. 숫자를 확인해 주세요."],
    [/TypeError/, "블록에 넣은 값의 종류(숫자·글자·참거짓)가 맞지 않아요."],
  ];
  // 0으로 나누기: 프로그램은 계속 가고, 어디서 그랬는지 알려줘요
  function warnZero(src, n) {
    term(`⚠ ${src.name}: 0으로 나누었어요 (ZeroDivisionError). 프로그램은 멈추지 않고 그 계산을 0으로 했어요. (코드 ${n}번째 줄)`, "hint");
    if (src.kind !== hub) return;
    markCodeLine(n);
    const id = lastCode && lastCode.lineBlocks && lastCode.lineBlocks[n];
    const blk = id && ws.getBlockById(id);
    if (blk) {
      blk.setWarningText("이 나누기에서 0으로 나누었어요. 결과를 0으로 계산했어요.");
      const el = blk.getSvgRoot(); el.classList.remove("pbw-flash"); void el.getBBox(); el.classList.add("pbw-flash");
      setTimeout(() => el.classList.remove("pbw-flash"), 1900);
    }
  }
  function markCodeLine(n) {
    const el = $("out").children[n - 1];
    if (!el) return;
    for (const x of $("out").querySelectorAll(".errline")) x.classList.remove("errline");
    el.classList.add("errline"); el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function explainError(src, line) {
    const at = line.match(/File "[^"]*", line (\d+)/);
    if (at) { src.errLine = Number(at[1]); return; }
    const m = line.match(/^\s*([A-Za-z]+(?:Error|Exception)|OSError)\b/);
    if (!m) return;
    const hint = ERR_HINTS.find(([re]) => re.test(line));
    term(`💡 ${hint ? hint[1] : "프로그램이 오류로 멈췄어요."}${src.errLine ? ` (코드 ${src.errLine}번째 줄)` : ""}`, "hint");
    if (src.errLine && src.kind === hub) markCodeLine(src.errLine);
    src.errLine = 0;
  }
  const term = (text, cls) => {
    const el = $("term");
    const line = document.createElement("div");
    line.textContent = text;
    if (cls) line.className = cls;
    el.appendChild(line);
    while (el.childNodes.length > 300) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
    $("console-last").textContent = text;          // 접어 둬도 마지막 줄은 보여요
    if ((cls === "err" || cls === "hint") && PBW.openConsole) PBW.openConsole();   // 오류는 펼쳐서 보여줘요
  };
  const target = () => hubs.find((h) => h.kind === hub && h.connected);

  function updateRobotUi() {
    const t = target();
    $("run").disabled = !t || t.busy; $("stop").disabled = !t || !t.running || t.portview; $("portview").disabled = !t || t.busy;
    $("portview").textContent = t && t.portview ? "📊 포트 보기 끄기" : "📊 포트 보기";
    $("hubs").innerHTML = hubs.map((h, i) => `<span class="hubchip${h.running && !h.portview ? " run" : ""}">
      <b>${PBW.hubInfo(h.kind).short}</b> ${esc(h.name)} · ${h.portview ? "포트 보는 중" : h.running ? "실행 중" : "대기"}
      <button data-unplug="${i}" aria-label="연결 끊기" title="연결 끊기">✕</button></span>`).join("")
      || `<span class="muted">연결된 허브가 없어요</span>`;
  }
  $("hubs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-unplug]");
    if (b) { const h = hubs[Number(b.dataset.unplug)]; if (h) h.disconnect(); }
  });

  /* ---------- 포트 자동 보기: 허브의 파이썬 입력창(REPL)에 값 읽는 코드를 붙여 넣어요 ----------
   * 다운로드가 아니라서 허브에 저장된 프로그램은 그대로예요. 프로그램을 실행하면 자동으로 꺼지고, 끝나면 다시 켜져요. */
  const AUTO_KEY = "pbw-autoports";
  let autoPorts = store.get(AUTO_KEY) !== "0";
  $("autoports").checked = autoPorts;
  $("autoports").addEventListener("change", (e) => {
    autoPorts = e.target.checked; store.set(AUTO_KEY, autoPorts ? "1" : "0");
    for (const h of hubs) { if (autoPorts) { h.portsOff = false; schedulePorts(h, 100); } else if (h.portview) stopPorts(h, true); }
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function startPorts(h) {
    if (!h.connected || h.running || h.busy || h.portview) return;
    h.portview = true; h.portStart = Date.now(); updateRobotUi();
    try {
      await h.command(h.slots ? [1, 128] : [2]);     // 파이썬 입력창(REPL) 시작
      await sleep(700);
      const code = PBW.portView(h.kind, portModes(h.kind)).replace(/\n/g, "\r\n");
      await h.writeStdin("\x03\x05" + code + "\x04"); // 붙여넣기 모드로 실행
    } catch (e) {
      h.portview = false; updateRobotUi();
    }
  }
  async function stopPorts(h, manual) {
    if (!h.portview) return;
    if (manual) h.portsOff = true;   // 직접 끈 경우엔 다음 실행 전까지 다시 켜지 않아요
    h.portview = false; h.quiet = true;
    try { await h.stop(); } catch (e) {}
    await sleep(300);
    updateRobotUi();
  }
  function schedulePorts(h, ms = 900) {
    clearTimeout(h.portTimer);
    h.portTimer = setTimeout(() => { if (autoPorts && !h.portsOff) startPorts(h); }, ms);
  }

  function relayFrom(src, value) {
    const others = hubs.filter((h) => h !== src && h.connected && !h.portview);
    if (!others.length) { term(`🔗 '${value}' — 받을 다른 허브가 연결돼 있지 않아요`, "dim"); return; }
    for (const h of others) h.writeStdin("R" + value + "\n").catch(() => {});
    term(`🔗 ${src.name} → ${others.map((h) => h.name).join(", ")}: ${value}`, "dim");
  }
  /* ---------- 포트 칸 (스파이크 앱처럼 포트마다 볼 값을 골라요) ---------- */
  const COLOR_KO = { RED: ["빨강", "#E0352B"], ORANGE: ["주황", "#F08A24"], YELLOW: ["노랑", "#F2C82E"], GREEN: ["초록", "#2E9E48"],
    CYAN: ["하늘", "#2BB3D9"], BLUE: ["파랑", "#2F5FD9"], VIOLET: ["보라", "#7D4CD9"], MAGENTA: ["자홍", "#D23C9A"],
    WHITE: ["흰색", "#F4F4F4"], BLACK: ["검정", "#222"], NONE: ["없음", "transparent"], BROWN: ["갈색", "#7A4A24"] };
  const portModes = (kind) => { try { return JSON.parse(store.get("pbw-portmodes-" + kind) || "{}"); } catch (e) { return {}; } };
  const savePortMode = (kind, port, mode) => { const m = portModes(kind); m[port] = mode; store.set("pbw-portmodes-" + kind, JSON.stringify(m)); };
  let tileHub = null;
  function renderTiles(src, list) {
    tileHub = src;
    const kind = src.kind, have = Object.fromEntries(list.filter(Boolean).map((x) => x.split(":")));
    const saved = portModes(kind), MODES = PBW.PORT_MODES[kind];
    const tile = (port, dev) => {
      if (!dev) return `<div class="ptile empty"><b class="pname">${port}</b><span class="pkind">비어 있음</span></div>`;
      const opts = MODES[dev] || [["-", "-"]];
      const sel = saved[port] && opts.some((o) => o[0] === saved[port]) ? saved[port] : opts[0][0];
      return `<div class="ptile" data-port="${port}"><div class="phead"><b class="pname">${port === "HUB" ? "허브" : port}</b>
        <span class="pkind">${PBW.PORT_KIND_LABEL[dev] || dev}</span></div>
        <div class="pval" id="pv-${port}">–</div>
        <select class="pmode" data-port="${port}" aria-label="${port} 볼 값">${opts.map((o) => `<option value="${o[0]}"${o[0] === sel ? " selected" : ""}>${o[1]}</option>`).join("")}</select></div>`;
    };
    $("ports").innerHTML = PBW.PORT_LIST[kind].map((p) => tile(p, have[p])).join("") + tile("HUB", "hub");
    $("ports").hidden = false;
    $("ports").classList.add("tiles");
  }
  function showValues(src, line) {
    if (src !== tileHub) return;
    for (const part of line.split("|").slice(1)) {
      const i = part.indexOf("=");
      const el = document.getElementById("pv-" + part.slice(0, i));
      if (!el) continue;
      const v = part.slice(i + 1);
      const c = COLOR_KO[v];
      if (c && el.closest(".ptile").querySelector(".pmode").value === "color") {
        el.innerHTML = `<i class="swatch" style="background:${c[1]}"></i>${c[0]}`;
      } else el.textContent = v === "True" ? "눌림" : v === "False" ? "안 눌림" : v;
    }
  }
  $("ports").addEventListener("change", (e) => {
    const sel = e.target.closest(".pmode");
    if (!sel || !tileHub) return;
    savePortMode(tileHub.kind, sel.dataset.port, sel.value);
    document.getElementById("pv-" + sel.dataset.port).textContent = "…";
    if (tileHub.portview) tileHub.writeStdin(`S${sel.dataset.port}=${sel.value}\n`).catch(() => {});
  });

  function showPorts(line) {
    $("ports").classList.remove("tiles"); tileHub = null;
    const parts = line.split("|").slice(1);
    const chips = [];
    for (let i = 0; i + 1 < parts.length; i += 2) chips.push(`<span class="port"><i>${esc(parts[i])}</i><b>${esc(parts[i + 1])}</b></span>`);
    $("ports").innerHTML = chips.join("");
    $("ports").hidden = !chips.length;
  }

  $("demo").addEventListener("click", () => {
    if (hubs.some((h) => h instanceof PBW.Hub.DemoHub && h.kind === hub)) { toast("체험용 허브가 이미 연결돼 있어요."); return; }
    connectHub(() => PBW.Hub.DemoHub.request(hub));
  });
  $("connect").addEventListener("click", (e) => {
    const hi = PBW.hubInfo(hub);
    if (!PBW.Hub.supported(hub)) {
      toast(hi.conn === "serial" ? "이 브라우저는 EV3 연결(Web Serial)을 지원하지 않아요. 노트북 크롬이나 엣지에서 설치한 웹앱으로 열어 주세요."
        : "이 브라우저는 블루투스를 지원하지 않아요. 크롬(노트북·안드로이드)에서 설치한 웹앱으로 열어 주세요.", 5000);
      return;
    }
    if (hi.conn !== "serial") { connectHub(() => PBW.Hub.request(hub)); return; }
    // EV3: USB 케이블 / 블루투스 고르기
    e.stopPropagation();
    const m = $("connmenu"); m.hidden = !m.hidden;
  });
  $("connmenu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-via]"); if (!b) return;
    $("connmenu").hidden = true;
    connectHub(() => PBW.Hub.request(hub, b.dataset.via));
  });
  document.addEventListener("click", (e) => { if (!$("connmenu").hidden && !$("connmenu").contains(e.target)) $("connmenu").hidden = true; });
  async function connectHub(open) {
    try {
      const h = await open();
      h.onLine = (line, src) => {
        // 입력창 표시(">>> ", "=== ")가 앞에 붙어 와도 값 줄을 찾아요
        const at = line.search(/@(D|V2?|S|W|G|E)\|/);
        if (at > 0) line = line.slice(at);
        if (line.startsWith("@D|")) { src.lastD = line.split("|").slice(1); return src.kind === hub ? renderTiles(src, src.lastD) : undefined; }
        if (line.startsWith("@V2|")) return showValues(src, line);
        if (line.startsWith("@S|rec:")) return PBW.Rec && PBW.Rec.play(line.split("|")[1].slice(4));
        if (line.startsWith("@S|stop")) return PBW.Rec && PBW.Rec.stopAll();
        if (line.startsWith("@S|")) return PBW.Sound && PBW.Sound.handle(line);
        if (line.startsWith("@W|") || line.startsWith("@G|")) return PBW.Stage && PBW.Stage.handle(line);
        if (line.startsWith("@E|zero|")) return warnZero(src, Number(line.split("|")[2]));
        if (line.startsWith("@V|")) return showPorts(line);
        if (src.portview) {          // 입력창(REPL)에서 나오는 글자는 보여주지 않아요
          // 붙여 넣은 코드가 "=== except OSError:" 처럼 그대로 되돌아오는 줄은 오류가 아니에요
          if (/^\s*[A-Za-z]*(Error|Exception)\b.*:/.test(line) && !/^\s*(===|\.\.\.|>>>)/.test(line) && !/^\s*except\b/.test(line) && !src.portErr) { src.portErr = true; term(`${src.name}: 포트 값을 읽다가 문제가 생겼어요 (${line.trim()})`, "err"); }
          return;
        }
        if (line.startsWith("@R")) return relayFrom(src, line.slice(2));
        term(`${src.name}: ${line}`);
        explainError(src, line);
      };
      h.onStatus = (src) => {
        const was = src.prevRunning; src.prevRunning = src.running;
        if (src.running && !was && !src.portview && PBW.Stage) PBW.Stage.reset();
        if (src.running && !was && !src.portview && ws) for (const b of ws.getAllBlocks(false)) if (b.warning && /^이 나누기/.test(b.warning.getText ? b.warning.getText() : "")) b.setWarningText(null);   // 새로 실행하면 닫았던 창이 다시 열릴 수 있어요
        if (!src.running && was !== false) {
          if (src.portview) {                               // 포트 보기가 저절로 끝났어요
            src.portview = false;
            if (Date.now() - src.portStart < 3000) { src.portsOff = true; term(`${src.name}: 포트 값을 읽지 못했어요. '포트 보기' 버튼으로 다시 해 보세요.`, "dim"); }
          } else if (src.quiet) src.quiet = false;
          else if (was && !src.busy) term(`■ ${src.name} 프로그램이 끝났어요`, "dim");
          if (!src.busy) schedulePorts(src);
        }
        updateRobotUi();
      };
      h.onClose = (src) => {
        clearTimeout(src.portTimer);
        $("ports").hidden = true;
        const i = hubs.indexOf(src); if (i >= 0) hubs.splice(i, 1);
        term(`${src.name} 연결이 끊겼어요`, "dim"); updateRobotUi();
      };
      hubs.push(h);
      term(`${h.name} 연결됨`, "dim");
      updateRobotUi();
      schedulePorts(h, 600);
    } catch (e) {
      if (e && e.name === "NotFoundError") return; // 선택 창을 닫음
      term("연결하지 못했어요: " + (e.message || e), "err");
      term(`${PBW.hubInfo(hub).name}에 Pybricks 펌웨어가 설치돼 있고, Pybricks Code 등 다른 앱이 연결돼 있지 않은지 확인하세요.`, "dim");
    }
  }

  async function downloadAndRun(code, label) {
    const h = target();
    if (!h) return;
    h.busy = true; h.portsOff = false; clearTimeout(h.portTimer);
    updateRobotUi();
    try {
      if (h.portview) await stopPorts(h);
      term(`${label} 준비 중…`, "dim");
      const program = await PBW.Hub.compile(code);
      await h.download(program, (p) => { $("progress").hidden = false; $("progress").value = p; });
      $("progress").hidden = true;
      await h.start();
      term(`▶ ${h.name}에서 실행했어요`, "dim");
    } catch (e) {
      $("progress").hidden = true;
      if (e.compile) { term("코드에 문제가 있어요:", "err"); String(e.message).split("\n").forEach((l) => term(l, "err")); }
      else term("실행하지 못했어요: " + (e.message || e), "err");
      schedulePorts(h);
    } finally { h.busy = false; updateRobotUi(); }
  }
  $("run").addEventListener("click", () => { $("ports").hidden = true; downloadAndRun(lastCode.code, "다운로드"); });
  $("portview").addEventListener("click", () => {
    const h = target(); if (!h) return;
    if (h.portview) { clearTimeout(h.portTimer); stopPorts(h, true); }
    else if (h.running) toast("프로그램이 실행 중이에요. 정지한 다음 눌러 주세요.");
    else { h.portsOff = false; startPorts(h); }
  });
  $("stop").addEventListener("click", () => { const h = target(); if (h) h.stop().catch(() => {}); });
  $("term-clear").addEventListener("click", () => { $("term").textContent = ""; });

  /* ---------- 듀얼쇼크(게임패드) → 허브 ---------- */
  let padLast = "", padTime = 0, padName = "";
  const axisByte = (v) => Math.max(0, Math.min(255, Math.round(((Math.abs(v) < 0.08 ? 0 : v) + 1) * 127.5)));
  function padState() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const p = pads[0];
    if (!p) return null;
    padName = p.id;
    let bits = 0;
    p.buttons.forEach((b, i) => { if (i < 16 && (b.pressed || b.value > 0.5)) bits |= 1 << i; });
    const ax = [p.axes[0] || 0, -(p.axes[1] || 0), p.axes[2] || 0, -(p.axes[3] || 0)];
    return "P" + bits.toString(16).toUpperCase().padStart(4, "0") + ax.map((a) => axisByte(a).toString(16).toUpperCase().padStart(2, "0")).join("");
  }
  /* ---------- 머신러닝 → 허브 ---------- */
  let mlLast = -1, mlTime = 0;
  setInterval(() => {
    const now = performance.now();
    const live = hubs.filter((h) => h.connected && h.running && !h.portview);
    const s = padState();
    $("padstat").textContent = s ? "🎮 연결됨" : "🎮 없음";
    $("padstat").title = s ? padName : "듀얼쇼크를 블루투스나 USB로 연결하고 버튼을 한 번 눌러 주세요";
    if (live.length && s && (s !== padLast || now - padTime > 200)) {
      padLast = s; padTime = now;
      for (const h of live) h.writeStdin(s + "\n").catch(() => {});
    }
    if (live.length && PBW.ML.active()) {
      const id = PBW.ML.current().id || 0;
      if (id !== mlLast || now - mlTime > 500) {
        mlLast = id; mlTime = now;
        for (const h of live) h.writeStdin("M" + id + "\n").catch(() => {});
      }
    }
  }, 50);
  window.addEventListener("gamepadconnected", () => toast("듀얼쇼크가 연결됐어요"));

  window.addEventListener("beforeunload", () => { for (const h of hubs) { try { h.stop(); } catch (e) {} } });

  if (typeof Blockly === "undefined" || typeof python === "undefined") {
    $("loading").textContent = "블록 라이브러리를 불러오지 못했어요. 새로고침해 주세요.";
    return;
  }
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(boot, boot);
})();
