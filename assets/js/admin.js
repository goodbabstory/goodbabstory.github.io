// 월간꽃밥 관리자 화면
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp,
} from "../vendor/firebase.js";
import { Editor } from "../vendor/editor.js";
import { auth, db, ADMIN_DOMAIN, isAdminUser, loadImages, monthLabel, readUrl, toast, el } from "./common.js";

const $ = (id) => document.getElementById(id);
const views = { login: $("view-login"), list: $("view-list"), edit: $("view-edit") };
const show = (name) => Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });

let editor = null, current = null, dirty = false, existingImages = new Set();

// ── 로그인 ──────────────────────────────────────
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("login-id").value.trim(), pw = $("login-pw").value;
  $("login-msg").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, id + ADMIN_DOMAIN, pw);
  } catch (err) {
    $("login-msg").textContent = "아이디 또는 비밀번호가 맞지 않아요.";
  }
});
$("logout").addEventListener("click", async () => {
  if (dirty && !confirm("저장하지 않은 내용이 있어요. 나갈까요?")) return;
  dirty = false; await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
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
  const def = `${now.getFullYear()}-${String(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2).padStart(2, "0")}`;
  const id = prompt("몇 월호인가요? (예: 2027-01)", def);
  if (!id) return;
  if (!/^\d{4}-\d{2}$/.test(id.trim())) { alert("2027-01 처럼 적어주세요."); return; }
  const snap = await getDoc(doc(db, "posts", id.trim()));
  if (snap.exists()) { alert("이미 있는 호예요. 목록에서 편집을 눌러주세요."); return; }
  openEditor(id.trim(), true);
});

// ── 편집 ────────────────────────────────────────
async function openEditor(id, isNew) {
  if (!/^\d{4}-\d{2}$/.test(id)) return showList();
  show("edit");
  history.replaceState(null, "", `?edit=${id}`);
  $("edit-month").textContent = monthLabel(id);
  $("edit-status").textContent = "불러오는 중…";
  let post = { no: "", title: "", summary: "", body: "", published: false };
  let images = {};
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

  const md = String(post.body || "").replace(/fsimg:([a-z0-9]+)/g, (_, k) => images[k] || "");
  if (!editor) {
    editor = new Editor({
      el: $("editor"),
      height: "640px",
      initialEditType: "wysiwyg",
      previewStyle: "tab",
      language: "ko-KR",
      usageStatistics: false,
      hideModeSwitch: false,
      placeholder: "여기에 소식을 써주세요. 사진은 위쪽 사진 버튼으로 넣을 수 있어요.",
      toolbarItems: [["heading", "bold", "italic", "strike"], ["hr", "quote"], ["ul", "ol"], ["table", "image", "link"]],
      hooks: {
        addImageBlobHook: async (blob, callback) => {
          try { callback(await compressImage(blob), "사진"); }
          catch (e) { toast("사진을 넣지 못했어요"); }
        },
      },
      events: { change: () => { dirty = true; } },
    });
  }
  editor.setMarkdown(md, false);
  dirty = false;
  $("edit-status").textContent = isNew ? "새 호예요. 다 쓰고 저장을 눌러주세요." : "";
}

["f-no", "f-title", "f-summary", "f-published"].forEach((id) => $(id).addEventListener("input", () => { dirty = true; }));

$("back-to-list").addEventListener("click", () => {
  if (dirty && !confirm("저장하지 않은 내용이 있어요. 목록으로 갈까요?")) return;
  dirty = false; showList();
});
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

// 사진 줄이기 (가로 최대 1400px, 용량 약 600KB 이하)
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

$("save-post").addEventListener("click", async () => {
  const title = $("f-title").value.trim();
  if (!title) { alert("제목을 적어주세요."); return; }
  const btn = $("save-post"); btn.disabled = true;
  $("edit-status").textContent = "저장하는 중…";
  try {
    let md = editor.getMarkdown();
    // 본문 안의 사진을 따로 저장하고, 본문에는 사진 번호만 남겨요
    const found = [...md.matchAll(/\]\((data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)\)/g)].map((m) => m[1]);
    const used = new Set();
    for (const data of [...new Set(found)]) {
      const id = await hashId(data);
      used.add(id);
      if (!existingImages.has(id)) {
        await setDoc(doc(db, "posts", current, "images", id), { data });
        existingImages.add(id);
      }
      md = md.split(data).join(`fsimg:${id}`);
    }
    await setDoc(doc(db, "posts", current), {
      no: Number($("f-no").value) || 0,
      title,
      summary: $("f-summary").value.trim(),
      body: md,
      published: $("f-published").checked,
      updatedAt: serverTimestamp(),
    });
    // 더 이상 쓰지 않는 사진 정리
    for (const id of [...existingImages]) {
      if (!used.has(id)) { await deleteDoc(doc(db, "posts", current, "images", id)); existingImages.delete(id); }
    }
    dirty = false;
    $("delete-post").hidden = false;
    $("edit-status").textContent = `저장했어요 (${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})`;
    toast($("f-published").checked ? "저장했어요. 사이트에 공개돼요" : "저장했어요 (비공개)");
  } catch (e) {
    console.error(e);
    $("edit-status").textContent = "저장하지 못했어요. 사진이 너무 크면 줄여서 다시 넣어주세요.";
  }
  btn.disabled = false;
});

$("delete-post").addEventListener("click", async () => {
  if (!confirm(`${monthLabel(current)}호를 통째로 삭제할까요? 되돌릴 수 없어요.`)) return;
  try {
    for (const id of existingImages) await deleteDoc(doc(db, "posts", current, "images", id));
    await deleteDoc(doc(db, "posts", current));
    dirty = false; toast("삭제했어요"); showList();
  } catch (e) { toast("삭제하지 못했어요"); }
});
