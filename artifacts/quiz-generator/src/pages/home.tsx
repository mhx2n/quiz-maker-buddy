import { useGetQuizStats, useListQuizzes, getGetQuizStatsQueryKey, getListQuizzesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { BrainCircuit, Send, FileQuestion, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export default function Home() {
  const { data: stats, isLoading: statsLoading } = useGetQuizStats({
    query: { queryKey: getGetQuizStatsQueryKey() }
  });

  const { data: quizzes, isLoading: quizzesLoading } = useListQuizzes({
    query: { queryKey: getListQuizzesQueryKey() }
  });

  const recentQuizzes = quizzes?.slice(0, 5) || [];

  return (
    <div className="space-y-8 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your generated content and Telegram activity.</p>
        </div>
        <Link href="/create">
          <Button size="lg" className="shadow-sm">
            <BrainCircuit className="w-4 h-4 mr-2" />
            Create New Quiz
          </Button>
        </Link>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2"><div className="h-4 w-24 bg-muted rounded"></div></CardHeader>
              <CardContent><div className="h-8 w-16 bg-muted rounded"></div></CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-l-4 border-l-primary shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Quizzes</CardTitle>
              <FileQuestion className="w-4 h-4 text-primary opacity-70" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.totalQuizzes || 0}</div>
            </CardContent>
          </Card>
          
          <Card className="border-l-4 border-l-accent shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Questions</CardTitle>
              <BrainCircuit className="w-4 h-4 text-accent opacity-70" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.totalQuestions || 0}</div>
            </CardContent>
          </Card>
          
          <Card className="border-l-4 border-l-[#0088cc] shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Posted to Telegram</CardTitle>
              <Send className="w-4 h-4 text-[#0088cc] opacity-70" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats?.postedToTelegram || 0}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recent Quizzes</h2>
          <Link href="/history">
            <Button variant="ghost" size="sm" className="text-primary">
              View All <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
        
        {quizzesLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : recentQuizzes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentQuizzes.map((quiz) => (
              <Card key={quiz.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-semibold line-clamp-1 flex-1">{quiz.title || "Untitled Quiz"}</div>
                    {quiz.postedToTelegram && (
                      <span className="bg-[#0088cc]/10 text-[#0088cc] text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                        POSTED
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mb-4">
                    {quiz.questionCount} questions • {format(new Date(quiz.createdAt), "MMM d, yyyy")}
                  </div>
                  <Link href={`/quiz/${quiz.id}`}>
                    <Button variant="secondary" className="w-full">View Details</Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <FileQuestion className="w-12 h-12 text-muted-foreground opacity-20 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">No quizzes yet</h3>
              <p className="text-muted-foreground mb-4 max-w-sm">Generate your first quiz from text or an image to get started.</p>
              <Link href="/create">
                <Button>Create Quiz</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
