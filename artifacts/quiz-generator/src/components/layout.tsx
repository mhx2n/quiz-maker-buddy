import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, PlusCircle, History, Zap } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/create", label: "Create Quiz", icon: PlusCircle },
    { href: "/history", label: "History", icon: History },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar — desktop only */}
      <aside className="w-64 border-r bg-card flex-col hidden md:flex shrink-0">
        <div className="h-16 flex items-center px-6 border-b">
          <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
            <Zap className="w-5 h-5 fill-current" />
            <span>QuizGen</span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">Menu</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t">
          <div className="bg-muted rounded-lg p-4 text-xs">
            <div className="font-semibold text-foreground mb-1">Telegram Quiz Generator</div>
            <div className="text-muted-foreground">Generate quizzes from text or images and post to Telegram instantly.</div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Mobile Header */}
        <header className="h-14 border-b bg-card flex items-center px-4 md:hidden shrink-0">
          <div className="flex items-center gap-2 text-primary font-bold text-lg">
            <Zap className="w-5 h-5 fill-current" />
            <span>QuizGen</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-20 md:pb-8">
          <div className="max-w-6xl mx-auto h-full">
            {children}
          </div>
        </div>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t z-50">
          <div className="flex items-stretch">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href} className="flex-1">
                  <div className={`relative flex flex-col items-center justify-center py-2.5 gap-1 transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}>
                    <Icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                    <span className="text-[10px] font-medium leading-none">{item.label}</span>
                    {isActive && <span className="absolute bottom-0 w-8 h-0.5 bg-primary rounded-t-full" />}
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
    </div>
  );
}
