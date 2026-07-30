import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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
  watermarkOpacity: 15,
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
  titleBg: string;
  titleFg: string;
  qBg: string;
  qBorder: string;
  correctBg: string;
  correctText: string;
  expBg: string;
  expText: string;
}

const THEMES: Record<PdfTheme, ThemeVars> = {
  teal:    { primary:"#007B6E", headerBg:"#007B6E", headerFg:"#fff", titleBg:"#004d45", titleFg:"#fff", qBg:"#f7faf9", qBorder:"#b2d8d4", correctBg:"#d1fae5", correctText:"#065f46", expBg:"#eff9f7", expText:"#007B6E" },
  blue:    { primary:"#2563EB", headerBg:"#1d4ed8", headerFg:"#fff", titleBg:"#1e3a8a", titleFg:"#fff", qBg:"#f8fafc", qBorder:"#bfdbfe", correctBg:"#dbeafe", correctText:"#1d4ed8", expBg:"#f0f9ff", expText:"#0369a1" },
  purple:  { primary:"#7C3AED", headerBg:"#6d28d9", headerFg:"#fff", titleBg:"#4c1d95", titleFg:"#fff", qBg:"#faf8ff", qBorder:"#ddd6fe", correctBg:"#ede9fe", correctText:"#6d28d9", expBg:"#faf5ff", expText:"#7e22ce" },
  dark:    { primary:"#1e293b", headerBg:"#0f172a", headerFg:"#f1f5f9", titleBg:"#020617", titleFg:"#e2e8f0", qBg:"#f8fafc", qBorder:"#94a3b8", correctBg:"#dcfce7", correctText:"#065f46", expBg:"#f1f5f9", expText:"#334155" },
  minimal: { primary:"#111",    headerBg:"#f1f1f1", headerFg:"#111",   titleBg:"#fff",   titleFg:"#111", qBg:"#fff",   qBorder:"#d4d4d4", correctBg:"#f0fdf4", correctText:"#166534", expBg:"#fafafa", expText:"#555" },
};

function esc(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function buildHTML(quiz: QuizData, opts: PdfOptions, mode: PdfContentMode, label?: string): string {
  const t = THEMES[opts.theme];
  const showAnswers = mode !== "questions";
  const showExpl = mode === "full";
  const letters = ["A","B","C","D","E"];
  const fsMap = { small:"10px", medium:"12px", large:"14px" };
  const fs = fsMap[opts.fontSize];
  const title = label ? `${quiz.title} — ${label}` : quiz.title;
  const date = new Date(quiz.createdAt).toLocaleDateString("en-GB", { year:"numeric", month:"long", day:"numeric" });
  const wmOp = Math.max(1, Math.min(60, opts.watermarkOpacity)) / 100;

  const renderQ = (q: QuizQuestion, i: number) => {
    const optsHTML = q.options.map((o, j) => {
      const cor = j === q.correctOptionIndex && showAnswers;
      return `<div class="opt${cor ? " cor" : ""}">
        <span class="ol${cor ? " olc" : ""}">${letters[j]}</span>
        <span class="ot">${esc(o)}</span>
        ${cor ? `<span class="chk">✓</span>` : ""}
      </div>`;
    }).join("");
    const explHTML = showExpl && q.explanation
      ? `<div class="expl">💡 ${esc(q.explanation)}</div>` : "";
    return `<div class="qb">
      <div class="qh"><span class="qn">${i+1}</span><span class="qt">${esc(q.question)}</span></div>
      <div class="opts">${optsHTML}</div>${explHTML}
    </div>`;
  };

  let bodyHTML: string;
  if (opts.columns === 2) {
    const left  = quiz.questions.filter((_,i) => i%2===0).map((q,li)=>renderQ(q,li*2)).join("");
    const right = quiz.questions.filter((_,i) => i%2===1).map((q,ri)=>renderQ(q,ri*2+1)).join("");
    bodyHTML = `<div class="twocol"><div class="col">${left}</div><div class="col">${right}</div></div>`;
  } else {
    bodyHTML = `<div class="onecol">${quiz.questions.map((q,i)=>renderQ(q,i)).join("")}</div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans Bengali','Segoe UI','SolaimanLipi','Kalpurush','Vrinda','Arial Unicode MS',Arial,sans-serif;font-size:${fs};background:#fff;color:#1a1a1a;width:800px}
.page{width:800px;padding:18px 24px 22px;position:relative;overflow:hidden;background:#fff}
.wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:76px;font-weight:900;color:rgba(150,150,150,${wmOp});pointer-events:none;white-space:nowrap;z-index:0;letter-spacing:8px;font-family:Arial,sans-serif}
.hdr{background:${t.headerBg};color:${t.headerFg};padding:5px 14px;display:flex;justify-content:space-between;align-items:center;font-size:8.5px;font-weight:700;letter-spacing:0.5px;border-radius:5px 5px 0 0;font-family:Arial,sans-serif;text-transform:uppercase}
.ttl{background:${t.titleBg};color:${t.titleFg};padding:9px 14px 8px;font-size:15px;font-weight:700;line-height:1.4;border-radius:0 0 5px 5px;position:relative;z-index:1}
.meta{font-size:9px;color:#888;margin:7px 0 9px;font-family:Arial,sans-serif;display:flex;gap:10px;align-items:center;position:relative;z-index:1}
.div{height:1.5px;background:${t.primary};opacity:0.2;margin-bottom:10px;position:relative;z-index:1}
.twocol{display:flex;gap:10px;align-items:flex-start;position:relative;z-index:1}
.col{flex:1;display:flex;flex-direction:column;gap:7px}
.onecol{display:flex;flex-direction:column;gap:7px;position:relative;z-index:1}
.qb{background:${t.qBg};border:1px solid ${t.qBorder};border-radius:6px;padding:8px 10px 9px;break-inside:avoid;page-break-inside:avoid}
.qh{display:flex;align-items:flex-start;gap:7px;margin-bottom:7px}
.qn{background:${t.primary};color:#fff;border-radius:50%;min-width:19px;height:19px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:800;flex-shrink:0;margin-top:1px;font-family:Arial,sans-serif}
.qt{font-size:${fs};font-weight:600;line-height:1.5;color:#111}
.opts{display:flex;flex-direction:column;gap:2.5px}
.opt{display:flex;align-items:flex-start;gap:5px;padding:2.5px 6px;border-radius:4px;font-size:calc(${fs} - 1px);line-height:1.4;color:#444}
.opt.cor{background:${t.correctBg};color:${t.correctText};font-weight:700;border:1px solid ${t.correctText}40}
.ol{font-weight:800;min-width:15px;height:15px;background:${t.primary}22;color:${t.primary};border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:7.5px;flex-shrink:0;font-family:Arial,sans-serif;margin-top:1px}
.olc{background:${t.correctText};color:#fff}
.ot{flex:1}
.chk{margin-left:auto;flex-shrink:0;font-size:10px;color:${t.correctText}}
.expl{margin-top:6px;padding:4px 7px;background:${t.expBg};color:${t.expText};font-size:calc(${fs} - 2px);border-radius:4px;line-height:1.4;border-left:3px solid ${t.expText}80}
.ftr{margin-top:14px;padding-top:7px;border-top:1px solid #e5e5e5;display:flex;justify-content:space-between;align-items:center;font-size:8px;color:#bbb;font-family:Arial,sans-serif;position:relative;z-index:1}
</style></head><body><div class="page">
${opts.watermarkText ? `<div class="wm">${esc(opts.watermarkText)}</div>` : ""}
<div class="hdr"><span>${esc(opts.headerLeft||"Quiz Generator")}</span><span>${esc(opts.headerRight||"")}</span></div>
<div class="ttl">${esc(title)}</div>
<div class="meta"><span>📝 ${quiz.questions.length} Questions</span><span>📅 ${date}</span>${quiz.telegramChannel?`<span>📢 ${esc(quiz.telegramChannel)}</span>`:""}</div>
<div class="div"></div>
${bodyHTML}
<div class="ftr"><span>${esc(opts.footerLeft||"Generated by Telegram Quiz Generator")}</span><span></span></div>
</div></body></html>`;
}

async function renderToPDF(html: string, opts: PdfOptions, filename: string): Promise<void> {
  const PAGE_W = 800;
  const SCALE = 2;
  const PAGE_W_MM = 210;
  const PAGE_H_MM = 297;

  // Toast indicator at bottom-right
  const toast = document.createElement("div");
  toast.style.cssText = "position:fixed;bottom:20px;right:20px;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:10px;z-index:2147483647;font-family:sans-serif;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,0.3);transition:opacity 0.2s";
  toast.textContent = "⏳ PDF তৈরি হচ্ছে…";
  document.body.appendChild(toast);

  // White overlay to hide app behind PDF content
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:#e8e8e8;z-index:2147483640;";
  document.body.appendChild(overlay);

  // PDF container — fully visible so html2canvas can capture correctly
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;top:0;left:50%;transform:translateX(-50%);width:${PAGE_W}px;background:#fff;z-index:2147483641;box-shadow:0 0 40px rgba(0,0,0,0.15);`;
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    // Wait for fonts to load
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 800));

    const totalH = container.scrollHeight;

    // ── Measure each question's position relative to container ──
    const qDivs = Array.from(container.querySelectorAll(".qb")) as HTMLElement[];
    const ctRect = container.getBoundingClientRect();
    const qBounds = qDivs.map(el => {
      const r = el.getBoundingClientRect();
      return {
        top:    Math.round((r.top    - ctRect.top) * SCALE),
        bottom: Math.round((r.bottom - ctRect.top) * SCALE),
      };
    });

    // Capture full canvas
    const canvas = await html2canvas(container, {
      scale: SCALE,
      width: PAGE_W,
      height: totalH,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: PAGE_W,
    });

    // ── Smart page slicing: never cut through a question ──
    const PAGE_H_PX = Math.round((PAGE_W * SCALE * PAGE_H_MM) / PAGE_W_MM);
    const slices: Array<[number, number]> = []; // [start, end] in canvas pixels
    let cur = 0;

    while (cur < canvas.height) {
      const rawEnd = cur + PAGE_H_PX;

      if (rawEnd >= canvas.height) {
        slices.push([cur, canvas.height]);
        break;
      }

      // Find any question that straddles the raw cut
      let cutAt = rawEnd;
      for (const q of qBounds) {
        if (q.top < rawEnd && q.bottom > rawEnd) {
          // Move cut to just BEFORE this question (20px gap)
          const before = q.top - Math.round(12 * SCALE);
          if (before > cur + Math.round(PAGE_H_PX * 0.25)) {
            cutAt = before;
          }
          // (if question is too tall, fall through and cut through it)
          break;
        }
      }

      slices.push([cur, cutAt]);
      cur = cutAt;
    }

    // ── Build jsPDF from slices ──
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    for (let i = 0; i < slices.length; i++) {
      if (i > 0) doc.addPage();

      const [sliceStart, sliceEnd] = slices[i];
      const sliceH = sliceEnd - sliceStart;

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width  = canvas.width;
      pageCanvas.height = PAGE_H_PX;
      const ctx = pageCanvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, sliceStart, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

      const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
      doc.addImage(imgData, "JPEG", 0, 0, PAGE_W_MM, PAGE_H_MM);

      if (opts.showPageNumbers) {
        doc.setFontSize(8);
        doc.setTextColor(170, 170, 170);
        doc.text(`${i + 1} / ${slices.length}`, PAGE_W_MM - 10, PAGE_H_MM - 5, { align: "right" });
      }
    }

    doc.save(filename);
  } finally {
    document.body.removeChild(container);
    document.body.removeChild(overlay);
    document.body.removeChild(toast);
  }
}

function safeName(t: string) {
  return t.replace(/[^a-zA-Z0-9\u0980-\u09FF _-]/g, "").trim() || "quiz";
}

export async function exportQuizAsPDF(quiz: QuizData, opts: PdfOptions = defaultPdfOptions): Promise<void> {
  const name = safeName(quiz.title);
  if (opts.separateSheets) {
    await renderToPDF(buildHTML(quiz, opts, "questions", "Question Sheet"), opts, `${name}_questions.pdf`);
    await renderToPDF(buildHTML(quiz, opts, "full",      "Answer Key"),     opts, `${name}_answer_key.pdf`);
  } else {
    await renderToPDF(buildHTML(quiz, opts, opts.contentMode), opts, `${name}.pdf`);
  }
}
