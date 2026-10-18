import { Link, useNavigate } from 'react-router-dom';
import { Bot, ArrowLeft } from 'lucide-react';

/* ============================================================
   Terms, privacy & acceptable use.
   A PUBLIC page (no login required) so it can be linked from the
   sign-in and create-a-club screens as well as from Settings.
   ============================================================ */
export default function Terms() {
  const nav = useNavigate();
  return (
    <div className="legal">
      <header className="legal-top">
        <div className="login-brand" style={{ margin: 0 }}>
          <div className="mark"><Bot size={18} /></div>
          <div>
            <h1>Robotics Club Platform</h1>
            <p>Terms, privacy &amp; acceptable use</p>
          </div>
        </div>
        <button className="btn secondary sm" onClick={() => nav(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
      </header>

      <p className="legal-meta">Last updated 18 October 2026</p>

      <p>
        This platform hosts robotics clubs. Each club is a separate, self-contained
        space: its members, departments, posts, files and meetings are visible only
        inside that club. By signing in — or by creating a club — you agree to the
        terms below.
      </p>

      <h2>1. Who may use the platform</h2>
      <ul>
        <li>Anyone may <strong>create a club</strong>; the founder becomes that club’s first <strong>Supervisor</strong>.</li>
        <li>Accounts <strong>inside</strong> a club are created by its leadership chain (Supervisor → Leader → Co-Leader → department managers), not by open public sign-up.</li>
        <li>You must use your own identity and keep your password private. You are responsible for activity under your account.</li>
      </ul>

      <h2>2. Roles and permissions</h2>
      <p>
        What you can see and change depends on your role and department. Permissions are
        enforced on the server, not only in the interface. Leaders, managers and
        supervisors act on behalf of the club and must use their powers fairly.
      </p>

      <h2>3. Content you post</h2>
      <ul>
        <li>You keep ownership of the posts, pictures, videos and comments you upload, and you confirm you have the right to share them.</li>
        <li>Content posted to a department’s public page or shared to the club feed is visible to that club’s members (and, where a page is public, to guests).</li>
        <li>Club leadership may remove content or members that break these terms or the club’s own rules.</li>
      </ul>

      <h2>4. Meetings and chat</h2>
      <ul>
        <li>Meetings are created by club leadership. Joining a meeting needs the host’s acceptance; each meeting has its own chat.</li>
        <li>Video, when enabled, is provided by an external service (Jitsi). Do not record others without their consent.</li>
        <li>Messages are stored so participants can read the meeting or chat history.</li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You must not:</p>
      <ul>
        <li>upload malware, or files that are illegal or infringe someone else’s rights;</li>
        <li>harass, threaten or impersonate others, or post hateful or explicit content;</li>
        <li>attempt to access another club’s data, another member’s account, or any part of the platform you are not permitted to see;</li>
        <li>probe, overload, scrape or otherwise disrupt the service.</li>
      </ul>
      <p>Accounts that break these rules may be suspended, and content may be removed.</p>

      <h2>6. Privacy — what the platform stores</h2>
      <ul>
        <li><strong>Account data:</strong> your name, email, role, department and club membership. Passwords are stored only as a one-way hash (bcrypt) — never in plain text.</li>
        <li><strong>Club content:</strong> the posts, comments, reactions, tasks, events, files, chat messages and meeting records you and your club create.</li>
        <li><strong>Uploads:</strong> images and files are stored on the deployment’s storage (local disk or a cloud blob store). Private album and chat files are served through short-lived signed links rather than public URLs.</li>
        <li><strong>Session:</strong> a signed token is kept in your browser’s local storage so you stay signed in. Appearance preferences (light/dark) are kept the same way.</li>
      </ul>
      <p>
        Your data stays inside your club. It is not sold, and it is not shared with other
        clubs. Club leadership and the platform operator may access club data to run and
        maintain the service.
      </p>

      <h2>7. Security</h2>
      <p>
        We work to protect the platform (hashed passwords, server-side permission checks,
        club-scoped queries, signed private links), but no system is perfectly secure.
        Report a suspected problem to the club’s operator rather than exploiting it.
      </p>

      <h2>8. Availability and backups</h2>
      <p>
        The service is provided “as is”, without warranty. It may be unavailable during
        maintenance. Backups, where configured, are the operator’s responsibility — keep
        your own copies of anything important.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>
        These terms may be updated as the platform evolves. Continued use after an update
        means you accept the new version.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these terms, your data, or a club should go to that club’s
        Supervisor or to the platform operator who runs this deployment.
      </p>

      <p className="legal-foot">
        <Link to="/login">Sign in</Link> · <Link to="/signup">Create a club</Link>
      </p>
    </div>
  );
}
