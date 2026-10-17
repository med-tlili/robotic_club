import { useEffect, useState } from 'react';
import {
  Megaphone, ThumbsUp, ThumbsDown, MessageSquare, Trash2,
  Plus, Send, Eye, Lock, Users, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api, getToken, BASE } from '../api';
import { Avatar, EmptyState, Skeleton, RolePill } from './ui';

const TYPE_META = {
  announcement: { label: 'Announcement', cls: 'accent' },
  clip: { label: 'Clip', cls: 'success' },
  offer: { label: 'Sponsor offer', cls: 'warning' },
};

const timeAgo = (iso) => {
  const diff = (Date.now() - new Date(iso + 'Z').getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
};

/* ============================================================
   Public department feed — posts, Yes/No votes, comments.
   Rendered as a labeled section with a compact, expandable
   list so the page reads as a feed, not a wall of cards.
   ============================================================ */
export default function PostFeed({ dept }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);

  const boss = ['leader', 'coleader'].includes(user.role);
  const inDept = user.department_id === dept.id;
  const canPost = boss || (inDept && ['manager', 'member'].includes(user.role));
  // the professor votes with the club — posting & commenting stay read-only
  const canVote = user.role !== 'guest';
  const canComment = user.role !== 'guest' && user.role !== 'professor';

  const load = () => {
    api(`/posts?department_id=${dept.id}`).then(setPosts).catch((e) => { setError(e.message); setPosts([]); });
  };
  useEffect(load, [dept.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const newLabel = dept.slug === 'media' ? 'New clip' : dept.slug === 'finance' ? 'New sponsor offer' : 'New announcement';

  if (error) return <div className="banner error">{error}</div>;
  if (posts === null) return <Skeleton h={180} />;

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow public"><span className="dot" />{dept.slug === 'finance' ? 'Sponsor offers' : 'Announcements'} · public</span>
        {canPost && !composing && (
          <button className="btn sm" onClick={() => setComposing(true)}>
            <Plus size={13} /> {newLabel}
          </button>
        )}
      </div>

      {!canPost && (
        <div className="text-dim text-sm row" style={{ gap: 6, marginBottom: 4 }}>
          <Eye size={14} />
          {user.role === 'guest'
            ? 'Guests can read announcements but not vote or comment.'
            : user.role === 'professor'
              ? 'Supervisor view — you can vote with the club, but not post or comment.'
              : 'Only club members can post, vote and comment.'}
        </div>
      )}

      {composing && (
        <Composer dept={dept} onDone={() => { setComposing(false); load(); }} onCancel={() => setComposing(false)} />
      )}

      {posts.length === 0 ? (
        <div className="panel"><div className="panel-body">
          <EmptyState
            icon={Megaphone}
            title="Nothing published yet"
            text={canPost
              ? `Create the first ${dept.slug === 'finance' ? 'sponsor offer' : 'post'} — the club will vote and comment on it here.`
              : 'Announcements from this department appear here.'}
          />
        </div></div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} canVote={canVote} canComment={canComment} onChanged={load} onDeleted={load} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- vote tally: proportion bar + transparent who-voted ---------- */
function VoteBar({ post, canVote, onVote }) {
  const total = post.yes + post.no;
  const yPct = total === 0 ? 0 : (post.yes / total) * 100;
  const nPct = total === 0 ? 0 : (post.no / total) * 100;
  return (
    <div className="votebar">
      <div className="vote-btns">
        <button
          className={`vote-btn ${post.my_vote === 'yes' ? 'voted-yes' : ''}`}
          onClick={() => onVote('yes')}
          disabled={!canVote}
          title={canVote ? 'Vote Yes (click again to remove)' : 'Guests cannot vote'}
        >
          <ThumbsUp size={14} /> Yes
        </button>
        <button
          className={`vote-btn ${post.my_vote === 'no' ? 'voted-no' : ''}`}
          onClick={() => onVote('no')}
          disabled={!canVote}
          title={canVote ? 'Vote No (click again to remove)' : 'Guests cannot vote'}
        >
          <ThumbsDown size={14} /> No
        </button>
      </div>
      <div className="vote-tally">
        <div className="vote-track" role="img" aria-label={`${post.yes} yes, ${post.no} no`}>
          {total === 0
            ? <div className="none" />
            : <><div className="y" style={{ width: `${yPct}%` }} /><div className="n" style={{ width: `${nPct}%` }} /></>}
        </div>
        <div className="vote-counts">
          <span className={`c ${total ? 'yes' : ''}`}>Yes {post.yes}</span>
          <span className={`c ${total ? 'no' : ''}`}>No {post.no}</span>
          {total === 0 && <span className="c">No votes yet</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------- single post: compact header + body + vote + collapsible thread ---------- */
function PostCard({ post, canVote, canComment, onChanged, onDeleted }) {
  const [thread, setThread] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const meta = TYPE_META[post.type] || TYPE_META.announcement;

  const vote = async (value) => {
    try {
      await api(`/posts/${post.id}/vote`, { method: 'POST', body: { value } });
      onChanged();
    } catch (e) { alert(e.message); }
  };

  const sendComment = async (e) => {
    e.preventDefault();
    if (!comment.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/posts/${post.id}/comments`, { method: 'POST', body: { body: comment } });
      setComment('');
      onChanged();
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('Delete this post? Votes and comments will be removed too.')) return;
    try { await api(`/posts/${post.id}`, { method: 'DELETE' }); onDeleted(); }
    catch (e) { alert(e.message); }
  };

  const yesNames = post.voters.filter((v) => v.value === 'yes').map((v) => v.full_name);
  const noNames = post.voters.filter((v) => v.value === 'no').map((v) => v.full_name);
  const voterCount = yesNames.length + noNames.length;
  const nComments = post.comments.length;

  return (
    <article className="panel post post-compact">
      <div className="post-head">
        <Avatar user={post.author} size="sm" />
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{post.author.full_name}</strong>
            <RolePill role={post.author.role} />
          </div>
          <div className="text-faint text-xs">{timeAgo(post.created_at)}</div>
        </div>
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
        {post.can_delete && (
          <button className="icon-btn" title="Delete post" aria-label="Delete post" onClick={remove}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <h3 className="post-title">{post.title}</h3>
      {post.body && <p className="post-body">{post.body}</p>}
      {post.image && <img className="post-image" src={`${BASE}${post.image}`} alt="" />}

      <VoteBar post={post} canVote={canVote} onVote={vote} />

      {voterCount > 0 && (
        <button className={`thread-toggle ${showNames ? 'on' : ''}`} onClick={() => setShowNames(!showNames)}>
          <Users size={13} /> {voterCount} {voterCount === 1 ? 'vote' : 'votes'} · who voted
          {showNames ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      )}
      {showNames && (
        <div className="vote-detail text-xs" style={{ marginTop: 4 }}>
          {yesNames.length > 0 && <div className="yes-names">👍 {yesNames.join(', ')}</div>}
          {noNames.length > 0 && <div className="no-names">👎 {noNames.join(', ')}</div>}
        </div>
      )}

      <div className="post-comments">
        <button className={`thread-toggle ${thread ? 'on' : ''}`} onClick={() => setThread(!thread)}>
          <MessageSquare size={13} /> {nComments} {nComments === 1 ? 'comment' : 'comments'}
          {canComment && (thread ? ' · hide' : ' · discuss')}
          {thread ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {thread && (
          <>
            {post.comments.map((c) => (
              <div key={c.id} className="comment">
                <Avatar user={{ full_name: c.full_name, role: c.role }} size="sm" />
                <div className="grow">
                  <div className="text-xs"><strong>{c.full_name}</strong> <span className="text-faint">{timeAgo(c.created_at)}</span></div>
                  <div className="text-sm">{c.body}</div>
                </div>
              </div>
            ))}
            {canComment ? (
              <form className="comment-form" onSubmit={sendComment}>
                <input
                  className="input"
                  placeholder="Write a comment…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  aria-label="Write a comment"
                />
                <button className="btn sm" type="submit" disabled={busy || !comment.trim()} aria-label="Send comment">
                  <Send size={13} />
                </button>
              </form>
            ) : (
              <div className="text-xs text-faint row" style={{ gap: 5 }}><Lock size={12} /> Read-only</div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

/* ---------- composer (multipart: text + optional image) ---------- */
function Composer({ dept, onDone, onCancel }) {
  const finance = dept.slug === 'finance';
  const media = dept.slug === 'media';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState(media ? 'clip' : finance ? 'offer' : 'announcement');
  const [image, setImage] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('department_id', dept.id);
      fd.append('title', title);
      fd.append('body', body);
      fd.append('type', type);
      if (image) fd.append('image', image);
      const res = await fetch(`${BASE}/api/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to publish');
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="panel composer" onSubmit={submit} style={{ marginBottom: 12 }}>
      <div className="panel-head"><h2>{finance ? 'New sponsor offer' : media ? 'New clip' : 'New announcement'}</h2></div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        {error && <div className="banner error">{error}</div>}
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow">
            <label htmlFor="post-type">Type</label>
            <select id="post-type" className="select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="announcement">Announcement</option>
              {media && <option value="clip">Clip for social media</option>}
              {finance && <option value="offer">Sponsor offer</option>}
            </select>
          </div>
          <div className="field grow">
            <label htmlFor="post-image">Image (optional)</label>
            <input id="post-image" className="input" type="file" accept="image/*"
              onChange={(e) => setImage(e.target.files[0] || null)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="post-title">Title</label>
          <input id="post-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={finance ? 'Sponsor — money or goods (e.g. TechCorp — 1500 TND for the season, or Delta Foods — meals for the tournament)' : 'Short, clear title'}
            required maxLength={140} />
        </div>
        <div className="field">
          <label htmlFor="post-body">Details</label>
          <textarea id="post-body" className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={finance
              ? 'What they get in return (logo on t-shirts, mentions…), duration, conditions.'
              : 'What should the club know?'} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !title.trim()}>
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </form>
  );
}
