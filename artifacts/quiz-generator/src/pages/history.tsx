import { useState } from "react";
import { Link } from "wouter";
import { useListQuizzes, getListQuizzesQueryKey, useDeleteQuiz } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Search, FileQuestion, Trash2, Eye, Send, Loader2, PlusCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function History() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterPosted, setFilterPosted] = useState<"all" | "posted" | "unposted">("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: quizzes, isLoading } = useListQuizzes({ query: { queryKey: getListQuizzesQueryKey() } });
  const deleteQuiz = useDeleteQuiz();

  const filtered = (quizzes ?? []).filter((q) => {
    const matchesSearch = !search || q.title.toLowerCase().includes(search.toLowerCase()) || q.sourceContent.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filterPosted === "all" ||
      (filterPosted === "posted" && q.postedToTelegram) ||
      (filterPosted === "unposted" && !q.postedToTelegram);
    return matchesSearch && matchesFilter;
  });

  const handleDelete = () => {
    if (deleteId == null) return;
    deleteQuiz.mutate({ id: deleteId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        toast({ title: "Quiz deleted" });
        setDeleteId(null);
      },
      onError: () => {
        toast({ title: "Failed to delete", variant: "destructive" });
        setDeleteId(null);
      },
    });
  };

  return (
    <div className="space-y-6 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Quiz History</h1>
          <p className="text-muted-foreground mt-1">All your generated quizzes in one place.</p>
        </div>
        <Link href="/create">
          <Button data-testid="button-create-new">
            <PlusCircle className="w-4 h-4 mr-2" />
            Create Quiz
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search quizzes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "posted", "unposted"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filterPosted === f ? "default" : "outline"}
              onClick={() => setFilterPosted(f)}
              data-testid={`button-filter-${f}`}
            >
              {f === "all" ? "All" : f === "posted" ? "Posted" : "Unposted"}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileQuestion className="w-12 h-12 text-muted-foreground opacity-20 mb-4" />
            <h3 className="text-lg font-medium mb-1">{quizzes?.length === 0 ? "No quizzes yet" : "No results found"}</h3>
            <p className="text-muted-foreground mb-4 max-w-sm">
              {quizzes?.length === 0 ? "Create your first quiz to get started." : "Try adjusting your search or filters."}
            </p>
            {quizzes?.length === 0 && (
              <Link href="/create">
                <Button>Create Quiz</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.slice().reverse().map((quiz) => (
            <Card key={quiz.id} className="hover:shadow-sm transition-shadow" data-testid={`card-quiz-${quiz.id}`}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{quiz.title || "Untitled Quiz"}</span>
                      {quiz.postedToTelegram && (
                        <Badge variant="secondary" className="bg-[#0088cc]/10 text-[#0088cc] border-0 text-[10px] font-bold">
                          <Send className="w-2.5 h-2.5 mr-1" />
                          POSTED
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {quiz.questionCount} questions
                      {quiz.telegramChannel && <span> • {quiz.telegramChannel}</span>}
                      <span> • {format(new Date(quiz.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1 max-w-xl">
                      {quiz.sourceContent}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/quiz/${quiz.id}`}>
                      <Button size="sm" variant="outline" data-testid={`button-view-${quiz.id}`}>
                        <Eye className="w-4 h-4" />
                        <span className="hidden sm:inline ml-1">View</span>
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteId(quiz.id)}
                      data-testid={`button-delete-${quiz.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={deleteId != null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quiz</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The quiz and all its questions will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteQuiz.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
