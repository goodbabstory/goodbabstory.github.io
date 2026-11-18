// 소식지 읽기 화면: 본문, 좋아요, 댓글(이름+비밀번호)
import {
  doc, getDoc, collection, query, orderBy, limit, onSnapshot, writeBatch,
  increment, serverTimestamp, signInAnonymously, onAuthStateChanged,
} from "../vendor/firebase.js";
import {
  auth, db, isAdminUser, listPublished, loadImages, monthLabel, readUrl,
  toast, store, el,
} from "./common.js";
import { renderBlocks } from "./blocks.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let issueId = params.get("m");

// ── 본문 ──────────────────────────────────────────
async function loadIssue() {
  let published = [];
  try { published = await listPublished(); } catch (e) { /* 목록 실패해도 본문은 시도 */ }
  if (!issueId && published.length) issueId = published[0].id;
  if (!issueId || !/^\d{4}-\d{2}$/.test(issueId)) return notFound();

  let post;
  try {
    const snap = await getDoc(doc(db, "posts", issueId));
    if (!snap.exists()) return notFound();
    post = snap.data();
  } catch (e) { return notFound(); }

  document.title = `${post.title} · 월간꽃밥`;
  const badge = $("issue-badge"); badge.innerHTML = "";
  if (post.no) badge.append(el("span", null, `제${post.no}호`));
  badge.append(el("span", null, monthLabel(issueId)));
  if (!post.published) badge.append(el("span", "new", "비공개 (관리자만 보여요)"));
  $("issue-title").textContent = post.title;
  $("issue-summary").textContent = post.summary || "";

  const body = $("issue-body");
  body.replaceChildren(...renderBlocks(post.blocks, {}));
  let images = {};
  try { images = await loadImages(issueId); } catch (e) { /* 사진 없이 표시 */ }
  if (Object.keys(images).length) body.replaceChildren(...renderBlocks(post.blocks, images));

  // 이전/다음 호
  const i = published.findIndex((p) => p.id === issueId);
  const nav = $("issue-nav"); nav.innerHTML = "";
  const prev = i >= 0 ? published[i + 1] : null, next = i > 0 ? published[i - 1] : null;
  if (prev) { const a = el("a", "prev"); a.href = readUrl(prev.id); a.append(el("small", null, "← 이전 호"), el("span", null, prev.title)); nav.append(a); }
  else nav.append(el("span"));
  if (next) { const a = el("a", "next"); a.href = readUrl(next.id); a.append(el("small", null, "다음 호 →"), el("span", null, next.title)); nav.append(a); }

  $("reactions").hidden = false;
  startReactions();
}

function notFound() {
  $("issue-title").textContent = "소식지를 찾을 수 없어요";
  $("issue-summary").textContent = "주소를 다시 확인해 주세요.";
  $("issue-body").innerHTML = `<p class="center"><a href="${window.SITE_BASE || ""}/">첫 화면으로 가기 →</a></p>`;
}

// ── 비밀번호 (댓글마다 따로 암호화해서 저장) ──────────
async function pwHash(cid, pw) {
  const data = new TextEncoder().encode(`goodbab:${issueId}:${cid}:${pw}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── 좋아요·댓글 ──────────────────────────────────
let uid = null, admin = false, liked = false, busy = false, lastSnap = null;

function startReactions() {
  const issueRef = doc(db, "issues", issueId);
  const commentsRef = collection(db, "issues", issueId, "comments");
  const likeBtn = $("like-btn"), likeCount = $("like-count");
  const list = $("comment-list"), countEl = $("comment-count");
  const form = $("comment-form"), nameIn = $("comment-name"), pwIn = $("comment-pw"), textIn = $("comment-text");
  const submitBtn = $("comment-submit"), msg = $("comment-msg");
  const setMsg = (t, err) => { msg.textContent = t || ""; msg.classList.toggle("error", !!err); };
  const paintLike = () => likeBtn.setAttribute("aria-pressed", liked ? "true" : "false");

  onSnapshot(issueRef, (s) => { likeCount.textContent = s.exists() ? (s.data().likes || 0) : 0; },
    () => { likeCount.textContent = "0"; });

  // 댓글마다 화면 요소를 기억해 두고, 바뀐 내용만 고쳐요 (열어 둔 수정 상자가 닫히지 않게)
  const items = new Map();
  let renderedAdmin = null;
  function render(snap) {
    lastSnap = snap;
    if (renderedAdmin !== admin) { items.clear(); renderedAdmin = admin; }
    countEl.textContent = snap.size || "";
    const seen = new Set();
    const nodes = [];
    snap.forEach((d) => {
      seen.add(d.id);
      let item = items.get(d.id);
      if (!item) { item = commentItem(d); items.set(d.id, item); }
      else item.update(d);
      nodes.push(item.li);
    });
    for (const id of [...items.keys()]) if (!seen.has(id)) items.delete(id);
    if (!nodes.length) nodes.push(el("li", "comment-empty", "첫 번째 댓글을 남겨주세요 🌸"));
    list.replaceChildren(...nodes);
  }

  function commentItem(d) {
    let c = d.data();
    const li = el("li");
    const meta = el("div", "comment-meta");
    const nameEl = el("b"), timeEl = el("time");
    meta.append(nameEl, timeEl);
    const tools = el("span", "comment-tools");
    const editBtn = el("button", null, "수정"); editBtn.type = "button";
    const delBtn = el("button", null, admin ? "삭제(관리자)" : "삭제"); delBtn.type = "button";
    tools.append(editBtn, delBtn); meta.append(tools);
    const p = el("p", "comment-text");
    const box = el("div", "comment-auth"); box.hidden = true;
    li.append(meta, p, box);
    function update(nd) {
      d = nd; c = nd.data();
      const at = c.at && c.at.toDate ? c.at.toDate() : new Date();
      nameEl.textContent = c.name;
      timeEl.textContent = at.toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) + (c.editedAt ? " (수정됨)" : "");
      p.textContent = c.text;
    }
    update(d);

    function openBox(mode) {
      box.innerHTML = ""; box.hidden = false;
      const ta = el("textarea"); ta.value = c.text; ta.maxLength = 500; ta.rows = 3;
      const pw = el("input"); pw.type = "password"; pw.placeholder = "댓글 비밀번호"; pw.autocomplete = "off";
      const ok = el("button", "primary", mode === "edit" ? "수정하기" : "삭제하기"); ok.type = "button";
      const cancel = el("button", null, "취소"); cancel.type = "button";
      const m = el("span", "form-msg");
      const row = el("div", "form-foot"); row.append(m, el("span", "btn-row"));
      row.lastChild.append(cancel, ok);
      if (mode === "edit") box.append(ta);
      box.append(pw, row);
      (mode === "edit" ? ta : pw).focus();
      cancel.onclick = () => { box.hidden = true; };
      ok.onclick = async () => {
        if (!pw.value) { m.textContent = "비밀번호를 적어주세요."; m.classList.add("error"); return; }
        if (mode === "edit" && !ta.value.trim()) { m.textContent = "내용을 적어주세요."; m.classList.add("error"); return; }
        ok.disabled = true;
        try {
          const h = await pwHash(d.id, pw.value);
          const b = writeBatch(db);
          b.set(doc(db, "issues", issueId, "commentProofs", d.id), { hash: h, at: serverTimestamp() });
          if (mode === "edit") {
            b.update(d.ref, { text: ta.value.trim(), editedAt: serverTimestamp() });
          } else {
            b.delete(d.ref);
            b.delete(doc(db, "issues", issueId, "commentKeys", d.id));
          }
          await b.commit();
          box.hidden = true;
          toast(mode === "edit" ? "수정했어요" : "삭제했어요");
        } catch (e) {
          m.textContent = "비밀번호가 맞지 않아요."; m.classList.add("error"); ok.disabled = false;
          pw.value = ""; pw.focus();
        }
      };
    }
    editBtn.onclick = () => openBox("edit");
    delBtn.onclick = async () => {
      if (!admin) return openBox("delete");
      if (!confirm(`"${c.name}"님의 댓글을 삭제할까요?`)) return;
      try {
        const b = writeBatch(db);
        b.delete(d.ref);
        b.delete(doc(db, "issues", issueId, "commentKeys", d.id));
        await b.commit(); toast("삭제했어요");
      } catch (e) { toast("삭제하지 못했어요"); }
    };
    return { li, update };
  }

  onSnapshot(query(commentsRef, orderBy("at", "asc"), limit(300)), render,
    () => { list.innerHTML = '<li class="comment-empty">댓글을 불러오지 못했어요.</li>'; });

  onAuthStateChanged(auth, async (user) => {
    if (!user) { signInAnonymously(auth).catch(() => setMsg("연결이 잠시 불안정해요.", true)); return; }
    uid = user.uid; admin = isAdminUser(user);
    $("admin-bar").hidden = !admin;
    try { liked = (await getDoc(doc(db, "issues", issueId, "likes", uid))).exists(); } catch (e) { liked = false; }
    paintLike();
    if (lastSnap) render(lastSnap);
    likeBtn.disabled = false; submitBtn.disabled = false;
  });

  likeBtn.addEventListener("click", async () => {
    if (!uid || busy) return;
    busy = true;
    const likeRef = doc(db, "issues", issueId, "likes", uid);
    const b = writeBatch(db);
    const nextLiked = !liked;
    if (nextLiked) {
      b.set(likeRef, { at: serverTimestamp() });
      b.set(issueRef, { likes: increment(1) }, { merge: true });
    } else {
      b.delete(likeRef);
      b.update(issueRef, { likes: increment(-1) });
    }
    liked = nextLiked; paintLike();
    if (nextLiked) { likeBtn.classList.add("pop"); setTimeout(() => likeBtn.classList.remove("pop"), 250); }
    try { await b.commit(); } catch (e) { liked = !nextLiked; paintLike(); toast("잠시 후 다시 눌러주세요."); }
    busy = false;
  });

  nameIn.value = store("kkotbap-name") || "";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameIn.value.trim(), pw = pwIn.value, text = textIn.value.trim();
    if (!name || !text) { setMsg("이름과 내용을 적어주세요.", true); return; }
    if (pw.length < 4) { setMsg("비밀번호는 4자 이상으로 적어주세요.", true); return; }
    if (!uid) { setMsg("연결 중이에요. 잠시만요.", true); return; }
    submitBtn.disabled = true; setMsg("남기는 중…");
    try {
      const ref = doc(commentsRef);
      const b = writeBatch(db);
      b.set(doc(db, "posters", uid), { lastAt: serverTimestamp() });
      b.set(ref, { name, text, at: serverTimestamp() });
      b.set(doc(db, "issues", issueId, "commentKeys", ref.id), { hash: await pwHash(ref.id, pw) });
      await b.commit();
      store("kkotbap-name", name);
      textIn.value = ""; pwIn.value = "";
      setMsg("고마워요! 댓글이 남겨졌어요 🌷");
    } catch (err) {
      setMsg("조금 뒤에 다시 남겨주세요. (연속 작성은 30초 간격이에요)", true);
    }
    submitBtn.disabled = false;
  });

  $("share-btn").addEventListener("click", async () => {
    const data = { title: document.title, url: location.href.split("#")[0] };
    if (navigator.share) { try { await navigator.share(data); } catch (e) {} return; }
    try { await navigator.clipboard.writeText(data.url); toast("링크를 복사했어요"); }
    catch (e) { prompt("이 링크를 복사해 주세요", data.url); }
  });

  $("admin-edit").href = `${window.SITE_BASE || ""}/admin/?edit=${issueId}`;
}

loadIssue();
