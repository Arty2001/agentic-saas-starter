import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";

export default function LoginView() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    background: "var(--c-bg)",
    borderColor: "var(--c-border)",
    color: "var(--c-text-1)",
  };

  return (
    <div
      className="flex items-center justify-center h-screen"
      style={{ background: "var(--c-bg)" }}
    >
      <form
        onSubmit={onSubmit}
        className="w-80 p-6 rounded-lg border flex flex-col gap-3"
        style={{ background: "var(--c-bg)", borderColor: "var(--c-border)" }}
      >
        <h1
          className="text-base font-semibold mb-1"
          style={{ color: "var(--c-text-1)" }}
        >
          Sign in
        </h1>
        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="px-3 py-2 rounded border text-[13px] focus:outline-none"
          style={inputStyle}
          required
          disabled={submitting}
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-3 py-2 rounded border text-[13px] focus:outline-none"
          style={inputStyle}
          required
          disabled={submitting}
        />
        {error && (
          <div
            role="alert"
            className="text-[12px]"
            style={{ color: "#dc2626" }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="px-3 py-2 rounded text-[13px] font-medium disabled:opacity-50"
          style={{ background: "var(--color-brand)", color: "white" }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
