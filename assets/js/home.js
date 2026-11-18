import { listPublished, loadImage, monthLabel, readUrl, el } from "./common.js";
import { firstImage } from "./blocks.js";

const latestBox = document.getElementById("latest");
const listBox = document.getElementById("issue-list");

function badge(post, isNew) {
  const p = el("p", "issue-badge");
  if (isNew) p.append(el("span", "new", "이번 호"));
  if (post.no) p.append(el("span", null, `제${post.no}호`));
  p.append(el("span", null, monthLabel(post.id)));
  return p;
}

try {
  const posts = await listPublished();
  latestBox.innerHTML = ""; listBox.innerHTML = "";
  if (!posts.length) {
    latestBox.append(el("p", "empty-note", "첫 번째 소식지를 준비하고 있어요. 조금만 기다려 주세요 🌸"));
  } else {
    const latest = posts[0];
    const card = el("a", "latest-card"); card.href = readUrl(latest.id);
    const body = el("div", "latest-body");
    body.append(badge(latest, true), el("h2", null, latest.title));
    if (latest.summary) body.append(el("p", null, latest.summary));
    body.append(el("span", "read-more", "읽으러 가기 →"));
    card.append(body);
    latestBox.append(card);
    const cover = firstImage(latest.blocks);
    if (cover.startsWith("fsimg:")) {
      loadImage(latest.id, cover.slice(6)).then((src) => {
        if (!src) return;
        const img = el("img"); img.src = src; img.alt = "";
        card.prepend(img);
      }).catch(() => {});
    }
  }
  posts.forEach((p) => {
    const li = el("li"); const a = el("a"); a.href = readUrl(p.id);
    a.append(el("span", "list-date", p.id.replace("-", ".")), el("span", "list-title", p.title));
    li.append(a); listBox.append(li);
  });
} catch (e) {
  console.error(e);
  latestBox.innerHTML = "";
  latestBox.append(el("p", "empty-note", "소식지를 불러오지 못했어요. 잠시 후 새로고침 해주세요."));
}
