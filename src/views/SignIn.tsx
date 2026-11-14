import { Check, Copy, ExternalLink, LoaderCircle, LogIn, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "../components/common";
import { TitleBar } from "../components/TitleBar";
import { cancelSignIn, startSignIn } from "../lib/actions";
import { api } from "../lib/api";
import { useApp } from "../lib/store";

export function SignIn() {
  const { signIn } = useApp();
  const { code, error, busy, startedAt } = signIn;
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!code) return;
    const tick = () => setLeft(Math.max(0, Math.round(code.expiresIn - (Date.now() - startedAt) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [code, startedAt]);

  function copy() {
    if (!code) return;
    navigator.clipboard.writeText(code.userCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="app" style={{ gridTemplateRows: "36px 1fr" }}>
      <TitleBar minimal />
      <div className="auth">
        <div className="auth-card">
          <div className="head">
            <Logo size={52} />
            <h1>{code ? "Enter this code" : "Sign in with Xbox"}</h1>
            <p>
              {code
                ? "Approve the sign-in on Microsoft's page. This window carries on by itself once you're done."
                : "Squadr uses your Xbox account to browse, post and join Looking for Group, the same LFG you see on console."}
            </p>
          </div>

          {error && (
            <div className="banner" style={{ margin: 0 }}>
              <TriangleAlert size={16} color="var(--warn)" style={{ flex: "none" }} />
              <span style={{ color: "var(--text-2)" }}>{error}</span>
            </div>
          )}

          {code ? (
            <>
              <button className="code-box" onClick={copy} title="Copy code">
                {code.userCode.split("").map((c, i) => (
                  <span key={i}>{c}</span>
                ))}
              </button>
              <div className="code-meta">
                <button className="link" onClick={copy}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy code"}
                </button>
                <span>
                  Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                </span>
              </div>
              <button className="btn-white" onClick={() => api.openUrl(code.verificationUri)}>
                <ExternalLink size={15} /> Open {code.verificationUri.replace(/^https:\/\/(www\.)?/, "")}
              </button>
              <div className="waiting">
                <LoaderCircle size={15} className="spin" /> Waiting for you to approve…
              </div>
              <button className="btn-ghost" onClick={cancelSignIn}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn-white" onClick={startSignIn} disabled={busy}>
                {busy ? <LoaderCircle size={16} className="spin" /> : <LogIn size={15} />} Sign in
              </button>
              <div className="fine">
                You'll get a short code to enter at microsoft.com/link. Squadr never sees your password, and your sign-in stays encrypted on this PC.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
