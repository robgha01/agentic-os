/**
 * Device-code sign-in overlay — the "finish login" prompt (e.g. Outlook). Shows
 * the verification URL and the code; dismisses itself when auth resolves.
 */
import type { AuthPromptView } from "../useGateway.js";

export function AuthPrompt({ auth }: { auth: AuthPromptView }) {
  return (
    <div className="overlay">
      <div className="authcard">
        <div className="authcard__eyebrow">sign-in required · {auth.service}</div>
        <p className="authcard__msg">Finish signing in to connect your account.</p>
        <ol className="authcard__steps">
          <li>
            Open{" "}
            <a href={auth.verificationUri} target="_blank" rel="noreferrer">
              {auth.verificationUri}
            </a>
          </li>
          <li>Enter this code:</li>
        </ol>
        <div className="authcard__code">{auth.userCode}</div>
        <div className="authcard__wait">waiting for sign-in…</div>
      </div>
    </div>
  );
}
