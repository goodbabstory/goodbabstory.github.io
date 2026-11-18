// 월간꽃밥 공통 기능: Firebase 연결, 글 불러오기, 본문 그리기
import {
  initializeApp, getAuth, getFirestore, connectAuthEmulator, connectFirestoreEmulator, collection, getDocs, getDoc, doc, query, where,
} from "../vendor/firebase.js";
import { marked, DOMPurify } from "../vendor/markdown.js";

const config = JSON.parse(document.getElementById("firebase-config").textContent);
export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

// 개발용: 내 컴퓨터(localhost)에서 ?emu=1 로 열면 테스트용 Firebase에 연결
if (location.hostname === "localhost" && (new URLSearchParams(location.search).has("emu") || sessionStorage.getItem("emu"))) {
  sessionStorage.setItem("emu", "1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
}

// 관리자 아이디는 "아이디@goodbabstory.admin" 형태로 Firebase에 등록돼 있어요
export const ADMIN_DOMAIN = "@goodbabstory.admin";
export const isAdminUser = (u) => !!(u && !u.isAnonymous && u.email && u.email.endsWith(ADMIN_DOMAIN));

export const monthLabel = (id) => {
  const [y, m] = String(id).split("-");
  return `${y}년 ${Number(m)}월`;
};

export const readUrl = (id) => `${window.SITE_BASE || ""}/read/?m=${id}`;

// 공개된 호 목록 (최신 순)
export async function listPublished() {
  const snap = await getDocs(query(collection(db, "posts"), where("published", "==", true)));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (a.id < b.id ? 1 : -1));
}

// 한 호의 사진들 { 사진id: dataURL }
export async function loadImages(id) {
  const snap = await getDocs(collection(db, "posts", id, "images"));
  const map = {};
  snap.forEach((d) => { map[d.id] = d.data().data; });
  return map;
}

export async function loadImage(id, imgId) {
  const snap = await getDoc(doc(db, "posts", id, "images", imgId));
  return snap.exists() ? snap.data().data : null;
}

export const firstImageId = (body) => {
  const m = /\(fsimg:([a-z0-9]+)\)/.exec(body || "");
  return m ? m[1] : null;
};

export function renderBody(md, images) {
  const src = String(md || "").replace(/fsimg:([a-z0-9]+)/g, (_, k) => images[k] || "");
  const html = marked.parse(src, { breaks: true, gfm: true });
  return DOMPurify.sanitize(html);
}

export function toast(text) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = text; document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 1800);
}

export function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch (e) { return null; }
  return null;
}

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
