import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useGenerateQuiz } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListQuizzesQueryKey, getGetQuizStatsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  BrainCircuit, Upload, X, Loader2, ImageIcon, ScanText, CheckCircle2,
  AlertCircle, FlaskConical, Stethoscope, GraduationCap, BookOpen, Atom, Globe,
} from "lucide-react";
import { extractTextFromImage } from "@/lib/ocr";

type OCRState = "idle" | "loading" | "done" | "error";

interface CategoryOption {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

const CATEGORIES: CategoryOption[] = [
  { id: "general", label: "General", sublabel: "BCS, Bank, GK", icon: <Globe className="w-4 h-4" />, color: "text-slate-600", bg: "bg-slate-50 border-slate-200" },
  { id: "engineering", label: "Engineering", sublabel: "BUET / CUET", icon: <Atom className="w-4 h-4" />, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  { id: "medical", label: "Medical", sublabel: "MBBS / BDS", icon: <Stethoscope className="w-4 h-4" />, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
  { id: "varsity", label: "University", sublabel: "DU / RU / CU", icon: <GraduationCap className="w-4 h-4" />, color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
  { id: "hsc", label: "HSC", sublabel: "A-Level / HSC", icon: <BookOpen className="w-4 h-4" />, color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  { id: "ssc", label: "SSC", sublabel: "O-Level / SSC", icon: <FlaskConical className="w-4 h-4" />, color: "text-pink-600", bg: "bg-pink-50 border-pink-200" },
];

export default function CreateQuiz() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  const [language, setLanguage] = useState("Bengali");
  const [category, setCategory] = useState("general");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [ocrState, setOcrState] = useState<OCRState>("idle");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrConfidence, setOcrConfidence] = useState(0);

  const generateQuiz = useGenerateQuiz();

  const compressImage = useCallback((file: File): Promise<{ dataUrl: string; base64: string }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX_W = 1280, MAX_H = 1280;
        let { width, height } = img;
        if (width > MAX_W || height > MAX_H) {
          const ratio = Math.min(MAX_W / width, MAX_H / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas not supported")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        resolve({ dataUrl, base64: dataUrl.split(",")[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
      img.src = objectUrl;
    });
  }, []);

  const handleImageUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 20MB.", variant: "destructive" });
      return;
    }
    try {
      const { dataUrl, base64 } = await compressImage(file);
      setImagePreview(dataUrl);
      setImageBase64(base64);
      setOcrState("idle"); setOcrProgress(0);
      const sizeMB = (base64.length * 0.75 / 1024 / 1024).toFixed(1);
      toast({ title: `✅ Image ready (${sizeMB} MB)`, description: "Click 'Extract Text' for OCR, or generate directly." });
    } catch {
      toast({ title: "Image processing failed", variant: "destructive" });
    }
  }, [toast, compressImage]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleImageUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleImageUpload(file);
  };

  const handleRemoveImage = () => {
    setImageBase64(null); setImagePreview(null); setOcrState("idle");
    setOcrProgress(0); setOcrConfidence(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRunOCR = async () => {
    if (!imagePreview) return;
    setOcrState("loading"); setOcrProgress(0);
    try {
      const result = await extractTextFromImage(imagePreview, (p) => setOcrProgress(p));
      if (result.text.length < 10) {
        toast({ title: "OCR result too short", description: "Try a clearer image.", variant: "destructive" });
        setOcrState("error"); return;
      }
      setContent((prev) => prev ? `${prev}\n\n--- OCR Extracted ---\n${result.text}` : result.text);
      setOcrConfidence(result.confidence);
      setOcrState("done");
      toast({ title: `✅ OCR সম্পন্ন! (${result.confidence}% confidence)` });
    } catch {
      setOcrState("error");
      toast({ title: "OCR failed", description: "Try a different image or paste text manually.", variant: "destructive" });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !imageBase64) {
      toast({ title: "Content required", description: "Please paste text, upload an image, or run OCR first.", variant: "destructive" });
      return;
    }
    generateQuiz.mutate(
      {
        data: {
          content: content.trim() || "",
          title: title.trim() || undefined,
          imageBase64: imageBase64 || undefined,
          questionCount,
          language,
          // @ts-ignore — category passed as extra field server reads from req.body
          category,
        },
      },
      {
        onSuccess: (quiz) => {
          queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetQuizStatsQueryKey() });
          toast({ title: "✅ Quiz তৈরি হয়েছে!", description: `${quiz.questionCount}টি প্রশ্ন সফলভাবে generate হয়েছে।` });
          setLocation(`/quiz/${quiz.id}`);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Could not generate quiz. Please try again.";
          toast({ title: "Generation failed", description: msg.replace(/^HTTP \d+ [^:]+: /, ""), variant: "destructive" });
        },
      }
    );
  };

  const selectedCat = CATEGORIES.find((c) => c.id === category);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Quiz তৈরি করুন</h1>
        <p className="text-muted-foreground mt-1">Text paste করুন বা image আপলোড করুন — AI দিয়ে quiz তৈরি হবে।</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Content Card */}
        <Card className="border-border/60">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">📄 Source Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-sm font-medium">Quiz Title <span className="text-muted-foreground font-normal">(ঐচ্ছিক)</span></Label>
              <Input id="title" placeholder="যেমন: জীববিজ্ঞান — কোষ বিভাজন" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content" className="text-sm font-medium">Content / Notes</Label>
              <Textarea
                id="content"
                placeholder="আপনার টেক্সট, বইয়ের অধ্যায়, নোট, বা প্রশ্নের বিষয়বস্তু এখানে paste করুন..."
                className="min-h-[160px] text-sm leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">{content.length} characters</p>
                {content.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="text-xs h-auto py-1" onClick={() => setContent("")}>Clear</Button>
                )}
              </div>
            </div>

            {/* Image upload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">📷 Image / Page Photo (OCR)</Label>
                {imagePreview && ocrState === "idle" && (
                  <Button type="button" size="sm" variant="secondary" onClick={handleRunOCR} className="gap-1.5 h-8">
                    <ScanText className="w-3.5 h-3.5" /> Text Extract (OCR)
                  </Button>
                )}
                {ocrState === "done" && (
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-0 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> OCR সম্পন্ন ({ocrConfidence}%)
                  </Badge>
                )}
                {ocrState === "error" && (
                  <Badge variant="secondary" className="bg-red-50 text-red-700 border-0 gap-1">
                    <AlertCircle className="w-3 h-3" /> OCR ব্যর্থ
                  </Badge>
                )}
              </div>

              {imagePreview ? (
                <div className="relative">
                  <img src={imagePreview} alt="Preview" className="w-full max-h-56 object-contain rounded-xl border bg-muted/30" />
                  <button type="button" onClick={handleRemoveImage}
                    className="absolute top-2 right-2 bg-background/80 backdrop-blur rounded-full p-1.5 hover:bg-destructive hover:text-destructive-foreground transition-colors shadow">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  {ocrState === "loading" && (
                    <div className="mt-3 space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> OCR চলছে...</span>
                        <span>{ocrProgress}%</span>
                      </div>
                      <Progress value={ocrProgress} className="h-1.5" />
                    </div>
                  )}
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-primary/3 transition-all text-muted-foreground group"
                >
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3 group-hover:bg-primary/10 transition-colors">
                    <Upload className="w-5 h-5 group-hover:text-primary transition-colors" />
                  </div>
                  <span className="text-sm font-medium">Click to upload or drag & drop</span>
                  <span className="text-xs mt-1 text-muted-foreground/70">PNG, JPG, WEBP · Max 20MB</span>
                  <span className="text-xs mt-1.5 text-primary/70 flex items-center gap-1">
                    <ScanText className="w-3 h-3" /> Bengali & English OCR সমর্থিত
                  </span>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </div>
          </CardContent>
        </Card>

        {/* Settings Card */}
        <Card className="border-border/60">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">⚙️ Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Category */}
            <div className="space-y-2.5">
              <Label className="text-sm font-medium">Quiz Category / Standard</Label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 text-center transition-all ${
                      category === cat.id
                        ? `${cat.bg} border-current ${cat.color} shadow-sm`
                        : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    <span className={category === cat.id ? cat.color : ""}>{cat.icon}</span>
                    <span className="text-[11px] font-semibold leading-tight">{cat.label}</span>
                    <span className="text-[9px] leading-tight opacity-70">{cat.sublabel}</span>
                  </button>
                ))}
              </div>
              {selectedCat && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/40 rounded-lg px-2.5 py-1.5">
                  <span className={selectedCat.color}>{selectedCat.icon}</span>
                  <span><b>{selectedCat.label}</b> standard-এ admission level প্রশ্ন তৈরি হবে ({selectedCat.sublabel})</span>
                </p>
              )}
            </div>

            {/* Question count */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">প্রশ্নের সংখ্যা</Label>
                <span className="text-2xl font-bold text-primary tabular-nums">{questionCount}</span>
              </div>
              <Slider min={1} max={20} step={1} value={[questionCount]} onValueChange={([v]) => setQuestionCount(v)} className="w-full" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1</span>
                <span>10</span>
                <span>25</span>
                <span>50</span>
              </div>
              {questionCount > 20 && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5">
                  ⏳ {questionCount} প্রশ্নের জন্য batch-এ generate হবে — একটু বেশি সময় লাগতে পারে।
                </p>
              )}
            </div>

            {/* Language */}
            <div className="space-y-2">
              <Label htmlFor="language" className="text-sm font-medium">Quiz Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bengali">🇧🇩 Bengali (বাংলা)</SelectItem>
                  <SelectItem value="English">🇬🇧 English</SelectItem>
                  <SelectItem value="Bengali and English">🌐 Bengali + English (Mixed)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <Button
          type="submit"
          size="lg"
          className="w-full h-12 text-base font-semibold"
          disabled={generateQuiz.isPending || (!content.trim() && !imageBase64)}
        >
          {generateQuiz.isPending ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Quiz তৈরি হচ্ছে... একটু অপেক্ষা করুন</>
          ) : (
            <><BrainCircuit className="w-5 h-5 mr-2" /> {questionCount}টি প্রশ্ন Generate করুন</>
          )}
        </Button>
      </form>
    </div>
  );
}
