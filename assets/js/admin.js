// 월간꽃밥 관리자 화면 (블록 편집기)
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp,
} from "../vendor/firebase.js";
import { auth, db, ADMIN_DOMAIN, isAdminUser, loadImages, monthLabel, readUrl, toast, el } from "./common.js";
import {
  BLOCKS, OPT, ITEM_OPT, ITEM_EXTRA, newBlock, newItem, renderBlock, cleanHtml, mapImages,
  applyLayout, clampDx, positionItem,
} from "./blocks.js";

const $ = (id) => document.getElementById(id);
const views = { login: $("view-login"), list: $("view-list"), edit: $("view-edit") };
const show = (name) => {
  Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
  document.body.classList.toggle("editing", name === "edit");
};

let current = null, blocks = [], images = {}, existingImages = new Set();
let selectedId = null, selectedItem = null, dirty = false;

// ── 로그인 ──────────────────────────────────────
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-msg").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("login-id").value.trim() + ADMIN_DOMAIN, $("login-pw").value);
  } catch (err) {
    $("login-msg").textContent = "아이디 또는 비밀번호가 맞지 않아요.";
  }
});
$("logout").addEventListener("click", async () => {
  if (dirty && !confirm("저장하지 않은 내용이 있어요. 나갈까요?")) return;
  dirty = false; await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  $("logout").hidden = !isAdminUser(user);
  if (!isAdminUser(user)) { show("login"); return; }
  const editId = new URLSearchParams(location.search).get("edit");
  if (editId) openEditor(editId); else showList();
});

// ── 목록 ────────────────────────────────────────
async function showList() {
  show("list");
  history.replaceState(null, "", location.pathname);
  const box = $("post-list"); box.innerHTML = "<li class='muted'>불러오는 중…</li>";
  try {
    const snap = await getDocs(collection(db, "posts"));
    const posts = []; snap.forEach((d) => posts.push({ id: d.id, ...d.data() }));
    posts.sort((a, b) => (a.id < b.id ? 1 : -1));
    box.innerHTML = "";
    if (!posts.length) box.append(el("li", "muted", "아직 만든 호가 없어요. ‘새 호 만들기’를 눌러 시작하세요."));
    posts.forEach((p) => {
      const li = el("li", "post-row");
      const info = el("div");
      info.append(el("small", null, `${monthLabel(p.id)}${p.no ? ` · 제${p.no}호` : ""}`), el("b", null, p.title || "(제목 없음)"));
      const state = el("span", p.published ? "pill on" : "pill", p.published ? "공개" : "비공개");
      const btns = el("div", "btn-row");
      const view = el("a", "btn", "보기"); view.href = readUrl(p.id); view.target = "_blank";
      const edit = el("button", "btn primary", "편집"); edit.type = "button"; edit.onclick = () => openEditor(p.id);
      btns.append(view, edit);
      li.append(info, state, btns); box.append(li);
    });
  } catch (e) {
    box.innerHTML = ""; box.append(el("li", "error", "목록을 불러오지 못했어요. 관리자 계정인지 확인해 주세요."));
  }
}

$("new-post").addEventListener("click", async () => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const def = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  const id = (prompt("몇 월호인가요? (예: 2027-01)", def) || "").trim();
  if (!id) return;
  if (!/^\d{4}-\d{2}$/.test(id)) { alert("2027-01 처럼 적어주세요."); return; }
  const snap = await getDoc(doc(db, "posts", id));
  if (snap.exists()) { alert("이미 있는 호예요. 목록에서 편집을 눌러주세요."); return; }
  openEditor(id, true);
});

// ── 편집 화면 ───────────────────────────────────
const canvas = $("canvas");

async function openEditor(id, isNew) {
  if (!/^\d{4}-\d{2}$/.test(id)) return showList();
  show("edit");
  history.replaceState(null, "", `?edit=${id}`);
  $("edit-month").textContent = monthLabel(id);
  $("edit-status").textContent = "불러오는 중…";
  canvas.innerHTML = "";
  let post = { no: "", title: "", summary: "", published: false, blocks: null };
  images = {};
  if (!isNew) {
    const snap = await getDoc(doc(db, "posts", id));
    if (snap.exists()) post = { ...post, ...snap.data() };
    images = await loadImages(id);
  }
  current = id;
  existingImages = new Set(Object.keys(images));
  $("f-no").value = post.no || "";
  $("f-title").value = post.title || "";
  $("f-summary").value = post.summary || "";
  $("f-published").checked = !!post.published;
  $("view-link").href = readUrl(id);
  $("delete-post").hidden = !!isNew;
  blocks = Array.isArray(post.blocks) ? structuredClone(post.blocks) : starterBlocks();
  blocks.forEach((b) => { if (!b.id) b.id = newBlock(b.type).id; });
  selectedId = null;
  drawCanvas();
  dirty = false;
  $("edit-status").textContent = isNew ? "새 호예요. 블록을 눌러 내용을 채워주세요." : "";
}

function starterBlocks() {
  const h = newBlock("heading"); h.text = "여는 글"; h.size = "m";
  const t = newBlock("text");
  const it = newBlock("imageText");
  const d = newBlock("divider");
  return [h, t, it, d];
}

const markDirty = () => { dirty = true; $("edit-status").textContent = "저장하지 않은 변경이 있어요"; };
["f-no", "f-title", "f-summary", "f-published"].forEach((id) => $(id).addEventListener("input", markDirty));

const editApi = {
  changed: markDirty,
  pickImage: (cb) => pickImage(cb),
  richFocus: (e) => showFormatBar(e),
  rerender: (b) => { replaceBlock(b); markDirty(); },
};

function drawCanvas() {
  canvas.innerHTML = "";
  canvas.append(addBar(0));
  blocks.forEach((b, i) => { canvas.append(wrapBlock(b), addBar(i + 1)); });
  if (!blocks.length) canvas.append(el("p", "muted center", "아래 ＋ 버튼으로 첫 블록을 넣어보세요."));
  if (selectedId) openPanel(selectedId);
}

function wrapBlock(b) {
  const w = el("div", "blk-edit" + (b.id === selectedId ? " selected" : ""));
  w.dataset.id = b.id;
  const tools = el("div", "blk-tools");
  const handle = el("span", "drag-handle", "⠿ 끌기");
  handle.title = "끌어서 위치 옮기기";
  handle.addEventListener("pointerdown", (e) => startDrag(e, b, w));
  tools.append(handle, el("span", "blk-name", BLOCKS[b.type]?.label || b.type));
  const btn = (label, title, fn) => {
    const x = el("button", null, label); x.type = "button"; x.title = title;
    x.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    tools.append(x);
  };
  btn("↑", "위로", () => move(b, -1));
  btn("↓", "아래로", () => move(b, 1));
  btn("⚙", "설정", () => select(b.id));
  btn("⧉", "복제", () => duplicate(b));
  btn("🗑", "삭제", () => remove(b));
  w.append(tools, renderBlock(b, images, editApi));
  attachLayoutHandles(w, b);
  if (b.type === "free" && selectedItem && selectedItem.block === b.id) {
    w.querySelector(`.free-item[data-item="${selectedItem.item}"]`)?.classList.add("on");
  }
  w.addEventListener("click", () => { if (selectedId !== b.id) select(b.id); });
  return w;
}

function replaceBlock(b) {
  const old = canvas.querySelector(`.blk-edit[data-id="${b.id}"]`);
  if (old) old.replaceWith(wrapBlock(b));
}

function select(id) {
  if (selectedId !== id) selectedItem = null;
  selectedId = id;
  canvas.querySelectorAll(".blk-edit").forEach((w) => w.classList.toggle("selected", w.dataset.id === id));
  openPanel(id);
}

function move(b, dir) {
  const i = blocks.indexOf(b), j = i + dir;
  if (j < 0 || j >= blocks.length) return;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  markDirty(); drawCanvas();
  canvas.querySelector(`.blk-edit[data-id="${b.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
// ── 끌어서 옮기기 ───────────────────────────────
let drag = null;
function startDrag(e, b, w) {
  e.preventDefault(); e.stopPropagation();
  fbar.hidden = true;
  const rect = w.getBoundingClientRect();
  const line = el("div", "drop-line");
  drag = { b, w, line, startY: e.clientY, offset: e.clientY - rect.top, target: blocks.indexOf(b), pointerId: e.pointerId };
  w.classList.add("dragging");
  document.body.classList.add("is-dragging");
  w.after(line);
  window.addEventListener("pointermove", onDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  autoScroll();
}
function onDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.y = e.clientY;
  drag.w.style.transform = `translateY(${e.clientY - drag.startY}px)`;
  // 손가락/마우스 위치보다 아래에 있는 첫 블록 앞이 놓일 자리
  const others = [...canvas.querySelectorAll(".blk-edit")].filter((x) => x !== drag.w);
  let before = null;
  for (const o of others) {
    const r = o.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { before = o; break; }
  }
  if (before) { before.previousElementSibling?.before(drag.line); drag.target = blocks.findIndex((x) => x.id === before.dataset.id); }
  else { canvas.lastElementChild.before(drag.line); drag.target = blocks.length; }
}
function autoScroll() {
  if (!drag) return;
  const y = drag.y, h = window.innerHeight;
  if (y != null) {
    if (y < 80) window.scrollBy(0, -12);
    else if (y > h - 80) window.scrollBy(0, 12);
  }
  requestAnimationFrame(autoScroll);
}
function endDrag(e) {
  if (!drag) return;
  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", endDrag);
  window.removeEventListener("pointercancel", endDrag);
  document.body.classList.remove("is-dragging");
  const { b, target } = drag;
  drag = null;
  const from = blocks.indexOf(b);
  let to = target;
  if (to > from) to -= 1;
  if (to !== from && to >= 0) {
    blocks.splice(from, 1);
    blocks.splice(to, 0, b);
    markDirty();
  }
  selectedId = b.id;
  drawCanvas();
  canvas.querySelector(`.blk-edit[data-id="${b.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function duplicate(b) {
  const copy = structuredClone(b); copy.id = newBlock(b.type).id;
  blocks.splice(blocks.indexOf(b) + 1, 0, copy);
  selectedId = copy.id; markDirty(); drawCanvas();
}
function remove(b) {
  if (!confirm(`‘${BLOCKS[b.type]?.label}’ 블록을 지울까요?`)) return;
  blocks.splice(blocks.indexOf(b), 1);
  if (selectedId === b.id) { selectedId = null; closePanel(); }
  markDirty(); drawCanvas();
}

// ＋ 블록 추가
function addBar(index) {
  const bar = el("div", "blk-add");
  const b = el("button", null, "＋"); b.type = "button"; b.title = "여기에 블록 추가";
  b.addEventListener("click", (e) => { e.stopPropagation(); openPicker(index); });
  bar.append(b);
  return bar;
}
function openPicker(index) {
  const pick = $("picker"), list = $("picker-list");
  list.innerHTML = "";
  Object.entries(BLOCKS).forEach(([type, def]) => {
    const item = el("button", "pick-item"); item.type = "button";
    item.append(el("b", null, def.label), el("small", null, def.desc));
    item.onclick = () => {
      const nb = newBlock(type);
      blocks.splice(index, 0, nb);
      pick.close(); selectedId = nb.id; markDirty(); drawCanvas();
      setTimeout(() => {
        const w = canvas.querySelector(`.blk-edit[data-id="${nb.id}"]`);
        w?.scrollIntoView({ block: "center", behavior: "smooth" });
        w?.querySelector(".editable")?.focus();
      }, 50);
    };
    list.append(item);
  });
  pick.showModal();
}
$("picker-close").addEventListener("click", () => $("picker").close());

// ── 설정 패널 ───────────────────────────────────
const round = (v, step = 0.5) => Math.round(v / step) * step;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function chipsGroup(label, choices, cur, onPick) {
  const g = el("div", "opt-group");
  g.append(el("div", "opt-label", label));
  const row = el("div", "chips");
  choices.forEach(([val, text]) => {
    const c = el("button", "chip" + (String(cur) === String(val) ? " on" : ""), text); c.type = "button";
    c.onclick = () => onPick(val);
    row.append(c);
  });
  g.append(row);
  return g;
}
function slider(label, min, max, step, value, unit, onInput) {
  const row = el("label", "slider-row");
  const val = el("b", null, `${value}${unit}`);
  const inp = el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  inp.addEventListener("input", () => { const v = Number(inp.value); val.textContent = `${v}${unit}`; onInput(v); });
  inp.addEventListener("change", markDirty);
  row.append(el("span", null, label), val, inp);
  return row;
}
const innerOf = (b) => canvas.querySelector(`.blk-edit[data-id="${b.id}"] .blk-inner`);
const itemEl = (b, it) => canvas.querySelector(`.blk-edit[data-id="${b.id}"] .free-item[data-item="${it.id}"]`);

function openPanel(id) {
  const b = blocks.find((x) => x.id === id);
  if (!b) return closePanel();
  const def = BLOCKS[b.type];
  $("panel-title").textContent = `${def.label} 설정`;
  const body = $("panel-body"); body.innerHTML = "";

  // 자유 배치: 고른 글상자·사진 설정을 맨 위에
  if (b.type === "free") freePanel(b, body);

  const keys = [...def.opts, ...(def.noBox ? [] : ["bg", "pad"])];
  keys.forEach((k) => {
    const o = OPT[k];
    if (o.input) {
      const g = el("div", "opt-group");
      g.append(el("div", "opt-label", o.label));
      const inp = el("input"); inp.type = "text"; inp.placeholder = o.placeholder || ""; inp.value = b[k] || "";
      inp.addEventListener("input", () => { b[k] = inp.value.trim(); markDirty(); });
      inp.addEventListener("change", () => replaceBlock(b));
      g.append(inp); body.append(g);
    } else {
      body.append(chipsGroup(o.label, o.choices, b[k], (val) => { b[k] = val; markDirty(); replaceBlock(b); openPanel(id); }));
    }
  });

  // 위치·너비 (모든 블록)
  if (b.type !== "spacer") {
    body.append(el("hr", "panel-sep"), el("div", "opt-label", "위치·너비 (블록의 ✥ 손잡이를 끌어도 돼요)"));
    const relayout = () => { const inner = innerOf(b); if (inner) applyLayout(inner, b); };
    body.append(
      slider("너비", 25, 100, 1, b.w || 100, "%", (v) => { b.w = v; b.dx = clampDx(b, b.dx || 0); relayout(); }),
      slider("가로 위치 (0 = 가운데)", -37.5, 37.5, 0.5, b.dx || 0, "%", (v) => { b.dx = clampDx(b, v); relayout(); }),
      slider("위쪽 간격", -120, 300, 2, b.dy || 0, "px", (v) => { b.dy = v; relayout(); }),
    );
    body.append(el("p", "panel-hint", "가로 위치는 너비를 줄여야 움직여요. 휴대폰에선 화면이 좁아서 가로 위치·너비는 원래대로 보여요. 방향키(←→↑↓)로도 조금씩 옮길 수 있어요."));
    const acts = el("div", "panel-actions");
    const reset = el("button", "chip", "처음 위치로"); reset.type = "button";
    reset.onclick = () => { delete b.w; delete b.dx; delete b.dy; markDirty(); replaceBlock(b); openPanel(id); };
    acts.append(reset); body.append(acts);
  }
  $("panel").hidden = false;
}

function freePanel(b, body) {
  const acts = el("div", "panel-actions");
  const addT = el("button", "chip on", "＋ 글상자"); addT.type = "button";
  const addI = el("button", "chip on", "＋ 사진"); addI.type = "button";
  addT.onclick = () => { const it = newItem("text"); b.items.push(it); selectedItem = { block: b.id, item: it.id }; markDirty(); replaceBlock(b); openPanel(b.id); };
  addI.onclick = () => { const it = newItem("image"); b.items.push(it); selectedItem = { block: b.id, item: it.id }; markDirty(); replaceBlock(b); openPanel(b.id); };
  acts.append(addT, addI); body.append(acts);

  const it = selectedItem && selectedItem.block === b.id ? b.items.find((x) => x.id === selectedItem.item) : null;
  if (!it) {
    body.append(el("p", "panel-hint", "판 안의 글상자나 사진을 누르면 여기서 위치·크기·모양을 바꿀 수 있어요."), el("hr", "panel-sep"));
    return;
  }
  body.append(el("div", "opt-label", it.kind === "text" ? "▸ 고른 글상자" : "▸ 고른 사진"));
  if (it.kind === "image") {
    const pick = el("button", "chip on", it.img ? "사진 바꾸기" : "사진 넣기"); pick.type = "button";
    pick.onclick = () => pickImage((url) => { it.img = url; markDirty(); replaceBlock(b); openPanel(b.id); });
    const a = el("div", "panel-actions"); a.append(pick); body.append(a);
  }
  (ITEM_OPT[it.kind] || []).forEach((k) => {
    const o = ITEM_EXTRA[k] || OPT[k];
    body.append(chipsGroup(o.label, o.choices, it[k], (val) => { it[k] = val; markDirty(); replaceBlock(b); openPanel(b.id); }));
  });
  const repos = () => { const box = itemEl(b, it); if (box) positionItem(box, it); };
  body.append(
    slider("가로 위치", 0, 100, 0.5, it.x, "%", (v) => { it.x = clamp(v, 0, 100 - it.w); repos(); }),
    slider("세로 위치", 0, 100, 0.5, it.y, "%", (v) => { it.y = clamp(v, 0, it.kind === "image" ? 100 - it.h : 98); repos(); }),
    slider("너비", 5, 100, 0.5, it.w, "%", (v) => { it.w = clamp(v, 5, 100 - it.x); repos(); }),
  );
  if (it.kind === "image") body.append(slider("높이", 5, 100, 0.5, it.h, "%", (v) => { it.h = clamp(v, 5, 100 - it.y); repos(); }));
  const order = el("div", "panel-actions");
  const mk = (t, fn) => { const x = el("button", "chip", t); x.type = "button"; x.onclick = fn; order.append(x); };
  mk("맨 앞으로", () => { b.items.splice(b.items.indexOf(it), 1); b.items.push(it); markDirty(); replaceBlock(b); });
  mk("맨 뒤로", () => { b.items.splice(b.items.indexOf(it), 1); b.items.unshift(it); markDirty(); replaceBlock(b); });
  mk("복제", () => { const c = { ...structuredClone(it), id: newItem(it.kind).id, x: clamp(it.x + 3, 0, 100 - it.w), y: clamp(it.y + 3, 0, 95) }; b.items.push(c); selectedItem = { block: b.id, item: c.id }; markDirty(); replaceBlock(b); openPanel(b.id); });
  mk("🗑 지우기", () => { b.items.splice(b.items.indexOf(it), 1); selectedItem = null; markDirty(); replaceBlock(b); openPanel(b.id); });
  body.append(order, el("hr", "panel-sep"));
}

// ── 끌어서 위치·크기 바꾸기 ─────────────────────────
function pointerDrag(e, onMove, onEnd) {
  e.preventDefault(); e.stopPropagation();
  fbar.hidden = true;
  const sx = e.clientX, sy = e.clientY, id = e.pointerId;
  document.body.classList.add("is-dragging");
  const mv = (ev) => { if (ev.pointerId === id) onMove(ev.clientX - sx, ev.clientY - sy); };
  const up = (ev) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", mv);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    document.body.classList.remove("is-dragging");
    onEnd && onEnd();
  };
  window.addEventListener("pointermove", mv);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
function guide(parent, on) {
  let g = parent.querySelector(":scope > .center-guide");
  if (on && !g) { g = el("div", "center-guide"); parent.append(g); }
  if (!on && g) g.remove();
}

function attachLayoutHandles(w, b) {
  if (b.type === "spacer") return;
  const inner = w.querySelector(".blk-inner");
  if (!inner) return;
  const mv = el("span", "bi-move", "✥"); mv.title = "끌어서 위치 옮기기";
  const rs = el("span", "bi-resize"); rs.title = "끌어서 너비 바꾸기";
  inner.append(mv, rs);
  const width = () => inner.parentElement.clientWidth - 40;
  mv.addEventListener("pointerdown", (e) => {
    select(b.id);
    const cw = width(), sdx = b.dx || 0, sdy = b.dy || 0;
    pointerDrag(e, (dx, dy) => {
      let v = round(sdx + (dx / cw) * 100);
      if (Math.abs(v) < 1.5) v = 0; // 가운데에 착 붙게
      b.dx = clampDx(b, v);
      b.dy = clamp(Math.round((sdy + dy) / 2) * 2, -120, 300);
      applyLayout(inner, b);
      guide(inner.parentElement, b.dx === 0 && (b.w || 100) < 100);
    }, () => { guide(inner.parentElement, false); markDirty(); openPanel(b.id); });
  });
  rs.addEventListener("pointerdown", (e) => {
    select(b.id);
    const cw = width(), sw = b.w || 100;
    pointerDrag(e, (dx) => {
      b.w = clamp(Math.round(sw + (2 * dx / cw) * 100), 25, 100);
      b.dx = clampDx(b, b.dx || 0);
      applyLayout(inner, b);
    }, () => { markDirty(); openPanel(b.id); });
  });
}

// 자유 배치 판 안: 누르면 고르고, ✥ 또는 사진을 끌면 이동, 모서리를 끌면 크기
canvas.addEventListener("pointerdown", (e) => {
  const box = e.target.closest(".free-item");
  if (!box) return;
  const board = box.closest(".free-board");
  const b = blocks.find((x) => x.id === board.dataset.block);
  const it = b?.items.find((x) => x.id === box.dataset.item);
  if (!it) return;
  if (selectedId !== b.id) select(b.id);
  const already = selectedItem && selectedItem.item === it.id;
  selectedItem = { block: b.id, item: it.id };
  board.querySelectorAll(".free-item").forEach((x) => x.classList.toggle("on", x === box));
  if (!already) openPanel(b.id);
  const isResize = !!e.target.closest(".fi-resize");
  const isMove = !!e.target.closest(".fi-move") || (it.kind === "image" && !isResize);
  if (!isMove && !isResize) return; // 글상자 안을 누르면 글 고치기
  const r = board.getBoundingClientRect();
  const s0 = { x: it.x, y: it.y, w: it.w, h: it.h };
  pointerDrag(e, (dx, dy) => {
    const px = (dx / r.width) * 100, py = (dy / r.height) * 100;
    if (isResize) {
      it.w = clamp(round(s0.w + px), 5, 100 - it.x);
      if (it.kind === "image") it.h = clamp(round(s0.h + py), 5, 100 - it.y);
    } else {
      let nx = clamp(round(s0.x + px), 0, 100 - it.w);
      if (Math.abs(nx + it.w / 2 - 50) < 1) nx = 50 - it.w / 2; // 가운데 맞춤
      it.x = nx;
      it.y = clamp(round(s0.y + py), 0, it.kind === "image" ? 100 - it.h : 98);
      guide(board, Math.abs(it.x + it.w / 2 - 50) < 0.01);
    }
    positionItem(box, it);
  }, () => { guide(board, false); markDirty(); openPanel(b.id); });
});

// 방향키로 조금씩 옮기기 (글을 쓰는 중이 아닐 때)
document.addEventListener("keydown", (e) => {
  if (views.edit.hidden || !selectedId) return;
  if (e.target.closest?.(".editable, input, textarea, select, button")) return;
  const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = map[e.key]; if (!d) return;
  e.preventDefault();
  const b = blocks.find((x) => x.id === selectedId); if (!b) return;
  const big = e.shiftKey ? 4 : 1;
  const it = selectedItem && selectedItem.block === b.id ? b.items?.find((x) => x.id === selectedItem.item) : null;
  if (it) {
    it.x = clamp(it.x + d[0] * 0.5 * big, 0, 100 - it.w);
    it.y = clamp(it.y + d[1] * 0.5 * big, 0, it.kind === "image" ? 100 - it.h : 98);
    const box = itemEl(b, it); if (box) positionItem(box, it);
  } else {
    b.dx = clampDx(b, (b.dx || 0) + d[0] * 0.5 * big);
    b.dy = clamp((b.dy || 0) + d[1] * 2 * big, -120, 300);
    const inner = innerOf(b); if (inner) applyLayout(inner, b);
  }
  markDirty();
  clearTimeout(window.__panelT); window.__panelT = setTimeout(() => openPanel(b.id), 250);
});

function closePanel() { $("panel").hidden = true; }
$("panel-close").addEventListener("click", () => {
  selectedId = null; selectedItem = null; closePanel();
  canvas.querySelectorAll(".blk-edit.selected").forEach((w) => w.classList.remove("selected"));
});

// ── 글 서식 도구 (굵게, 색, 크기 …) ─────────────────
const fbar = $("format-bar");
let richEl = null;
function showFormatBar(e) {
  richEl = e;
  fbar.hidden = false;
  positionBar();
}
function positionBar() {
  if (!richEl || fbar.hidden) return;
  const r = richEl.getBoundingClientRect();
  const top = Math.max(8, r.top - fbar.offsetHeight - 8);
  fbar.style.top = `${top + window.scrollY}px`;
  fbar.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - fbar.offsetWidth - 8))}px`;
}
window.addEventListener("scroll", positionBar, { passive: true });
document.addEventListener("focusin", (e) => {
  if (!e.target.closest?.(".rich.editable") && !e.target.closest?.("#format-bar")) fbar.hidden = true;
});
fbar.addEventListener("mousedown", (e) => e.preventDefault()); // 글 선택이 풀리지 않게
fbar.addEventListener("click", (e) => {
  const btn = e.target.closest("button"); if (!btn || !richEl) return;
  const cmd = btn.dataset.cmd, val = btn.dataset.val;
  document.execCommand("styleWithCSS", false, cmd === "foreColor");
  if (cmd === "createLink") {
    const url = prompt("연결할 주소를 넣어주세요", "https://");
    if (!url) return;
    document.execCommand("createLink", false, url);
  } else if (cmd === "fontSize") {
    document.execCommand("styleWithCSS", false, false);
    document.execCommand("fontSize", false, val);
    // <font size> 를 사이트 글자 크기 클래스로 바꿔요
    richEl.innerHTML = cleanHtml(richEl.innerHTML);
  } else {
    document.execCommand(cmd, false, val || null);
  }
  richEl.dispatchEvent(new Event("input"));
});

// ── 사진 넣기 ───────────────────────────────────
const fileInput = $("file-input");
let fileCb = null;
function pickImage(cb) { fileCb = cb; fileInput.value = ""; fileInput.click(); }
fileInput.addEventListener("change", async () => {
  const f = fileInput.files[0]; if (!f || !fileCb) return;
  try { fileCb(await compressImage(f)); }
  catch (e) { toast("사진을 넣지 못했어요"); }
  fileCb = null;
});

// 사진 줄이기 (가로세로 최대 1400px, 약 600KB 이하)
async function compressImage(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.85, url = c.toDataURL("image/jpeg", q);
  while (url.length > 800000 && q > 0.4) { q -= 0.1; url = c.toDataURL("image/jpeg", q); }
  return url;
}

async function hashId(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

// ── 저장 / 삭제 ─────────────────────────────────
$("back-to-list").addEventListener("click", () => {
  if (dirty && !confirm("저장하지 않은 내용이 있어요. 목록으로 갈까요?")) return;
  dirty = false; closePanel(); fbar.hidden = true; showList();
});
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

$("save-post").addEventListener("click", async () => {
  const title = $("f-title").value.trim();
  if (!title) { alert("맨 위 ‘제목’을 적어주세요."); $("f-title").focus(); return; }
  const btn = $("save-post"); btn.disabled = true;
  $("edit-status").textContent = "저장하는 중…";
  try {
    const out = structuredClone(blocks);
    out.forEach((b) => { ["html"].forEach((k) => { if (typeof b[k] === "string") b[k] = cleanHtml(b[k]); }); });
    const used = new Set();
    await mapImages(out, async (v) => {
      if (v.startsWith("fsimg:")) { used.add(v.slice(6)); return v; }
      if (!v.startsWith("data:image/")) return "";
      const id = await hashId(v);
      used.add(id);
      if (!existingImages.has(id)) {
        await setDoc(doc(db, "posts", current, "images", id), { data: v });
        existingImages.add(id); images[id] = v;
      }
      return `fsimg:${id}`;
    });
    await setDoc(doc(db, "posts", current), {
      no: Number($("f-no").value) || 0,
      title,
      summary: $("f-summary").value.trim(),
      blocks: out,
      published: $("f-published").checked,
      updatedAt: serverTimestamp(),
    });
    for (const id of [...existingImages]) {
      if (!used.has(id)) { await deleteDoc(doc(db, "posts", current, "images", id)); existingImages.delete(id); }
    }
    // 편집 중인 블록도 저장된 사진 번호로 바꿔둬요 (다음 저장 때 다시 올리지 않게)
    blocks = out; drawCanvas();
    dirty = false;
    $("delete-post").hidden = false;
    $("edit-status").textContent = `저장했어요 (${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`;
    toast($("f-published").checked ? "저장했어요. 사이트에 공개돼요" : "저장했어요 (비공개)");
  } catch (e) {
    console.error(e);
    $("edit-status").textContent = "저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러주세요.";
  }
  btn.disabled = false;
});

$("delete-post").addEventListener("click", async () => {
  if (!confirm(`${monthLabel(current)}호를 통째로 삭제할까요? 되돌릴 수 없어요.`)) return;
  try {
    for (const id of existingImages) await deleteDoc(doc(db, "posts", current, "images", id));
    await deleteDoc(doc(db, "posts", current));
    dirty = false; toast("삭제했어요"); closePanel(); showList();
  } catch (e) { toast("삭제하지 못했어요"); }
});
