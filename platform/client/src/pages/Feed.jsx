import { useEffect, useMemo, useState } from 'react';
import { Home, Plus } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { PostCard, Composer } from '../components/PostFeed';
import { EmptyState, Skeleton } from '../components/ui';

/* ============================================================
   Home — the club feed.
   Every department's posts in one newest-first timeline (the
   "everything the club posts" view). Posts still belong to a
   department, so the composer asks which one; each card links
   back to its department page.
   ============================================================ */
export default function Feed() {
  const { user } = useAuth();
  const [posts, setPosts] = useState(null);
  const [depts, setDepts] = useState([]);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(20);
  const [composing, setComposing] = useState(false);
  const [target, setTarget] = useState('');

  const canPost = user.role !== 'guest' && user.role !== 'supervisor';
  const canVote = user.role !== 'guest';
  const canComment = canPost;

  // departments the signed-in user may publish into (mirrors the API rule)
  const allowed = useMemo(() => {
    if (user.role === 'leader' || user.role === 'coleader') return depts.filter((d) => !d.coming_soon);
    if (user.role === 'manager' || user.role === 'member') return depts.filter((d) => d.id === user.department_id);
    return [];
  }, [depts, user.role, user.department_id]);

  const load = () => {
    api(`/posts/feed?limit=${limit}`)
      .then(setPosts)
      .catch((e) => { setError(e.message); setPosts([]); });
  };
  useEffect(load, [limit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api('/departments').then(setDepts).catch(() => {}); }, []);

  const targetDept = allowed.find((d) => String(d.id) === String(target)) || allowed[0];
  const maybeMore = Array.isArray(posts) && posts.length === limit;

  if (posts === null && !error) {
    return (
      <div className="stack">
        <Skeleton h={90} />
        <Skeleton h={220} />
        <Skeleton h={220} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <div className="sub">Everything the club posts, newest first</div>
        </div>
        {canPost && allowed.length > 0 && !composing && (
          <button className="btn" onClick={() => setComposing(true)}>
            <Plus size={15} /> New post
          </button>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}

      {!canPost && (
        <div className="banner info">
          {user.role === 'guest'
            ? 'Guests can read the feed but cannot post, vote or comment.'
            : 'Supervisor view — you can vote with the club, but posting and commenting stay read-only.'}
        </div>
      )}

      {composing && targetDept && (
        <div className="stack" style={{ gap: 10 }}>
          {allowed.length > 1 && (
            <div className="field" style={{ maxWidth: 300 }}>
              <label htmlFor="feed-dept">Post in</label>
              <select
                id="feed-dept" className="select" value={targetDept.id}
                onChange={(e) => setTarget(e.target.value)}
              >
                {allowed.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <Composer
            dept={targetDept}
            onDone={() => { setComposing(false); load(); }}
            onCancel={() => setComposing(false)}
          />
        </div>
      )}

      {posts.length === 0 ? (
        <div className="panel">
          <div className="panel-body">
            <EmptyState
              icon={Home}
              title="No posts yet"
              text={canPost
                ? 'Publish the first post — it will show here and on its department page.'
                : 'Posts from every department appear here.'}
            />
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {posts.map((p) => (
            <PostCard
              key={p.id} post={p}
              canVote={canVote} canComment={canComment}
              onChanged={load} onDeleted={load}
            />
          ))}
        </div>
      )}

      {maybeMore && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn ghost" onClick={() => setLimit((n) => n + 20)}>Load more</button>
        </div>
      )}
    </div>
  );
}
