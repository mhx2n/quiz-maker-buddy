import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { formatMathText } from "./text-format";

interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
}

interface QuizData {
  title: string;
  questions: QuizQuestion[];
  createdAt: string;
  telegramChannel?: string | null;
}

export type PdfTheme = "teal" | "blue" | "purple" | "dark" | "minimal";
export type PdfContentMode = "questions" | "answers" | "full";

export interface PdfOptions {
  theme: PdfTheme;
  contentMode: PdfContentMode;
  watermarkText: string;
  watermarkOpacity: number;
  headerLeft: string;
  headerRight: string;
  footerLeft: string;
  showPageNumbers: boolean;
  separateSheets: boolean;
  columns: 1 | 2;
  fontSize: "small" | "medium" | "large";
}

export const defaultPdfOptions: PdfOptions = {
  theme: "teal",
  contentMode: "full",
  watermarkText: "",
  watermarkOpacity: 12,
  headerLeft: "Quiz Generator",
  headerRight: "",
  footerLeft: "",
  showPageNumbers: true,
  separateSheets: false,
  columns: 2,
  fontSize: "medium",
};

interface ThemeVars {
  primary: string;
  headerBg: string;
  headerFg: string;
  qBorder: string;
  ansBg: string;
  ansText: string;
  expBg: string;
  expText: string;
}

const THEMES: Record<PdfTheme, ThemeVars> = {
  teal:    { primary:"#007B6E", headerBg:"#007B6E", headerFg:"#ffffff", qBorder:"#cfe4e1", ansBg:"#e8f5f2", ansText:"#00594f", expBg:"#f6fbfa", expText:"#3f5c58" },
  blue:    { primary:"#1d4ed8", headerBg:"#1d4ed8", headerFg:"#ffffff", qBorder:"#cbd9f5", ansBg:"#e6eefc", ansText:"#173da6", expBg:"#f5f8ff", expText:"#3b4a63" },
  purple:  { primary:"#6d28d9", headerBg:"#6d28d9", headerFg:"#ffffff", qBorder:"#ddd3f5", ansBg:"#efe9fd", ansText:"#4c1d95", expBg:"#faf7ff", expText:"#4f4463" },
  dark:    { primary:"#0f172a", headerBg:"#0f172a", headerFg:"#f8fafc", qBorder:"#cbd5e1", ansBg:"#e8edf4", ansText:"#0f172a", expBg:"#f6f8fb", expText:"#334155" },
  minimal: { primary:"#111111", headerBg:"#efefef", headerFg:"#111111", qBorder:"#dcdcdc", ansBg:"#f3f3f3", ansText:"#111111", expBg:"#fafafa", expText:"#555555" },
};

const BN_LETTERS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];

// A4 at 800 px page width.
const PAGE_W = 800;
const PAGE_H = Math.round((PAGE_W * 297) / 210); // 1131
const PAD_X = 26;
const PAD_TOP = 20;
const PAD_BOTTOM = 34;
const COL_GAP = 14;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(s: string) {
  return esc(formatMathText(s));
}

function ensureFont() {
  if (document.getElementById("pdf-bn-font")) return;
  const link = document.createElement("link");
  link.id = "pdf-bn-font";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Noto+Sans:wght@400;600;700&display=swap";
  document.head.appendChild(link);
}

function styleSheet(t: ThemeVars, fs: number, wmOpacity: number): string {
  return `
.pdfroot *{box-sizing:border-box;margin:0;padding:0}
.pdfpage{width:${PAGE_W}px;height:${PAGE_H}px;background:#fff;position:relative;overflow:hidden;
  font-family:'Noto Sans Bengali','Noto Sans','SolaimanLipi','Kalpurush',Arial,sans-serif;
  color:#15201f;padding:${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px}
.wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font-size:58px;
  font-weight:800;color:rgba(120,120,120,${wmOpacity});white-space:nowrap;letter-spacing:10px;z-index:0;
  font-family:Arial,sans-serif}
.layer{position:relative;z-index:1;height:100%;display:flex;flex-direction:column}
.hdr{display:flex;justify-content:space-between;align-items:center;font-size:9px;font-weight:700;
  letter-spacing:.6px;text-transform:uppercase;color:${t.primary};font-family:'Noto Sans',Arial,sans-serif}
.ttlwrap{margin-top:8px;background:${t.headerBg};color:${t.headerFg};border-radius:8px;padding:11px 16px}
.ttl{font-size:17px;font-weight:700;line-height:1.35}
.meta{margin-top:5px;font-size:10px;opacity:.9;display:flex;gap:14px;flex-wrap:wrap}
.rule{height:2px;background:${t.primary};opacity:.18;border-radius:2px;margin:10px 0 12px}
.cols{flex:1;display:flex;gap:${COL_GAP}px;align-items:flex-start;overflow:hidden}
.col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:9px;align-self:flex-start}
.qb{flex:0 0 auto;border:1px solid ${t.qBorder};border-radius:8px;padding:8px 10px 9px;background:#fff}
.qh{display:flex;gap:7px;align-items:flex-start}
.qn{font-size:${fs}px;font-weight:700;color:${t.primary};min-width:16px;font-family:'Noto Sans',Arial,sans-serif}
.qt{flex:1;font-size:${fs}px;font-weight:600;line-height:1.5;word-break:break-word}
.opts{margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:3px 10px}
.opt{display:flex;gap:5px;font-size:${fs - 1}px;line-height:1.45;color:#3a4744;word-break:break-word}
.ol{font-weight:700;color:#5c6b68;flex-shrink:0}
.opt.cor .ol,.opt.cor .otx{color:${t.ansText};font-weight:700}
.ans{margin-top:7px;background:${t.ansBg};color:${t.ansText};border-radius:6px;padding:4px 8px;
  font-size:${fs - 1}px;font-weight:700;line-height:1.4;word-break:break-word}
.expl{margin-top:5px;background:${t.expBg};color:${t.expText};border-left:3px solid ${t.primary}55;
  border-radius:0 5px 5px 0;padding:4px 8px;font-size:${fs - 2}px;line-height:1.45;word-break:break-word}
.ftr{margin-top:8px;padding-top:6px;border-top:1px solid #e6e6e6;display:flex;justify-content:space-between;
  font-size:8.5px;color:#9aa5a3;font-family:'Noto Sans',Arial,sans-serif}
`;
}

function questionHTML(q: QuizQuestion, index: number, showAnswer: boolean, showExpl: boolean): string {
  const opts = q.options
    .map(
      (o, j) =>
        `<div class="opt${showAnswer && j === q.correctOptionIndex ? " cor" : ""}">` +
        `<span class="ol">${BN_LETTERS[j] ?? String.fromCharCode(65 + j)})</span>` +
        `<span class="otx">${fmt(o)}</span></div>`,
    )
    .join("");

  const correct = q.options[q.correctOptionIndex] ?? "";
  const ans = showAnswer
    ? `<div class="ans">সঠিক উত্তর: ${BN_LETTERS[q.correctOptionIndex] ?? "?"}) ${fmt(correct)}</div>`
    : "";
  const expl = showExpl && q.explanation ? `<div class="expl"><b>ব্যাখ্যা:</b> ${fmt(q.explanation)}</div>` : "";

  return (
    `<div class="qb"><div class="qh"><span class="qn">${index + 1}.</span>` +
    `<span class="qt">${fmt(q.question)}</span></div>` +
    `<div class="opts">${opts}</div>${ans}${expl}</div>`
  );
}

function pageShell(
  opts: PdfOptions,
  quiz: QuizData,
  label: string | undefined,
  isFirst: boolean,
): HTMLDivElement {
  const page = document.createElement("div");
  page.className = "pdfpage";
  const date = new Date(quiz.createdAt).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const title = label ? `${quiz.title} — ${label}` : quiz.title;

  page.innerHTML =
    (opts.watermarkText ? `<div class="wm">${esc(opts.watermarkText)}</div>` : "") +
    `<div class="layer">` +
    `<div class="hdr"><span>${esc(opts.headerLeft || "Quiz Generator")}</span><span>${esc(opts.headerRight || "")}</span></div>` +
    (isFirst
      ? `<div class="ttlwrap"><div class="ttl">${esc(title)}</div>` +
        `<div class="meta"><span>${quiz.questions.length} Questions</span><span>${date}</span>` +
        (quiz.telegramChannel ? `<span>${esc(quiz.telegramChannel)}</span>` : "") +
        `</div></div>`
      : "") +
    `<div class="rule"></div>` +
    `<div class="cols"></div>` +
    `<div class="ftr"><span>${esc(opts.footerLeft || "Generated by Telegram Quiz Generator")}</span><span></span></div>` +
    `</div>`;

  const cols = page.querySelector(".cols") as HTMLElement;
  for (let c = 0; c < opts.columns; c++) {
    const col = document.createElement("div");
    col.className = "col";
    cols.appendChild(col);
  }
  return page;
}

/**
 * Lays every question out into real, fixed-height A4 pages.
 * Questions are never cut in half and numbering runs 1, 2, 3 … down the
 * first column and then down the second one, exactly like a printed sheet.
 */
function buildPages(quiz: QuizData, opts: PdfOptions, mode: PdfContentMode, label?: string) {
  const showAnswer = mode !== "questions";
  const showExpl = mode === "full";

  const host = document.createElement("div");
  host.className = "pdfroot";
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${PAGE_W}px;z-index:-1;background:#fff;`;

  const style = document.createElement("style");
  const fsMap = { small: 11, medium: 12.5, large: 14 };
  style.textContent = styleSheet(
    THEMES[opts.theme],
    fsMap[opts.fontSize],
    Math.max(1, Math.min(60, opts.watermarkOpacity)) / 100,
  );
  host.appendChild(style);
  document.body.appendChild(host);

  const pages: HTMLDivElement[] = [];
  let page = pageShell(opts, quiz, label, true);
  host.appendChild(page);
  pages.push(page);

  const GAP = 9;
  let colIndex = 0;
  let used = 0; // height already consumed by the current column
  let columns = Array.from(page.querySelectorAll(".col")) as HTMLElement[];
  let limit = (page.querySelector(".cols") as HTMLElement).clientHeight;

  const nextPage = () => {
    page = pageShell(opts, quiz, label, false);
    host.appendChild(page);
    pages.push(page);
    columns = Array.from(page.querySelectorAll(".col")) as HTMLElement[];
    limit = (page.querySelector(".cols") as HTMLElement).clientHeight;
    colIndex = 0;
  };

  quiz.questions.forEach((q, i) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = questionHTML(q, i, showAnswer, showExpl);
    const block = wrapper.firstElementChild as HTMLElement;

    let col = columns[colIndex]!;
    col.appendChild(block);
    const h = block.getBoundingClientRect().height;
    const needed = used === 0 ? h : used + GAP + h;

    // Never let a question be cut in half — move it to the next column/page.
    if (needed > limit && col.children.length > 1) {
      col.removeChild(block);
      if (colIndex + 1 < columns.length) {
        colIndex++;
      } else {
        nextPage();
      }
      used = 0;
      col = columns[colIndex]!;
      col.appendChild(block);
      used = block.getBoundingClientRect().height;
    } else {
      used = needed;
    }
  });

  return { host, pages };
}

async function renderPagesToPDF(pages: HTMLElement[], opts: PdfOptions, filename: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i]!, {
      scale: 2,
      width: PAGE_W,
      height: PAGE_H,
      windowWidth: PAGE_W,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    if (i > 0) doc.addPage();
    doc.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297);

    if (opts.showPageNumbers) {
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`${i + 1} / ${pages.length}`, 200, 291, { align: "right" });
    }
  }

  doc.save(filename);
}

async function exportSheet(quiz: QuizData, opts: PdfOptions, mode: PdfContentMode, filename: string, label?: string) {
  ensureFont();
  const toast = document.createElement("div");
  toast.style.cssText =
    "position:fixed;bottom:20px;right:20px;background:#111;color:#fff;padding:10px 18px;border-radius:10px;" +
    "z-index:2147483647;font-family:sans-serif;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.3)";
  toast.textContent = "⏳ PDF তৈরি হচ্ছে…";
  document.body.appendChild(toast);

  let host: HTMLElement | null = null;
  try {
    try {
      await document.fonts.load("700 16px 'Noto Sans Bengali'");
      await document.fonts.ready;
    } catch { /* font API unavailable — carry on */ }
    await new Promise((r) => setTimeout(r, 250));

    const built = buildPages(quiz, opts, mode, label);
    host = built.host;
    await new Promise((r) => setTimeout(r, 120));
    await renderPagesToPDF(built.pages, opts, filename);
  } finally {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    toast.remove();
  }
}

function safeName(t: string) {
  return t.replace(/[^a-zA-Z0-9\u0980-\u09FF _-]/g, "").trim() || "quiz";
}

export async function exportQuizAsPDF(quiz: QuizData, opts: PdfOptions = defaultPdfOptions): Promise<void> {
  const name = safeName(quiz.title);
  if (opts.separateSheets) {
    await exportSheet(quiz, opts, "questions", `${name}_questions.pdf`, "Question Sheet");
    await exportSheet(quiz, opts, "full", `${name}_answer_key.pdf`, "Answer Key");
  } else {
    await exportSheet(quiz, opts, opts.contentMode, `${name}.pdf`);
  }
}
