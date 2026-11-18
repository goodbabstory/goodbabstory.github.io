// 월간꽃밥 관리자 화면 (블록 편집기)
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp,
} from "../vendor/firebase.js";
import { auth, db, ADMIN_DOMAIN, isAdminUser, loadImages, monthLabel, readUrl, toast, el } from "./common.js";
import { BLOCKS, OPT, newBlock, renderBlock, cleanHtml, mapImages } from "./blocks.js";

const $ = (id) => document.getElementById(id);
const views = { login: $("view-login"), list: $("view-list"), edit: $("view-edit") };
const show = (name) => {
  Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
  document.body.classList.toggle("editing", name === "edit");
};

let current = null, blocks = [], images = {}, existingImages = new Set();
let selectedId = null, dirty = false;

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
  tools.append(el("span", "blk-name", BLOCKS[b.type]?.label || b.type));
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
  w.addEventListener("click", () => { if (selectedId !== b.id) select(b.id); });
  return w;
}

function replaceBlock(b) {
  const old = canvas.querySelector(`.blk-edit[data-id="${b.id}"]`);
  if (old) old.replaceWith(wrapBlock(b));
}

function select(id) {
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
function openPanel(id) {
  const b = blocks.find((x) => x.id === id);
  if (!b) return closePanel();
  const def = BLOCKS[b.type];
  $("panel-title").textContent = `${def.label} 설정`;
  const body = $("panel-body"); body.innerHTML = "";
  const keys = [...def.opts, ...(def.noBox ? [] : ["bg", "pad"])];
  keys.forEach((k) => {
    const o = OPT[k];
    const g = el("div", "opt-group");
    g.append(el("div", "opt-label", o.label));
    if (o.input) {
      const inp = el("input"); inp.type = "text"; inp.placeholder = o.placeholder || ""; inp.value = b[k] || "";
      inp.addEventListener("input", () => { b[k] = inp.value.trim(); markDirty(); });
      inp.addEventListener("change", () => replaceBlock(b));
      g.append(inp);
    } else {
      const row = el("div", "chips");
      o.choices.forEach(([val, label]) => {
        const c = el("button", "chip" + (String(b[k]) === String(val) ? " on" : ""), label); c.type = "button";
        c.onclick = () => { b[k] = val; markDirty(); replaceBlock(b); openPanel(id); };
        row.append(c);
      });
      g.append(row);
    }
    body.append(g);
  });
  $("panel").hidden = false;
}
function closePanel() { $("panel").hidden = true; }
$("panel-close").addEventListener("click", () => {
  selectedId = null; closePanel();
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
