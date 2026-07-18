import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { ChatProvider } from "./context/ChatContext";
import { AgentProvider, useAgentContext } from "./context/AgentContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { apiGet } from "./api/client";
import type { FeedbackListResponse } from "./api/types";
import { getFeedbackLastSeen } from "./hooks/feedbackSeen";
import ChatView from "./views/ChatView";
import RunsView from "./views/RunsView";
import RunDetailView from "./views/RunDetailView";
import FeedbackView from "./views/FeedbackView";
import RegressionView from "./views/RegressionView";
import PlaygroundView from "./views/PlaygroundView";
import LoginView from "./views/LoginView";

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("app-theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("app-theme", dark ? "dark" : "light");
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return { dark, toggle };
}

function AgentDropdown() {
  const { agents, selectedAgent, setSelectedAgent } = useAgentContext();
  const [open, setOpen] = useState(false);

  const displayLabel =
    selectedAgent === "router"
      ? "Router (Auto)"
      : selectedAgent.replace(/_/g, " ");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[13px] font-bold tracking-tight transition-colors hover:bg-[var(--c-bg-tertiary)]"
        style={{ color: "var(--c-text-1)" }}
      >
        <span className="capitalize">{displayLabel}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* Click-away overlay */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div
            className="absolute top-full left-0 mt-1 z-50 min-w-[220px] rounded-lg shadow-lg border py-1"
            style={{
              background: "var(--c-bg)",
              borderColor: "var(--c-border)",
            }}
          >
            {/* Router (Auto) option */}
            <button
              onClick={() => {
                setSelectedAgent("router");
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-[13px] transition-colors hover:bg-[var(--c-bg-tertiary)]"
              style={{
                color:
                  selectedAgent === "router"
                    ? "var(--color-brand)"
                    : "var(--c-text-1)",
                fontWeight: selectedAgent === "router" ? 600 : 400,
              }}
            >
              <div className="flex items-center justify-between">
                <span>Router (Auto)</span>
                {selectedAgent === "router" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span
                className="text-[11px] block mt-0.5"
                style={{ color: "var(--c-text-3)" }}
              >
                LLM picks the best agent automatically
              </span>
            </button>

            <div className="my-1 border-t" style={{ borderColor: "var(--c-border)" }} />

            {/* Agent options */}
            {agents.map((agent) => (
              <button
                key={agent.name}
                onClick={() => {
                  setSelectedAgent(agent.name);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-[13px] transition-colors hover:bg-[var(--c-bg-tertiary)]"
                style={{
                  color:
                    selectedAgent === agent.name
                      ? "var(--color-brand)"
                      : "var(--c-text-1)",
                  fontWeight: selectedAgent === agent.name ? 600 : 400,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="capitalize">
                    {agent.name.replace(/_/g, " ")}
                  </span>
                  {selectedAgent === agent.name && (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                {agent.description && (
                  <span
                    className="text-[11px] block mt-0.5 line-clamp-2"
                    style={{ color: "var(--c-text-3)" }}
                  >
                    {agent.description.length > 100
                      ? agent.description.slice(0, 100) + "..."
                      : agent.description}
                  </span>
                )}
              </button>
            ))}

            {agents.length === 0 && (
              <div
                className="px-3 py-2 text-[12px]"
                style={{ color: "var(--c-text-3)" }}
              >
                Loading agents...
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NavBar() {
  const location = useLocation();
  const { dark, toggle } = useTheme();
  const { user } = useAuth();

  // Unread feedback since this user last opened the Feedback tab (nav badge).
  const [feedbackUnread, setFeedbackUnread] = useState(0);
  useEffect(() => {
    const seen = getFeedbackLastSeen(user);
    if (!seen) { setFeedbackUnread(0); return; }
    let cancelled = false;
    apiGet<FeedbackListResponse>(`/feedback?created_after=${encodeURIComponent(seen)}&limit=1`)
      .then((r) => { if (!cancelled) setFeedbackUnread(r.total); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [user, location.pathname]);

  const isActive = (path: string) =>
    location.pathname === path || (path === "/runs" && location.pathname.startsWith("/runs")) || (path === "/tests" && location.pathname.startsWith("/tests")) || (path === "/playground" && location.pathname.startsWith("/playground")) || (path === "/feedback" && location.pathname.startsWith("/feedback"));

  const linkClass = (path: string) =>
    `px-2 py-1 text-[13px] font-medium transition-colors ${
      isActive(path)
        ? "text-[var(--c-text-1)] border-b-2 border-[var(--color-brand)]"
        : "text-[var(--c-text-3)] hover:text-[var(--c-text-1)]"
    }`;

  const showBadge = feedbackUnread > 0 && location.pathname !== "/feedback";

  return (
    <nav className="flex items-center gap-4 px-6 h-12 border-b" style={{ background: "var(--c-bg)", borderColor: "var(--c-border)" }}>
      <div className="flex items-center gap-4">
        <AgentDropdown />
        <div className="w-px h-5" style={{ background: "var(--c-border)" }} />
        <Link to="/" className={linkClass("/")}>Chat</Link>
        <Link to="/runs" className={linkClass("/runs")}>Runs</Link>
        <Link to="/feedback" className={`relative ${linkClass("/feedback")}`}>
          Feedback
          {showBadge && (
            <span
              className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
              style={{ background: "var(--color-brand)", color: "#fff" }}
            >
              {feedbackUnread > 99 ? "99+" : feedbackUnread}
            </span>
          )}
        </Link>
        <Link to="/tests" className={linkClass("/tests")}>Tests</Link>
        <Link to="/playground" className={linkClass("/playground")}>Playground</Link>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <UserMenu />
        <button
          onClick={toggle}
          className="w-8 h-8 rounded flex items-center justify-center hover:bg-[var(--c-bg-tertiary)]"
          style={{ color: "var(--c-text-3)" }}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px]" style={{ color: "var(--c-text-3)" }}>
        {user}
      </span>
      <button
        onClick={logout}
        className="px-2 py-1 rounded text-[12px] hover:bg-[var(--c-bg-tertiary)]"
        style={{ color: "var(--c-text-3)" }}
        title="Sign out"
      >
        Sign out
      </button>
    </div>
  );
}

function AuthedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-screen text-[13px]"
        style={{ background: "var(--c-bg)", color: "var(--c-text-3)" }}
      >
        Loading…
      </div>
    );
  }

  if (!user) return <LoginView />;

  return (
    <AgentProvider>
      <ChatProvider>
        <div className="flex flex-col h-screen" style={{ background: "var(--c-bg)" }}>
          <NavBar />
          <div className="flex-1 min-h-0">
            <Routes>
              <Route path="/" element={<ChatView />} />
              <Route path="/runs" element={<RunsView />} />
              <Route path="/runs/:runId" element={<RunDetailView />} />
              <Route path="/feedback" element={<FeedbackView />} />
              <Route path="/tests" element={<RegressionView />} />
              <Route path="/playground" element={<PlaygroundView />} />
            </Routes>
          </div>
        </div>
      </ChatProvider>
    </AgentProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthedApp />
    </AuthProvider>
  );
}
