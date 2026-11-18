// 월간꽃밥 좋아요·댓글 (Firebase Firestore)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, collection, query, orderBy, limit, onSnapshot, getDoc,
  writeBatch, increment, serverTimestamp, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const root = document.getElementById("reactions");
const issueId = root.dataset.issue;
const config = JSON.parse(document.getElementById("firebase-config").textContent);

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const likeBtn = $("like-btn"), likeCount = $("like-count");
const list = $("comment-list"), countEl = $("comment-count");
const form = $("comment-form"), nameIn = $("comment-name"), textIn = $("comment-text");
const submitBtn = $("comment-submit"), msg = $("comment-msg");

const issueRef = doc(db, "issues", issueId);
let uid = null, liked = false, busy = false;

function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
}
function toast(text) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = text; document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 1800);
}
function setMsg(text, isError) { msg.textContent = text || ""; msg.classList.toggle("error", !!isError); }
function paintLike() {
  likeBtn.setAttribute("aria-pressed", liked ? "true" : "false");
}

// 좋아요 숫자 (실시간)
onSnapshot(issueRef, (snap) => {
  likeCount.textContent = snap.exists() ? (snap.data().likes || 0) : 0;
}, () => { likeCount.textContent = "0"; });

// 댓글 목록 (실시간)
const commentsRef = collection(db, "issues", issueId, "comments");
let lastSnap = null;
function renderComments(snap) {
  lastSnap = snap;
  list.innerHTML = "";
  countEl.textContent = snap.size ? snap.size : "";
  if (!snap.size) {
    const li = document.createElement("li");
    li.className = "comment-empty"; li.textContent = "첫 번째 댓글을 남겨주세요 🌸";
    list.appendChild(li); return;
  }
  snap.forEach((d) => {
    const c = d.data();
    const li = document.createElement("li");
    const meta = document.createElement("div"); meta.className = "comment-meta";
    const name = document.createElement("b"); name.textContent = c.name;
    const time = document.createElement("time");
    const at = c.at && c.at.toDate ? c.at.toDate() : new Date();
    time.textContent = at.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
    meta.append(name, time);
    if (uid && c.uid === uid) {
      const del = document.createElement("button");
      del.type = "button"; del.textContent = "삭제";
      del.onclick = async () => {
        if (!confirm("댓글을 지울까요?")) return;
        try { await deleteDoc(d.ref); } catch (e) { toast("지우지 못했어요. 잠시 후 다시 해주세요."); }
      };
      meta.appendChild(del);
    }
    const p = document.createElement("p"); p.className = "comment-text"; p.textContent = c.text;
    li.append(meta, p); list.appendChild(li);
  });
}
onSnapshot(query(commentsRef, orderBy("at", "asc"), limit(300)), renderComments, () => {
  list.innerHTML = '<li class="comment-empty">댓글을 불러오지 못했어요.</li>';
});

// 익명 로그인 (같은 사람이 하트를 여러 번 누르지 않도록)
onAuthStateChanged(auth, async (user) => {
  if (!user) { signInAnonymously(auth).catch(() => setMsg("연결이 잠시 불안정해요.", true)); return; }
  uid = user.uid;
  try { liked = (await getDoc(doc(db, "issues", issueId, "likes", uid))).exists(); } catch (e) { liked = false; }
  paintLike();
  if (lastSnap) renderComments(lastSnap);
  likeBtn.disabled = false; submitBtn.disabled = false;
});

likeBtn.addEventListener("click", async () => {
  if (!uid || busy) return;
  busy = true;
  const likeRef = doc(db, "issues", issueId, "likes", uid);
  const batch = writeBatch(db);
  const next = !liked;
  if (next) {
    batch.set(likeRef, { at: serverTimestamp() });
    batch.set(issueRef, { likes: increment(1) }, { merge: true });
  } else {
    batch.delete(likeRef);
    batch.update(issueRef, { likes: increment(-1) });
  }
  liked = next; paintLike();
  if (next) { likeBtn.classList.add("pop"); setTimeout(() => likeBtn.classList.remove("pop"), 250); }
  try { await batch.commit(); }
  catch (e) { liked = !next; paintLike(); toast("잠시 후 다시 눌러주세요."); }
  busy = false;
});

// 댓글 남기기
nameIn.value = store("kkotbap-name") || "";
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameIn.value.trim(), text = textIn.value.trim();
  if (!name || !text) { setMsg("이름과 내용을 적어주세요.", true); return; }
  if (!uid) { setMsg("연결 중이에요. 잠시만요.", true); return; }
  submitBtn.disabled = true; setMsg("남기는 중…");
  const batch = writeBatch(db);
  batch.set(doc(db, "posters", uid), { lastAt: serverTimestamp() });
  batch.set(doc(commentsRef), { name, text, uid, at: serverTimestamp() });
  try {
    await batch.commit();
    store("kkotbap-name", name);
    textIn.value = ""; setMsg("고마워요! 댓글이 남겨졌어요 🌷");
  } catch (err) {
    setMsg("조금 뒤에 다시 남겨주세요. (연속 작성은 30초 간격이에요)", true);
  }
  submitBtn.disabled = false;
});

// 공유하기
$("share-btn").addEventListener("click", async () => {
  const data = { title: document.title, url: location.href.split("#")[0] };
  if (navigator.share) { try { await navigator.share(data); } catch (e) {} return; }
  try { await navigator.clipboard.writeText(data.url); toast("링크를 복사했어요"); }
  catch (e) { prompt("이 링크를 복사해 주세요", data.url); }
});
