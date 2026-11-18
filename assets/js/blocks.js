// 월간꽃밥 블록: 소식지 한 호는 여러 블록(제목, 글, 사진, 사진+글 …)을 위에서 아래로 쌓아 만들어요.
// 읽기 화면과 관리자 편집 화면이 같은 코드로 그려져서, 편집하는 모습 그대로 사이트에 보여요.
import { DOMPurify } from "../vendor/markdown.js";

// ── 고를 수 있는 설정들 ─────────────────────────────
export const OPT = {
  size:   { label: "글자 크기", choices: [["s", "작게"], ["m", "보통"], ["l", "크게"], ["xl", "아주 크게"]] },
  align:  { label: "정렬", choices: [["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]] },
  color:  { label: "글자 색", choices: [["ink", "검정"], ["accent", "테라코타"], ["muted", "회색"], ["white", "흰색"]] },
  font:   { label: "글씨체", choices: [["serif", "고운바탕"], ["sans", "깔끔한 글씨"]] },
  shape:  { label: "사진 모양", choices: [["square", "네모"], ["round", "둥근 모서리"], ["oval", "타원"], ["circle", "동그라미"], ["arch", "아치"]] },
  width:  { label: "사진 크기", choices: [["s", "작게"], ["m", "중간"], ["full", "꽉 차게"]] },
  side:   { label: "사진 위치", choices: [["left", "왼쪽"], ["right", "오른쪽"]] },
  ratio:  { label: "사진 : 글", choices: [["2-3", "사진 작게"], ["1-1", "반반"], ["3-2", "사진 크게"]] },
  valign: { label: "글 세로 위치", choices: [["top", "위"], ["center", "가운데"]] },
  cols:   { label: "한 줄에", choices: [["2", "2장"], ["3", "3장"]] },
  style:  { label: "모양", choices: [["flower", "✿ ✿ ✿"], ["line", "가는 선"], ["dots", "· · ·"]] },
  h:      { label: "높이", choices: [["s", "작게"], ["m", "보통"], ["l", "크게"]] },
  bg:     { label: "배경색", choices: [["none", "없음"], ["cream", "아이보리"], ["pink", "연분홍"], ["accent", "테라코타"]] },
  pad:    { label: "위아래 여백", choices: [["s", "좁게"], ["m", "보통"], ["l", "넓게"]] },
  url:    { label: "누르면 갈 주소", input: "url", placeholder: "https://" },
};

export const BLOCKS = {
  heading:   { label: "제목", desc: "큰 제목과 작은 설명", make: () => ({ text: "", sub: "", size: "l", align: "left", color: "accent", font: "serif" }), opts: ["size", "align", "color", "font"] },
  text:      { label: "글", desc: "문단 글", make: () => ({ html: "", size: "m", align: "left", font: "sans" }), opts: ["size", "align", "font"] },
  image:     { label: "사진", desc: "사진 한 장과 설명", make: () => ({ img: "", caption: "", shape: "round", width: "full", align: "center" }), opts: ["shape", "width", "align"] },
  imageText: { label: "사진 + 글", desc: "사진 옆에 글 (휴대폰에선 위아래)", make: () => ({ img: "", title: "", html: "", side: "left", shape: "oval", ratio: "2-3", valign: "center", size: "m" }), opts: ["side", "shape", "ratio", "valign", "size"] },
  split:     { label: "제목 | 글", desc: "왼쪽 큰 제목, 오른쪽 글", make: () => ({ title: "", html: "", size: "l", color: "accent" }), opts: ["size", "color"] },
  quote:     { label: "인용", desc: "강조하고 싶은 한마디", make: () => ({ html: "", size: "m", align: "left" }), opts: ["size", "align"] },
  gallery:   { label: "사진 여러 장", desc: "사진을 나란히", make: () => ({ imgs: ["", ""], cols: "2", shape: "round" }), opts: ["cols", "shape"] },
  button:    { label: "버튼", desc: "신청하기·바로가기 버튼", make: () => ({ label: "", url: "", align: "center" }), opts: ["url", "align"] },
  divider:   { label: "구분선", desc: "내용 사이를 나눠요", make: () => ({ style: "flower" }), opts: ["style"] },
  spacer:    { label: "여백", desc: "빈 공간", make: () => ({ h: "m" }), opts: ["h"], noBox: true },
};

export function newBlock(type) {
  return { id: Math.random().toString(36).slice(2, 10), type, bg: "none", pad: "m", ...BLOCKS[type].make() };
}

// ── 안전한 글 서식만 남기기 ─────────────────────────
const FONT_SIZE = { 1: "s", 2: "s", 3: "m", 4: "l", 5: "l", 6: "xl", 7: "xl" };
export function cleanHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  tmp.querySelectorAll("font").forEach((f) => {
    const s = document.createElement("span");
    if (f.getAttribute("size")) s.className = "fs-" + (FONT_SIZE[f.getAttribute("size")] || "m");
    if (f.getAttribute("color")) s.style.color = f.getAttribute("color");
    s.innerHTML = f.innerHTML; f.replaceWith(s);
  });
  return DOMPurify.sanitize(tmp.innerHTML, {
    ALLOWED_TAGS: ["p", "div", "br", "b", "strong", "i", "em", "u", "s", "a", "span", "ul", "ol", "li"],
    ALLOWED_ATTR: ["href", "class", "style", "target", "rel"],
  });
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function imgSrc(v, images) {
  if (!v) return "";
  if (v.startsWith("fsimg:")) return (images && images[v.slice(6)]) || "";
  if (v.startsWith("data:image/")) return v;
  return "";
}

function plainPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
}

// ── 그리기 ─────────────────────────────────────────
// edit 가 있으면 편집 모드: { changed(), pickImage(cb), richFocus(el), rerender(b) }
export function renderBlocks(blocks, images, edit) {
  return (blocks || []).map((b) => renderBlock(b, images, edit));
}

export function renderBlock(b, images, edit) {
  const def = BLOCKS[b.type];
  const sec = el("section", `blk blk-${b.type} bg-${b.bg || "none"} pad-${b.pad || "m"}`);
  if (!def) return sec;
  const inner = el("div", "blk-inner");
  sec.append(inner);

  const text = (tag, cls, field, ph) => {
    const e = el(tag, cls);
    e.textContent = b[field] || "";
    if (edit) {
      e.contentEditable = "true"; e.dataset.ph = ph; e.classList.add("editable");
      e.addEventListener("input", () => { b[field] = e.innerText.replace(/\n$/, ""); edit.changed(); });
      e.addEventListener("paste", plainPaste);
    } else if (!b[field]) e.hidden = true;
    return e;
  };
  const rich = (cls, field, ph) => {
    const e = el("div", "rich " + cls);
    e.innerHTML = cleanHtml(b[field]);
    if (edit) {
      e.contentEditable = "true"; e.dataset.ph = ph; e.classList.add("editable");
      e.addEventListener("input", () => { b[field] = e.innerHTML; edit.changed(); });
      e.addEventListener("focus", () => edit.richFocus(e));
      e.addEventListener("paste", plainPaste);
    }
    return e;
  };
  const photo = (get, set, cls) => {
    const fig = el("figure", "blk-photo " + (cls || ""));
    const src = imgSrc(get(), images);
    if (src) {
      const img = el("img", `sh-${b.shape || "round"}`); img.src = src; img.alt = b.caption || ""; img.loading = "lazy";
      fig.append(img);
    } else if (edit) {
      fig.append(el("div", `photo-empty sh-${b.shape || "round"}`, "📷 눌러서 사진 넣기"));
    }
    if (edit) {
      fig.classList.add("pickable");
      if (src) fig.append(el("span", "photo-change", "사진 바꾸기"));
      fig.addEventListener("click", () => edit.pickImage((url) => { set(url); edit.rerender(b); }));
    }
    return fig;
  };

  switch (b.type) {
    case "heading": {
      inner.classList.add(`al-${b.align}`);
      inner.append(
        text("h2", `blk-title sz-${b.size} c-${b.color} f-${b.font}`, "text", "제목을 입력하세요"),
        text("p", "blk-sub", "sub", "작은 설명 (없어도 돼요)"),
      );
      break;
    }
    case "text":
      inner.append(rich(`sz-${b.size} al-${b.align} f-${b.font}`, "html", "내용을 입력하세요"));
      break;
    case "image": {
      inner.classList.add(`al-${b.align}`);
      const fig = photo(() => b.img, (v) => { b.img = v; }, `w-${b.width}`);
      fig.append(text("figcaption", "", "caption", "사진 설명 (없어도 돼요)"));
      inner.append(fig);
      break;
    }
    case "imageText": {
      const grid = el("div", `it-grid ratio-${b.ratio} side-${b.side} va-${b.valign}`);
      const col = el("div", "it-text");
      col.append(text("h3", "it-title", "title", "소제목 (없어도 돼요)"), rich(`sz-${b.size}`, "html", "내용을 입력하세요"));
      grid.append(photo(() => b.img, (v) => { b.img = v; }), col);
      inner.append(grid);
      break;
    }
    case "split": {
      const grid = el("div", "split-grid");
      grid.append(
        text("h2", `blk-title split-title sz-${b.size} c-${b.color} f-serif`, "title", "왼쪽 큰 제목"),
        rich(`split-body sz-${b.size === "xl" ? "l" : "m"} f-serif`, "html", "오른쪽 글"),
      );
      inner.append(grid);
      break;
    }
    case "quote": {
      const q = el("blockquote", `blk-quote al-${b.align}`);
      q.append(rich(`sz-${b.size}`, "html", "마음에 남는 한 문장"));
      inner.append(q);
      break;
    }
    case "gallery": {
      const grid = el("div", `gallery cols-${b.cols}`);
      (b.imgs || []).forEach((v, i) => {
        if (!edit && !imgSrc(v, images)) return;
        grid.append(photo(() => b.imgs[i], (nv) => { b.imgs[i] = nv; }));
      });
      inner.append(grid);
      if (edit) {
        const row = el("div", "gallery-edit");
        const add = el("button", "mini", "＋ 칸 추가"); add.type = "button";
        const del = el("button", "mini", "－ 마지막 칸 빼기"); del.type = "button";
        add.onclick = (e) => { e.stopPropagation(); b.imgs.push(""); edit.rerender(b); };
        del.onclick = (e) => { e.stopPropagation(); if (b.imgs.length > 1) { b.imgs.pop(); edit.rerender(b); } };
        row.append(add, del); inner.append(row);
      }
      break;
    }
    case "button": {
      inner.classList.add(`al-${b.align}`);
      const a = el("a", "blk-button");
      if (!edit && b.url) { a.href = b.url; a.target = "_blank"; a.rel = "noopener"; }
      a.append(text("span", "", "label", "버튼 글자"));
      if (edit && !b.url) inner.append(a, el("p", "edit-hint", "⚙ 설정에서 ‘누르면 갈 주소’를 넣어주세요"));
      else inner.append(a);
      break;
    }
    case "divider":
      inner.append(el("div", `blk-divider dv-${b.style}`));
      break;
    case "spacer":
      inner.append(el("div", `blk-spacer h-${b.h}`));
      break;
  }
  return sec;
}

// 블록에서 첫 번째 사진 값 (첫 화면 대표 사진용)
export function firstImage(blocks) {
  for (const b of blocks || []) {
    if (b.img) return b.img;
    if (b.imgs) { const v = b.imgs.find(Boolean); if (v) return v; }
  }
  return "";
}

// 블록 안 모든 사진 값을 바꿔주는 도우미 (저장할 때 사용)
export async function mapImages(blocks, fn) {
  for (const b of blocks) {
    if (typeof b.img === "string" && b.img) b.img = await fn(b.img);
    if (Array.isArray(b.imgs)) for (let i = 0; i < b.imgs.length; i++) if (b.imgs[i]) b.imgs[i] = await fn(b.imgs[i]);
  }
  return blocks;
}
