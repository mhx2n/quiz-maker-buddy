import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetQuiz, useUpdateQuiz, useDeleteQuiz, useValidateTelegramBot,
  getGetQuizQueryKey, getListQuizzesQueryKey, getGetQuizStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import {
  ArrowLeft, Send, Download, Trash2, Check, X, Edit2, Loader2, FileText, FileJson,
  ChevronDown, ChevronUp, Bot, Hash, Clock, AlertCircle, Pencil, Save, Sparkles,
  Pin, Plus, Image, Bold, Italic, Trophy, Columns, Star, Layers,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { exportQuizAsPDF, defaultPdfOptions, type PdfOptions, type PdfTheme, type PdfContentMode } from "@/lib/pdf-export";
import { exportQuizAsCSV, exportQuizAsJSON } from "@/lib/csv-export";

// ── Types ────────────────────────────────────────────────────────────────────
interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
}

// ── Per-channel persistence ───────────────────────────────────────────────────
const CHANNELS_KEY = "tg_channels_v3";

type ChannelConfig = {
  channelId: string;
  displayName: string;
  botToken: string;
  postDelay: number;
  questionPrefix: string;
  explanationSuffix: string;
  enableIntro: boolean;
  introText: string;
  pinIntro: boolean;
  deleteService: boolean;
  sendScore: boolean;
  scoreTemplate: string;
  lastUsed: number;
};

const DEFAULT_SCORE_TPL = "🏆 কুইজ শেষ! মোট প্রশ্ন: {N}টি\n\nসবাইকে অভিনন্দন! 🎉";

function loadAllChannels(): Record<string, ChannelConfig> {
  try { return JSON.parse(localStorage.getItem(CHANNELS_KEY) ?? "{}") as Record<string, ChannelConfig>; }
  catch { return {}; }
}
function saveChannelConfig(cfg: ChannelConfig) {
  const all = loadAllChannels();
  all[cfg.channelId] = { ...cfg, lastUsed: Date.now() };
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(all));
}
function deleteChannelConfig(id: string) {
  const all = loadAllChannels();
  delete all[id];
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(all));
}

// ── Telegram API helper ───────────────────────────────────────────────────────
async function tgApi(token: string, method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function QuizDetail() {
  const { id } = useParams<{ id: string }>();
  const numId = parseInt(id ?? "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── TG dialog state ──────────────────────────────────────────────────────
  const [showTg, setShowTg] = useState(false);
  const [savedChannels, setSavedChannels] = useState<Record<string, ChannelConfig>>(loadAllChannels());

  // Bot tab
  const [botToken, setBotToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [botValid, setBotValid] = useState<null | { valid: boolean; username?: string | null }>(null);

  // Options tab
  const [postDelay, setPostDelay] = useState(2);
  const [questionPrefix, setQuestionPrefix] = useState("");
  const [explanationSuffix, setExplanationSuffix] = useState("");

  // Session tab
  const [enableIntro, setEnableIntro] = useState(false);
  const [introText, setIntroText] = useState("");
  const [pinIntro, setPinIntro] = useState(true);
  const [deleteService, setDeleteService] = useState(true);
  const [introPhotoFile, setIntroPhotoFile] = useState<File | null>(null);
  const [introPhotoPreview, setIntroPhotoPreview] = useState<string | null>(null);
  const [sendScore, setSendScore] = useState(true);
  const [scoreTemplate, setScoreTemplate] = useState(DEFAULT_SCORE_TPL);

  // Post progress
  const [postProgress, setPostProgress] = useState(0);
  const [postingStatus, setPostingStatus] = useState("");

  const introTextRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // ── Other dialog state ───────────────────────────────────────────────────
  const [showPdf, setShowPdf] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<PdfOptions>(defaultPdfOptions);
  const [pdfExporting, setPdfExporting] = useState(false);

  const [showGenerateMore, setShowGenerateMore] = useState(false);
  const [moreCount, setMoreCount] = useState(5);
  const [generatingMore, setGeneratingMore] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [expandedQ, setExpandedQ] = useState<number | null>(null);
  const [editingQ, setEditingQ] = useState<number | null>(null);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [draftCorrect, setDraftCorrect] = useState(0);
  const [draftExplanation, setDraftExplanation] = useState("");

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: quiz, isLoading } = useGetQuiz(numId, {
    query: { enabled: !!numId, queryKey: getGetQuizQueryKey(numId) },
  });
  const updateQuiz = useUpdateQuiz();
  const deleteQuiz = useDeleteQuiz();
  const validateBot = useValidateTelegramBot();

  // Load last-used channel on mount
  useEffect(() => {
    const all = loadAllChannels();
    const sorted = Object.values(all).sort((a, b) => b.lastUsed - a.lastUsed);
    if (sorted[0]) applyChannelConfig(sorted[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Per-channel helpers ───────────────────────────────────────────────────
  function applyChannelConfig(cfg: ChannelConfig) {
    setBotToken(cfg.botToken);
    setChannelId(cfg.channelId);
    setPostDelay(cfg.postDelay ?? 2);
    setQuestionPrefix(cfg.questionPrefix ?? "");
    setExplanationSuffix(cfg.explanationSuffix ?? "");
    setEnableIntro(cfg.enableIntro ?? false);
    setIntroText(cfg.introText ?? "");
    setPinIntro(cfg.pinIntro ?? true);
    setDeleteService(cfg.deleteService ?? true);
    setSendScore(cfg.sendScore ?? true);
    setScoreTemplate(cfg.scoreTemplate || DEFAULT_SCORE_TPL);
    setBotValid(null);
  }

  function currentConfig(): ChannelConfig {
    return {
      channelId, displayName: channelId, botToken, postDelay,
      questionPrefix, explanationSuffix, enableIntro, introText,
      pinIntro, deleteService, sendScore, scoreTemplate, lastUsed: Date.now(),
    };
  }

  function handleLoadChannel(cfg: ChannelConfig) {
    applyChannelConfig(cfg);
    toast({ title: `✅ "${cfg.displayName || cfg.channelId}" লোড হয়েছে` });
  }

  function handleRemoveChannel(id: string) {
    deleteChannelConfig(id);
    setSavedChannels(loadAllChannels());
    toast({ title: "Channel মুছে ফেলা হয়েছে" });
  }

  // ── Misc helpers ──────────────────────────────────────────────────────────
  const setPdfOpt = <K extends keyof PdfOptions>(k: K, v: PdfOptions[K]) =>
    setPdfOptions(p => ({ ...p, [k]: v }));

  const wrapSelection = (open: string, close: string) => {
    const el = introTextRef.current;
    if (!el) return;
    const s = el.selectionStart ?? 0, e = el.selectionEnd ?? 0;
    setIntroText(introText.slice(0, s) + open + introText.slice(s, e) + close + introText.slice(e));
    setTimeout(() => { el.focus(); el.setSelectionRange(s + open.length, e + open.length); }, 0);
  };

  const handlePhotoSelect = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setIntroPhotoFile(file);
    setIntroPhotoPreview(URL.createObjectURL(file));
  };

  const handleValidateBot = () => {
    if (!botToken.trim()) { toast({ title: "Bot token required", variant: "destructive" }); return; }
    validateBot.mutate({ data: { botToken } }, {
      onSuccess: d => { setBotValid(d); if (d.valid) toast({ title: `✅ @${d.username} verified` }); else toast({ title: "Invalid token", variant: "destructive" }); },
      onError: () => toast({ title: "Verification failed", variant: "destructive" }),
    });
  };

  // ── Post to Telegram ──────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!botToken.trim() || !channelId.trim()) {
      toast({ title: "Bot token এবং Channel ID দরকার", variant: "destructive" }); return;
    }
    const questions = quiz?.questions as QuizQuestion[];
    if (!questions?.length) return;

    // Save config for this channel
    const cfg = currentConfig();
    saveChannelConfig(cfg);
    setSavedChannels(loadAllChannels());

    setPostProgress(0); setPostingStatus("শুরু হচ্ছে...");

    try {
      let introMsgId: number | null = null;

      // ── Step 1: Intro message ──────────────────────────────────────────
      if (enableIntro && (introText.trim() || introPhotoFile)) {
        setPostingStatus("Intro message পাঠানো হচ্ছে...");
        const caption = introText.replace(/\{N\}/g, String(questions.length)).replace(/\{TOTAL\}/g, String(questions.length));

        let introResp: { ok: boolean; result?: { message_id: number }; description?: string };
        if (introPhotoFile) {
          const fd = new FormData();
          fd.append("chat_id", channelId);
          if (caption.trim()) { fd.append("caption", caption); fd.append("parse_mode", "HTML"); }
          fd.append("photo", introPhotoFile, introPhotoFile.name);
          const r = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: fd });
          introResp = await r.json() as typeof introResp;
        } else {
          introResp = await tgApi(botToken, "sendMessage", { chat_id: channelId, text: caption, parse_mode: "HTML" }) as typeof introResp;
        }

        if (!introResp.ok) {
          toast({ title: "Intro message পাঠাতে ব্যর্থ", description: introResp.description, variant: "destructive" });
          setPostProgress(0); setPostingStatus(""); return;
        }
        introMsgId = (introResp.result as { message_id: number })?.message_id ?? null;

        // ── Step 2: Pin + delete service message ───────────────────────
        if (pinIntro && introMsgId) {
          setPostingStatus("Message pin করা হচ্ছে...");
          const pinResp = await tgApi(botToken, "pinChatMessage", {
            chat_id: channelId, message_id: introMsgId, disable_notification: false,
          });
          if (pinResp.ok && deleteService) {
            await new Promise(r => setTimeout(r, 1500));
            try {
              const updResp = await fetch(
                `https://api.telegram.org/bot${botToken}/getUpdates?limit=10&allowed_updates=%5B%22message%22%5D`
              );
              const updData = await updResp.json() as {
                ok: boolean;
                result?: Array<{ message?: { message_id: number; pinned_message?: { message_id: number } } }>;
              };
              if (updData.ok) {
                const svc = updData.result?.find(u => u.message?.pinned_message?.message_id === introMsgId);
                if (svc?.message?.message_id) {
                  await tgApi(botToken, "deleteMessage", { chat_id: channelId, message_id: svc.message.message_id });
                }
              }
            } catch { /* best-effort */ }
          }
        }
      }

      // ── Step 3: Post polls ─────────────────────────────────────────────
      let posted = 0;
      const totalSteps = questions.length + (sendScore && introMsgId ? 1 : 0);

      for (let i = 0; i < questions.length; i++) {
        setPostingStatus(`প্রশ্ন ${i + 1}/${questions.length} পাঠানো হচ্ছে...`);
        const q = questions[i];
        const qText = questionPrefix ? `${questionPrefix}\n${q.question}` : q.question;
        const expl = q.explanation ? (explanationSuffix ? `${q.explanation}\n${explanationSuffix}` : q.explanation) : undefined;

        const payload: Record<string, unknown> = {
          chat_id: channelId,
          question: qText.slice(0, 300),
          options: q.options.map(o => o.slice(0, 100)),
          type: "quiz",
          correct_option_id: q.correctOptionIndex,
          explanation: expl?.slice(0, 200),
          is_anonymous: true,
        };
        if (introMsgId) payload.reply_to_message_id = introMsgId;

        const data = await tgApi(botToken, "sendPoll", payload);
        if (!data.ok) {
          toast({ title: `প্রশ্ন ${i + 1} পাঠাতে ব্যর্থ`, description: data.description, variant: "destructive" });
          setPostProgress(0); setPostingStatus(""); return;
        }
        posted++;
        setPostProgress(Math.round((posted / totalSteps) * 100));

        if (i < questions.length - 1 && postDelay > 0) {
          setPostingStatus(`${postDelay}s অপেক্ষা...`);
          await new Promise(r => setTimeout(r, postDelay * 1000));
        }
      }

      // ── Step 4: Score message ──────────────────────────────────────────
      if (sendScore && introMsgId) {
        setPostingStatus("Score message পাঠানো হচ্ছে...");
        const txt = scoreTemplate.replace(/\{N\}/g, String(questions.length)).replace(/\{TOTAL\}/g, String(questions.length));
        await tgApi(botToken, "sendMessage", { chat_id: channelId, text: txt, parse_mode: "HTML", reply_to_message_id: introMsgId });
        setPostProgress(100);
      }

      await fetch(`/api/quizzes/${numId}/mark-posted`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channelId }),
      });

      queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) });
      queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetQuizStatsQueryKey() });
      toast({ title: "✅ সফলভাবে পোস্ট হয়েছে!", description: `${posted}টি প্রশ্ন পাঠানো হয়েছে।` });
      setShowTg(false); setPostProgress(0); setPostingStatus("");
    } catch (err) {
      toast({ title: "Network error", description: err instanceof Error ? err.message : "Telegram-এ পৌঁছানো যাচ্ছে না।", variant: "destructive" });
      setPostProgress(0); setPostingStatus("");
    }
  };

  // ── Generate more ─────────────────────────────────────────────────────────
  const handleGenerateMore = async () => {
    setGeneratingMore(true);
    if (questions.length + moreCount > 30) {
      toast({
        title: "Limit exceeded",
        description: "Max 30 questions allowed",
        variant: "destructive"
      });
      return;
    }
    try {
      let remaining = moreCount;

      while (remaining > 0) {
        const batch = Math.min(5, remaining);

        const r = await fetch(`/api/quizzes/${numId}/add-questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ additionalCount: batch, language: "Bengali" }),
        });

        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed");

        remaining -= batch;
      }

      queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) });

      toast({ title: `✅ ${moreCount}টি প্রশ্ন যোগ হয়েছে!` });
      setShowGenerateMore(false);

    } catch (err) {
      toast({
        title: "প্রশ্ন তৈরি করতে ব্যর্থ",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive"
      });
    } finally {
      setGeneratingMore(false);
    }
  };

  // ── Edit helpers ──────────────────────────────────────────────────────────
  const handleSaveTitle = () => {
    if (!draftTitle.trim()) return;
    updateQuiz.mutate({ id: numId, data: { title: draftTitle.trim() } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) }); queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() }); setEditingTitle(false); toast({ title: "Title আপডেট হয়েছে" }); },
      onError: () => toast({ title: "আপডেট ব্যর্থ", variant: "destructive" }),
    });
  };

  const handleSaveQuestion = () => {
    if (!quiz || editingQ == null) return;
    const questions = (quiz.questions as QuizQuestion[]).map((q, i) =>
      i === editingQ ? { ...q, question: draftQuestion, options: draftOptions, correctOptionIndex: draftCorrect, explanation: draftExplanation } : q
    );
    updateQuiz.mutate({ id: numId, data: { questions } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetQuizQueryKey(numId) }); setEditingQ(null); toast({ title: "প্রশ্ন আপডেট হয়েছে" }); },
      onError: () => toast({ title: "আপডেট ব্যর্থ", variant: "destructive" }),
    });
  };

  const handleDeleteQuiz = () => {
    deleteQuiz.mutate({ id: numId }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetQuizStatsQueryKey() }); toast({ title: "Quiz মুছে ফেলা হয়েছে" }); setLocation("/history"); },
      onError: () => toast({ title: "মুছতে ব্যর্থ", variant: "destructive" }),
    });
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    if (!quiz) return;
    setPdfExporting(true);
    try {
      await exportQuizAsPDF({ title: quiz.title, questions: quiz.questions as QuizQuestion[], createdAt: quiz.createdAt, telegramChannel: quiz.telegramChannel }, pdfOptions);
      toast({ title: pdfOptions.separateSheets ? "✅ 2টি PDF ডাউনলোড হয়েছে" : "✅ PDF ডাউনলোড হয়েছে" });
      setShowPdf(false);
    } catch (err) { toast({ title: "PDF export ব্যর্থ", description: err instanceof Error ? err.message : undefined, variant: "destructive" }); }
    finally { setPdfExporting(false); }
  };

  // ── Render guards ─────────────────────────────────────────────────────────
  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  if (!quiz) return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
      <p className="text-lg font-medium">Quiz পাওয়া যায়নি</p>
      <Button className="mt-4" onClick={() => setLocation("/history")}>ইতিহাসে ফিরে যান</Button>
    </div>
  );

  const questions = quiz.questions as QuizQuestion[];
  const sortedChannels = Object.values(savedChannels).sort((a, b) => b.lastUsed - a.lastUsed);

  return (
    <div className="space-y-6 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/history")}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>

      {/* Title + Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <Input value={draftTitle} onChange={e => setDraftTitle(e.target.value)} className="text-xl font-bold h-auto py-1" autoFocus onKeyDown={e => e.key === "Enter" && handleSaveTitle()} />
              <Button size="sm" onClick={handleSaveTitle} disabled={updateQuiz.isPending}>{updateQuiz.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}><X className="w-4 h-4" /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{quiz.title}</h1>
              <button onClick={() => { setDraftTitle(quiz.title); setEditingTitle(true); }} className="text-muted-foreground hover:text-foreground shrink-0"><Edit2 className="w-4 h-4" /></button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-muted-foreground text-sm">{questions.length} প্রশ্ন</span>
            <span className="text-muted-foreground text-sm">•</span>
            <span className="text-muted-foreground text-sm">{format(new Date(quiz.createdAt), "PPP")}</span>
            {quiz.postedToTelegram && <Badge variant="secondary" className="bg-[#0088cc]/10 text-[#0088cc] border-0"><Send className="w-3 h-3 mr-1" /> {quiz.telegramChannel ?? "Telegram"}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => { exportQuizAsCSV({ title: quiz.title, questions: quiz.questions as QuizQuestion[] }); toast({ title: "✅ CSV ডাউনলোড হয়েছে" }); }}><FileText className="w-4 h-4 mr-1" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => { exportQuizAsJSON({ id: quiz.id, title: quiz.title, questions: quiz.questions as QuizQuestion[], createdAt: quiz.createdAt, telegramChannel: quiz.telegramChannel }); toast({ title: "✅ JSON ডাউনলোড হয়েছে" }); }}><FileJson className="w-4 h-4 mr-1" /> JSON</Button>
          <Button variant="outline" size="sm" onClick={() => setShowPdf(true)}><Download className="w-4 h-4 mr-1" /> PDF</Button>
          <Button size="sm" onClick={() => setShowTg(true)} className="bg-[#0088cc] hover:bg-[#0077b3]"><Send className="w-4 h-4 mr-1" /> Telegram</Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setShowDelete(true)}><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-3">
        {questions.map((q, i) => (
          <Card key={i} className="overflow-hidden border-border/60 hover:border-border transition-colors">
            <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedQ(expandedQ === i ? null : i)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="bg-primary/10 text-primary font-bold text-xs px-2 py-1 rounded-md shrink-0 mt-0.5 font-mono">Q{i + 1}</span>
                  <CardTitle className="text-sm font-medium leading-relaxed">{q.question}</CardTitle>
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  <button onClick={e => { e.stopPropagation(); setEditingQ(i); setDraftQuestion(q.question); setDraftOptions([...q.options]); setDraftCorrect(q.correctOptionIndex); setDraftExplanation(q.explanation ?? ""); setExpandedQ(i); }} className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                  {expandedQ === i ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>
            </CardHeader>
            {expandedQ === i && (
              <CardContent className="pt-0 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                {editingQ === i ? (
                  <div className="space-y-3 border rounded-xl p-4 bg-muted/20">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">প্রশ্ন</Label>
                      <Textarea value={draftQuestion} onChange={e => setDraftQuestion(e.target.value)} className="text-sm min-h-[80px]" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">অপশন (সঠিক উত্তর বেছে নিন)</Label>
                      {draftOptions.map((opt, j) => (
                        <div key={j} className="flex gap-2 items-center">
                          <button onClick={() => setDraftCorrect(j)} className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 border-2 transition-all ${draftCorrect === j ? "bg-emerald-500 text-white border-emerald-500" : "border-muted-foreground/40 text-muted-foreground hover:border-emerald-400"}`}>{String.fromCharCode(65 + j)}</button>
                          <Input value={opt} onChange={e => { const u = [...draftOptions]; u[j] = e.target.value; setDraftOptions(u); }} className="text-sm" />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">ব্যাখ্যা (ঐচ্ছিক)</Label>
                      <Textarea value={draftExplanation} onChange={e => setDraftExplanation(e.target.value)} className="text-sm min-h-[60px]" />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveQuestion} disabled={updateQuiz.isPending}>{updateQuiz.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} সংরক্ষণ</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingQ(null)}>বাতিল</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {q.options.map((opt, j) => (
                        <div key={j} className={`flex items-center gap-2.5 p-3 rounded-xl text-sm border transition-all ${j === q.correctOptionIndex ? "bg-emerald-50 border-emerald-200 text-emerald-900 font-semibold" : "bg-muted/30 border-border/40"}`}>
                          <span className={`font-bold text-xs w-6 h-6 flex items-center justify-center rounded-lg shrink-0 ${j === q.correctOptionIndex ? "bg-emerald-500 text-white" : "bg-muted-foreground/15 text-muted-foreground"}`}>{String.fromCharCode(65 + j)}</span>
                          <span className="flex-1">{opt}</span>
                          {j === q.correctOptionIndex && <Check className="w-3.5 h-3.5 ml-auto text-emerald-600 shrink-0" />}
                        </div>
                      ))}
                    </div>
                    {q.explanation && <div className="border-l-2 border-primary/50 pl-3 py-1 text-sm text-muted-foreground bg-primary/5 rounded-r-lg"><span className="font-semibold text-foreground">💡 ব্যাখ্যা: </span>{q.explanation}</div>}
                  </>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Generate More button */}
      <div className="flex justify-center pt-2">
        <Button variant="outline" size="sm" onClick={() => setShowGenerateMore(true)} className="gap-2 border-dashed border-2 hover:border-primary/50 hover:bg-primary/5">
          <Sparkles className="w-4 h-4 text-primary" /> আরও প্রশ্ন তৈরি করুন
        </Button>
      </div>

      {/* ═══════════════════════════════ TELEGRAM DIALOG ════════════════════════ */}
      <Dialog open={showTg} onOpenChange={o => { setShowTg(o); if (!o) { setPostProgress(0); setPostingStatus(""); } }}>
        <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-[#0088cc] flex items-center justify-center"><Send className="w-3.5 h-3.5 text-white" /></div>
              Telegram-এ পোস্ট করুন
            </DialogTitle>
            <DialogDescription className="sr-only">Telegram bot settings for posting quizzes</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="bot">
            <TabsList className="w-full grid grid-cols-3 h-9">
              <TabsTrigger value="bot" className="text-xs">🤖 Bot</TabsTrigger>
              <TabsTrigger value="session" className="text-xs">🎯 Session</TabsTrigger>
              <TabsTrigger value="options" className="text-xs">⚙️ Options</TabsTrigger>
            </TabsList>

            {/* ── Bot Tab ── */}
            <TabsContent value="bot" className="space-y-4 pt-3">
              {/* Saved channels */}
              {sortedChannels.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Star className="w-3 h-3" /> Saved Channels
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {sortedChannels.map(ch => (
                      <div key={ch.channelId} className="group flex items-center gap-1 bg-muted/50 hover:bg-muted rounded-lg pl-2.5 pr-1 py-1 border border-transparent hover:border-border/50 transition-all">
                        <button onClick={() => handleLoadChannel(ch)} className="text-xs font-medium flex items-center gap-1.5">
                          <Hash className="w-3 h-3 text-[#0088cc]" />
                          {ch.displayName || ch.channelId}
                        </button>
                        <button onClick={() => handleRemoveChannel(ch.channelId)} className="ml-1 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 p-0.5 rounded">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Click করলে ওই channel-এর সব settings load হবে।</p>
                </div>
              )}

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-semibold"><Bot className="w-3.5 h-3.5" /> Bot Token</Label>
                <div className="flex gap-2">
                  <Input type="password" placeholder="123456789:ABCdefGHI..." value={botToken} onChange={e => { setBotToken(e.target.value); setBotValid(null); }} />
                  <Button type="button" variant="outline" size="sm" onClick={handleValidateBot} disabled={!botToken || validateBot.isPending} className="shrink-0">
                    {validateBot.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                  </Button>
                </div>
                {botValid && (
                  <p className={`text-xs flex items-center gap-1.5 px-2 py-1.5 rounded-md ${botValid.valid ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                    {botValid.valid ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    {botValid.valid ? `✅ Valid: @${botValid.username}` : "❌ Invalid token"}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">@BotFather থেকে token নিন।</p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-semibold"><Hash className="w-3.5 h-3.5" /> Channel ID</Label>
                <Input placeholder="@mychannel বা -1001234567890" value={channelId} onChange={e => { setChannelId(e.target.value); }} />
                <p className="text-xs text-muted-foreground">Public: @channelname · Private: numeric ID · Bot অবশ্যই admin হতে হবে।</p>
              </div>
            </TabsContent>

            {/* ── Session Tab ── */}
            <TabsContent value="session" className="space-y-5 pt-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">📌 Intro Message</p>
                    <p className="text-xs text-muted-foreground">সব quiz এটিকে reply করবে</p>
                  </div>
                  <Switch checked={enableIntro} onCheckedChange={setEnableIntro} />
                </div>

                {enableIntro && (
                  <div className="space-y-3 border rounded-xl p-3 bg-muted/20">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-medium mr-1">HTML:</span>
                      {[["<b>","</b>",<Bold key="b" className="w-3 h-3" />,"Bold"],["<i>","</i>",<Italic key="i" className="w-3 h-3" />,"Italic"],["<code>","</code>",<span key="c" className="font-mono text-[9px]">{"</>"}</span>,"Code"]].map(([o,c,icon,t]) => (
                        <button key={String(t)} type="button" onClick={() => wrapSelection(o as string, c as string)} className="px-2 py-1 rounded border text-xs hover:bg-muted transition-colors" title={String(t)}>{icon}</button>
                      ))}
                      <span className="ml-auto text-[9px] text-muted-foreground">{"{N}"} = প্রশ্ন সংখ্যা</span>
                    </div>
                    <Textarea ref={introTextRef} placeholder={"🎓 <b>অধ্যায় ৩ — কোষ বিভাজন</b>\n\nমোট প্রশ্ন: {N}টি"} value={introText} onChange={e => setIntroText(e.target.value)} className="text-sm min-h-[90px] font-mono" maxLength={4096} />

                    <div>
                      <Label className="text-xs font-semibold flex items-center gap-1.5 mb-2"><Image className="w-3.5 h-3.5" /> Photo (ঐচ্ছিক)</Label>
                      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
                      {introPhotoPreview ? (
                        <div className="relative inline-block">
                          <img src={introPhotoPreview} alt="preview" className="h-20 w-auto rounded-lg border object-cover" />
                          <button type="button" onClick={() => { setIntroPhotoFile(null); setIntroPhotoPreview(null); if (photoInputRef.current) photoInputRef.current.value = ""; }} className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center shadow"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" type="button" onClick={() => photoInputRef.current?.click()} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Photo যোগ করুন</Button>
                      )}
                    </div>

                    <div className="border-t pt-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5"><Pin className="w-3.5 h-3.5 text-[#0088cc]" /><span className="text-xs font-semibold">Message Pin করুন</span></div>
                        <Switch checked={pinIntro} onCheckedChange={setPinIntro} />
                      </div>
                      {pinIntro && (
                        <div className="flex items-center justify-between pl-5">
                          <div><p className="text-xs font-medium">Service message মুছুন</p><p className="text-[10px] text-muted-foreground">"pinned a message" notification delete</p></div>
                          <Switch checked={deleteService} onCheckedChange={setDeleteService} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5 text-amber-500" /> Score Message</p>
                    <p className="text-xs text-muted-foreground">শেষে score বার্তা পাঠাবে</p>
                  </div>
                  <Switch checked={sendScore} onCheckedChange={setSendScore} />
                </div>
                {sendScore && (
                  <>
                    <Textarea value={scoreTemplate} onChange={e => setScoreTemplate(e.target.value)} className="text-sm min-h-[70px]" />
                    {!enableIntro && <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-2">⚠️ Intro Message চালু থাকলেই Score Message কাজ করবে।</p>}
                  </>
                )}
              </div>
            </TabsContent>

            {/* ── Options Tab ── */}
            <TabsContent value="options" className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-sm font-semibold"><Clock className="w-3.5 h-3.5" /> প্রশ্নের মধ্যে Delay (সেকেন্ড)</Label>
                <div className="flex items-center gap-3">
                  <Input type="number" min={0} max={60} value={postDelay} onChange={e => setPostDelay(Math.max(0, parseInt(e.target.value) || 0))} className="w-24" />
                  <span className="text-sm text-muted-foreground">১–৩s প্রস্তাবিত</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Question Prefix</Label>
                <Input placeholder="যেমন: ★" value={questionPrefix} onChange={e => setQuestionPrefix(e.target.value)} className="text-sm" maxLength={20} />
                {questionPrefix && <p className="text-xs bg-muted/40 rounded px-2 py-1 font-mono">{questionPrefix} প্রশ্নের টেক্সট...</p>}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Explanation Suffix</Label>
                <Input placeholder="যেমন: — HSC 2024" value={explanationSuffix} onChange={e => setExplanationSuffix(e.target.value)} className="text-sm" maxLength={50} />
              </div>
              <div className="bg-muted/40 rounded-xl p-3 text-sm space-y-1">
                <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Summary</p>
                <p className="text-muted-foreground">{questions.length}টি প্রশ্ন anonymous quiz poll</p>
                <p className="text-muted-foreground">আনুমানিক সময়: ~{Math.round(questions.length * (postDelay + 1))}s</p>
                {channelId && <p className="text-[#0088cc] font-medium">{channelId}</p>}
              </div>
            </TabsContent>
          </Tabs>

          {postProgress > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-between text-xs text-muted-foreground"><span>{postingStatus}</span><span className="font-mono">{postProgress}%</span></div>
              <Progress value={postProgress} className="h-2" />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowTg(false); setPostProgress(0); setPostingStatus(""); }}>বাতিল</Button>
            <Button onClick={handlePost} disabled={!botToken || !channelId || postProgress > 0} className="bg-[#0088cc] hover:bg-[#0077b3] gap-2">
              {postProgress > 0 ? <><Loader2 className="w-4 h-4 animate-spin" /> পাঠানো হচ্ছে...</> : <><Send className="w-4 h-4" /> {questions.length}টি প্রশ্ন পোস্ট করুন</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════ PDF DIALOG ════════════════════════════ */}
      <Dialog open={showPdf} onOpenChange={setShowPdf}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Download className="w-4 h-4 text-primary" /> PDF Export সেটিং</DialogTitle>
            <DialogDescription className="sr-only">PDF export options for the quiz</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="style">
            <TabsList className="w-full grid grid-cols-4 h-9">
              <TabsTrigger value="style" className="text-xs">🎨 Style</TabsTrigger>
              <TabsTrigger value="layout" className="text-xs">📐 Layout</TabsTrigger>
              <TabsTrigger value="content" className="text-xs">📋 Content</TabsTrigger>
              <TabsTrigger value="text" className="text-xs">✏️ Header</TabsTrigger>
            </TabsList>

            <TabsContent value="style" className="space-y-5 pt-3">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Theme</Label>
                <div className="grid grid-cols-5 gap-2">
                  {([{id:"teal",label:"Teal",color:"#007B6E"},{id:"blue",label:"Blue",color:"#2563EB"},{id:"purple",label:"Purple",color:"#7C3AED"},{id:"dark",label:"Dark",color:"#1e293b"},{id:"minimal",label:"Minimal",color:"#444"}] as {id:PdfTheme;label:string;color:string}[]).map(({id,label,color}) => (
                    <button key={id} onClick={() => setPdfOpt("theme", id)} className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 text-xs font-medium transition-all ${pdfOptions.theme===id?"border-primary bg-primary/5":"border-transparent bg-muted/40 hover:bg-muted/70"}`}>
                      <span className="w-7 h-7 rounded-full border border-black/10 shadow-sm" style={{background:color}} />
                      {label}
                      {pdfOptions.theme===id && <Check className="w-3 h-3 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Watermark</Label>
                <Input placeholder='"DRAFT" বা "HSC 2025"' value={pdfOptions.watermarkText} onChange={e => setPdfOpt("watermarkText", e.target.value)} className="text-sm" maxLength={40} />
                {pdfOptions.watermarkText && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground"><span>Opacity</span><span>{pdfOptions.watermarkOpacity}%</span></div>
                    <Slider min={5} max={60} step={5} value={[pdfOptions.watermarkOpacity]} onValueChange={([v]) => setPdfOpt("watermarkOpacity", v)} />
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="layout" className="space-y-5 pt-3">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([{v:1,label:"1 Column",desc:"Single column — সহজ পড়া"},{v:2,label:"2 Columns",desc:"Side by side — বেশি প্রশ্ন / পাতা"}] as {v:1|2;label:string;desc:string}[]).map(({v,label,desc}) => (
                    <button key={v} onClick={() => setPdfOpt("columns", v)} className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${pdfOptions.columns===v?"border-primary bg-primary/5":"border-transparent bg-muted/40 hover:bg-muted/60"}`}>
                      <Columns className={`w-5 h-5 ${pdfOptions.columns===v?"text-primary":"text-muted-foreground"}`} />
                      <div><p className="text-sm font-semibold">{label}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
                      {pdfOptions.columns===v && <Check className="w-4 h-4 text-primary ml-auto" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Font Size</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["small","medium","large"] as const).map(fs => (
                    <button key={fs} onClick={() => setPdfOpt("fontSize", fs)} className={`p-2.5 rounded-xl border-2 text-sm font-medium transition-all capitalize ${pdfOptions.fontSize===fs?"border-primary bg-primary/5":"border-transparent bg-muted/40 hover:bg-muted/60"}`}>
                      {fs==="small"?"Small":fs==="medium"?"Medium":"Large"}
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="content" className="space-y-3 pt-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">PDF Content</Label>
              {([{id:"questions",label:"Questions Only",desc:"শুধু প্রশ্ন — উত্তর নেই",icon:"📋"},{id:"answers",label:"Questions + Answers",desc:"সঠিক উত্তর হাইলাইট",icon:"✅"},{id:"full",label:"Full (Q + A + Explanation)",desc:"প্রশ্ন, উত্তর, ব্যাখ্যা",icon:"📖"}] as {id:PdfContentMode;label:string;desc:string;icon:string}[]).map(({id,label,desc,icon}) => (
                <button key={id} onClick={() => { setPdfOpt("contentMode", id); setPdfOpt("separateSheets", false); }} className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${pdfOptions.contentMode===id&&!pdfOptions.separateSheets?"border-primary bg-primary/5":"border-transparent bg-muted/40 hover:bg-muted/60"}`}>
                  <span className="text-xl shrink-0">{icon}</span>
                  <div className="flex-1"><p className="text-sm font-semibold">{label}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
                  {pdfOptions.contentMode===id&&!pdfOptions.separateSheets&&<Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              ))}
              <button onClick={() => setPdfOpt("separateSheets", !pdfOptions.separateSheets)} className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${pdfOptions.separateSheets?"border-primary bg-primary/5":"border-transparent bg-muted/40 hover:bg-muted/60"}`}>
                <span className="text-xl shrink-0">📦</span>
                <div className="flex-1"><p className="text-sm font-semibold">Separate Sheets</p><p className="text-xs text-muted-foreground">2 আলাদা PDF — Question Sheet + Answer Key</p></div>
                {pdfOptions.separateSheets&&<Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            </TabsContent>

            <TabsContent value="text" className="space-y-4 pt-3">
              <div className="space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Header Text</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Left</Label><Input placeholder="Quiz Generator" value={pdfOptions.headerLeft} onChange={e => setPdfOpt("headerLeft", e.target.value)} className="text-sm" maxLength={60} /></div>
                  <div className="space-y-1"><Label className="text-[11px] text-muted-foreground">Right</Label><Input placeholder="(ঐচ্ছিক)" value={pdfOptions.headerRight} onChange={e => setPdfOpt("headerRight", e.target.value)} className="text-sm" maxLength={60} /></div>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Footer</Label>
                <Input placeholder="Generated by Telegram Quiz Generator" value={pdfOptions.footerLeft} onChange={e => setPdfOpt("footerLeft", e.target.value)} className="text-sm" maxLength={80} />
                <div className="flex items-center gap-3"><Switch id="spn" checked={pdfOptions.showPageNumbers} onCheckedChange={v => setPdfOpt("showPageNumbers", v)} /><Label htmlFor="spn" className="text-sm cursor-pointer">Page numbers দেখান</Label></div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="bg-muted/40 rounded-xl px-3 py-2.5 text-xs text-muted-foreground space-y-1 mt-1">
            <p className="font-semibold text-foreground text-xs mb-1">Export Summary</p>
            <p>Theme: <span className="text-foreground capitalize font-medium">{pdfOptions.theme}</span> · Layout: <span className="text-foreground font-medium">{pdfOptions.columns}-column, {pdfOptions.fontSize} font</span></p>
            <p className="text-amber-600">⏳ PDF তৈরিতে ৫–১০ সেকেন্ড লাগতে পারে (Bengali font)।</p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowPdf(false)}>বাতিল</Button>
            <Button onClick={handleDownloadPDF} size="sm" className="gap-2 min-w-[140px]" disabled={pdfExporting}>
              {pdfExporting ? <><Loader2 className="w-4 h-4 animate-spin" /> PDF তৈরি হচ্ছে...</> : <><Download className="w-4 h-4" /> PDF ডাউনলোড</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════ GENERATE MORE ══════════════════════════ */}
      <Dialog open={showGenerateMore} onOpenChange={setShowGenerateMore}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> আরও প্রশ্ন তৈরি করুন</DialogTitle>
            <DialogDescription className="sr-only">Generate additional questions</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">একই বিষয়ের উপর AI দিয়ে নতুন প্রশ্ন যোগ করবে।</p>
            <div className="space-y-2">
              <Label className="text-sm font-medium">কতটি প্রশ্ন যোগ করবেন?</Label>
              <div className="flex items-center gap-3">
                <Input type="number" min={1} max={10} value={moreCount} onChange={e => setMoreCount(Math.max(1, Math.min(10, parseInt(e.target.value)||5)))} className="w-24" />
                <span className="text-sm text-muted-foreground">টি (সর্বোচ্চ ১০)</span>
              </div>
            </div>
            <div className="bg-muted/50 rounded-xl px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">এখন: <b>{questions.length}</b></span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span className="text-foreground font-semibold">{questions.length + moreCount} প্রশ্ন</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowGenerateMore(false)}>বাতিল</Button>
            <Button size="sm" onClick={handleGenerateMore} disabled={generatingMore} className="gap-1.5 min-w-[120px]">
              {generatingMore ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> তৈরি হচ্ছে...</> : <><Plus className="w-3.5 h-3.5" /> {moreCount}টি যোগ করুন</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quiz মুছে ফেলবেন?</AlertDialogTitle>
            <AlertDialogDescription>এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>বাতিল</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteQuiz} className="bg-destructive hover:bg-destructive/90">মুছে ফেলুন</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
