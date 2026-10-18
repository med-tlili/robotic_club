import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Megaphone, ThumbsUp, ThumbsDown, HelpCircle, MessageSquare, Trash2,
  Plus, Send, Eye, Lock, Users, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api, getToken, BASE } from '../api';
import { shrinkImage } from '../compress';
import { Avatar, EmptyState, Skeleton, RolePill } from './ui';

// media kind of a post (phase 4): text | image | video | poll
const TYPE_META = {
  text: { label: 'Text', cls: 'accent' },
  image: { label: 'Photo', cls: 'success' },
  video: { label: 'Video', cls: 'success' },
  poll: { label: 'Poll', cls: 'warning' },
};

const timeAgo = (iso) => {
  const diff = (Date.now() - new Date(iso + 'Z').getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
};

/* ============================================================
   Public department feed — posts, Yes/No/Maybe reactions,
   polls and comments. Rendered as a labeled section with a
   compact, expandable list so the page reads as a feed.
   ============================================================ */
export default function PostFeed({ dept }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);

  const boss = ['leader', 'coleader'].includes(user.role);
  const inDept = user.department_id === dept.id;
  const canPost = boss || (inDept && ['manager', 'member'].includes(user.role));
  // the supervisor reacts with the club — posting & commenting stay read-only
  const canVote = user.role !== 'guest';
  const canComment = user.role !== 'guest' && user.role !== 'supervisor';

  const load = () => {
    api(`/posts?department_id=${dept.id}`).then(setPosts).catch((e) => { setError(e.message); setPosts([]); });
  };
  useEffect(load, [dept.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner error">{error}</div>;
  if (posts === null) return <Skeleton h={180} />;

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow public"><span className="dot" />{dept.name} posts · public</span>
        {canPost && !composing && (
          <button className="btn sm" onClick={() => setComposing(true)}>
            <Plus size={13} /> New post
          </button>
        )}
      </div>

      {!canPost && (
        <div className="text-dim text-sm row" style={{ gap: 6, marginBottom: 4 }}>
          <Eye size={14} />
          {user.role === 'guest'
            ? 'Guests can read posts but not react, vote or comment.'
            : user.role === 'supervisor'
              ? 'Supervisor view — you can react with the club, but not post or comment.'
              : 'Only club members can post, react, vote and comment.'}
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
              ? 'Create the first post — the club will react and comment on it here.'
              : 'Posts from this department appear here.'}
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

/* ---------- reaction tally: Yes / No / Maybe bar + transparent who-reacted ---------- */
function VoteBar({ post, canVote, onVote }) {
  const yes = post.yes || 0;
  const no = post.no || 0;
  const maybe = post.maybe || 0;
  const total = yes + no + maybe;
  const pct = (n) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <div className="votebar">
      <div className="vote-btns">
        <button
          className={`vote-btn ${post.my_vote === 'yes' ? 'voted-yes' : ''}`}
          onClick={() => onVote('yes')}
          disabled={!canVote}
          title={canVote ? 'Yes (click again to remove)' : 'Guests cannot react'}
        >
          <ThumbsUp size={14} /> Yes
        </button>
        <button
          className={`vote-btn ${post.my_vote === 'maybe' ? 'voted-maybe' : ''}`}
          onClick={() => onVote('maybe')}
          disabled={!canVote}
          title={canVote ? 'Maybe (click again to remove)' : 'Guests cannot react'}
        >
          <HelpCircle size={14} /> Maybe
        </button>
        <button
          className={`vote-btn ${post.my_vote === 'no' ? 'voted-no' : ''}`}
          onClick={() => onVote('no')}
          disabled={!canVote}
          title={canVote ? 'No (click again to remove)' : 'Guests cannot react'}
        >
          <ThumbsDown size={14} /> No
        </button>
      </div>
      <div className="vote-tally">
        <div className="vote-track" role="img" aria-label={`${yes} yes, ${maybe} maybe, ${no} no`}>
          {total === 0
            ? <div className="none" />
            : <><div className="y" style={{ width: `${pct(yes)}%` }} /><div className="m" style={{ width: `${pct(maybe)}%` }} /><div className="n" style={{ width: `${pct(no)}%` }} /></>}
        </div>
        <div className="vote-counts">
          <span className="c yes">Yes {yes}</span>
          <span className="c maybe">Maybe {maybe}</span>
          <span className="c no">No {no}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- poll: clickable options with live counts ---------- */
function Poll({ post, canVote, onChanged }) {
  const [busy, setBusy] = useState(false);
  const total = post.poll.total || 0;
  const cast = async (optionId) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/posts/${post.id}/poll-vote`, { method: 'POST', body: { option_id: optionId } });
      onChanged();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="poll">
      {post.poll.options.map((o) => {
        const pct = total === 0 ? 0 : Math.round((o.votes / total) * 100);
        const mine = post.poll.my_choice === o.id;
        return (
          <button
            key={o.id} type="button" className={`poll-opt ${mine ? 'mine' : ''}`}
            disabled={!canVote || busy} onClick={() => cast(o.id)}
            title={canVote ? (mine ? 'Click again to remove your vote' : 'Vote for this option') : 'Guests cannot vote'}
          >
            <span className="poll-fill" style={{ width: `${pct}%` }} />
            <span className="poll-label">{o.body}</span>
            <span className="poll-pct">{o.votes} · {pct}%</span>
          </button>
        );
      })}
      <div className="poll-foot">
        {total} {total === 1 ? 'vote' : 'votes'}
        {post.poll.my_choice ? ' · you voted (click again to undo)' : ''}
      </div>
    </div>
  );
}

/* ---------- single post: compact header + body + reactions + collapsible thread ---------- */
export function PostCard({ post, canVote, canComment, onChanged, onDeleted }) {
  const [thread, setThread] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const meta = TYPE_META[post.type] || TYPE_META.text;

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
    if (!window.confirm('Delete this post? Reactions and comments will be removed too.')) return;
    try { await api(`/posts/${post.id}`, { method: 'DELETE' }); onDeleted(); }
    catch (e) { alert(e.message); }
  };

  const names = (value) => post.voters.filter((v) => v.value === value).map((v) => v.full_name);
  const yesNames = names('yes');
  const noNames = names('no');
  const maybeNames = names('maybe');
  const voterCount = yesNames.length + noNames.length + maybeNames.length;
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
        {post.department && (
          <Link to={`/departments/${post.department.slug}`} className="badge neutral"
            title={`Posted in ${post.department.name}`}>
            {post.department.name}
          </Link>
        )}
        {post.can_delete && (
          <button className="icon-btn" title="Delete post" aria-label="Delete post" onClick={remove}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <h3 className="post-title">{post.title}</h3>
      {post.body && <p className="post-body">{post.body}</p>}
      {post.image && <img className="post-image" src={`${BASE}${post.image}`} alt="" />}
      {post.video && (
        <video className="post-video" src={`${BASE}${post.video}`} controls preload="metadata" />
      )}
      {post.poll && <Poll post={post} canVote={canVote} onChanged={onChanged} />}

      <VoteBar post={post} canVote={canVote} onVote={vote} />

      {voterCount > 0 && (
        <button className={`thread-toggle ${showNames ? 'on' : ''}`} onClick={() => setShowNames(!showNames)}>
          <Users size={13} /> {voterCount} {voterCount === 1 ? 'reaction' : 'reactions'} · who reacted
          {showNames ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      )}
      {showNames && (
        <div className="vote-detail text-xs" style={{ marginTop: 4 }}>
          {yesNames.length > 0 && <div className="yes-names">👍 Yes — {yesNames.join(', ')}</div>}
          {maybeNames.length > 0 && <div className="maybe-names">🤔 Maybe — {maybeNames.join(', ')}</div>}
          {noNames.length > 0 && <div className="no-names">👎 No — {noNames.join(', ')}</div>}
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

/* ---------- composer: text | image | video | poll (multipart) ---------- */
export function Composer({ dept, onDone, onCancel }) {
  const finance = dept.slug === 'finance';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('text');
  const [file, setFile] = useState(null);
  const [options, setOptions] = useState(['', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (type === 'image' && !file) return setError('Choose a png/jpg/gif/webp image');
    if (type === 'video' && !file) return setError('Choose an mp4/webm video');
    if (type === 'poll' && cleanOptions.length < 2) return setError('Add at least 2 poll options');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('department_id', dept.id);
      fd.append('type', type);
      fd.append('title', title);
      fd.append('body', body);
      if (type === 'poll') cleanOptions.forEach((o) => fd.append('options', o));
      if ((type === 'image' || type === 'video') && file) {
        fd.append('media', type === 'image' ? await shrinkImage(file) : file);
      }
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
      <div className="panel-head"><h2>New post</h2></div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        {error && <div className="banner error">{error}</div>}
        <div className="field">
          <label htmlFor="post-type">Type</label>
          <select id="post-type" className="select" value={type}
            onChange={(e) => { setType(e.target.value); setFile(null); }}>
            <option value="text">Text</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="poll">Poll</option>
          </select>
        </div>

        {(type === 'image' || type === 'video') && (
          <div className="field">
            <label htmlFor="post-media">{type === 'image' ? 'Image' : 'Video (mp4 / webm)'}</label>
            <input key={type} id="post-media" className="input" type="file"
              accept={type === 'image' ? 'image/*' : 'video/mp4,video/webm'}
              onChange={(e) => setFile(e.target.files[0] || null)} />
          </div>
        )}

        {type === 'poll' && (
          <div className="field">
            <label>Poll options</label>
            <div className="stack" style={{ gap: 6 }}>
              {options.map((o, i) => (
                <div key={i} className="row" style={{ gap: 6 }}>
                  <input className="input" value={o} placeholder={`Option ${i + 1}`}
                    onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
                  {options.length > 2 && (
                    <button type="button" className="icon-btn" aria-label="Remove option"
                      onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {options.length < 6 && (
                <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setOptions([...options, ''])}>
                  <Plus size={13} /> Add option
                </button>
              )}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="post-title">{type === 'poll' ? 'Question' : 'Title'}</label>
          <input id="post-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={finance ? 'Sponsor — money or goods (e.g. TechCorp — 1500 TND for the season)' : 'Short, clear title'}
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
