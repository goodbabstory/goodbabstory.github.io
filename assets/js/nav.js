---
# 이 줄들은 지우지 마세요: 사이트를 만들 때 버전 꼬리표를 붙여요
---
// 위쪽 '지난 호' 버튼(직전 호로 가기)과 왼쪽 '지난 호 모아보기' 목록
import { listPublished, monthLabel, readUrl, el } from "./common.js?v={{ site.time | date: '%s' }}";

const prevLink = document.getElementById("prev-issue-link");
const sideList = document.getElementById("side-list");
const toggle = document.getElementById("side-toggle");
const side = document.getElementById("issue-side");

// 휴대폰: 버튼을 눌러 목록 펼치기
toggle?.addEventListener("click", () => {
  const open = !side.classList.contains("open");
  side.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
});

try {
  const posts = await listPublished(); // 최신 순
  const params = new URLSearchParams(location.search);
  const onRead = location.pathname.replace(/\/$/, "").endsWith("/read");
  // 지금 보고 있는 호: 읽기 화면이면 주소의 호(없으면 최신), 그 밖의 화면은 최신 호
  const currentId = (onRead && params.get("m")) || posts[0]?.id;
  const idx = posts.findIndex((p) => p.id === currentId);
  const prev = idx >= 0 ? posts[idx + 1] : null;
  if (prevLink && prev) {
    prevLink.href = readUrl(prev.id);
    prevLink.title = `${monthLabel(prev.id)} · ${prev.title}`;
    prevLink.hidden = false;
  }

  if (sideList) {
    sideList.innerHTML = "";
    if (!posts.length) sideList.append(el("li", "side-empty", "아직 지난 호가 없어요"));
    posts.forEach((p) => {
      const li = el("li");
      const a = el("a"); a.href = readUrl(p.id);
      if (onRead && p.id === currentId) { a.classList.add("on"); a.setAttribute("aria-current", "page"); }
      a.append(el("span", "side-date", p.id.replace("-", ".")), el("span", "side-name", p.title));
      li.append(a); sideList.append(li);
    });
  }
} catch (e) {
  if (sideList) sideList.innerHTML = '<li class="side-empty">목록을 불러오지 못했어요</li>';
}
