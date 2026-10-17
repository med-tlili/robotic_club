import { useEffect, useState } from 'react';
import {
  ClipboardList, ShieldAlert, CalendarCheck, Plus, Trash2, CheckCircle2,
  Circle, Loader, Upload, Share2, Plane, Palette, Package,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api, BASE } from '../api';
import { shrinkImage } from '../compress';
import { ToolBlock, Skeleton, Avatar } from './ui';

const isBoss = (role) => ['leader', 'coleader'].includes(role);
const canManage = (user, deptId) => isBoss(user.role)
  || (user.role === 'manager' && user.department_id === deptId);

const fmtTND = (n) => `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} TND`;

/* ============================================================
   HR tools — attendance · meeting conclusions · rule-break alerts
   ============================================================ */
export function HrTools({ dept }) {
  const { user } = useAuth();
  const manage = canManage(user, dept.id);
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState('attendance');
  return (
    <>
      <div className="ws-tabs">
        {[
          ['attendance', 'Attendance', CalendarCheck],
          ['notes', 'Conclusions', ClipboardList],
          ['alerts', 'Alerts', ShieldAlert],
        ].map(([key, label, Icon]) => (
          <button key={key} className={`ws-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === 'attendance' && <AttendancePanel manage={manage} defaultDate={today} />}
      {tab === 'notes' && <NotesPanel manage={manage} />}
      {tab === 'alerts' && <AlertsPanel manage={manage} />}
    </>
  );
}

function AttendancePanel({ manage, defaultDate }) {
  const [date, setDate] = useState(defaultDate);
  const [rows, setRows] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    setDirty(false);
    api(`/hr/attendance?date=${date}`).then(setRows).catch((e) => { setError(e.message); setRows([]); });
  };
  useEffect(load, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = (user_id, status) => {
    setRows((prev) => prev.map((r) => (r.user_id === user_id ? { ...r, status } : r)));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api('/hr/attendance', {
        method: 'POST',
        body: {
          meeting_date: date,
          entries: rows.filter((r) => r.status).map((r) => ({ user_id: r.user_id, status: r.status, notes: r.notes })),
        },
      });
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (error && rows === null) return <div className="banner error">{error}</div>;
  if (rows === null) return <Skeleton h={160} />;

  const counts = {
    present: rows.filter((r) => r.status === 'present').length,
    late: rows.filter((r) => r.status === 'late').length,
    absent: rows.filter((r) => r.status === 'absent').length,
  };

  return (
    <ToolBlock
      label="Attendance"
      sub={`${counts.present} present · ${counts.late} late · ${counts.absent} absent`}
      action={manage && dirty ? (
        <button className="btn sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      ) : null}
    >
      <div className="field" style={{ maxWidth: 200, marginBottom: 12 }}>
        <label htmlFor="att-date">Meeting date</label>
        <input id="att-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {error && <div className="banner error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="list">
        {rows.map((r) => (
          <div key={r.user_id} className="list-row" style={{ padding: '8px 0' }}>
            <Avatar user={{ full_name: r.full_name }} size={26} />
            <div className="grow"><div className="name">{r.full_name}</div></div>
            {manage ? (
              <div className="row" style={{ gap: 4 }}>
                {['present', 'late', 'absent'].map((s) => (
                  <button
                    key={s}
                    className={`att-btn ${s} ${r.status === s ? 'on' : ''}`}
                    onClick={() => setStatus(r.user_id, s)}
                  >{s[0].toUpperCase() + s.slice(1)}</button>
                ))}
              </div>
            ) : (
              <span className={`badge ${r.status === 'present' ? 'success' : r.status === 'late' ? 'accent' : r.status === 'absent' ? 'danger' : 'neutral'}`}>
                {r.status || '—'}
              </span>
            )}
          </div>
        ))}
      </div>
      {!manage && <div className="text-faint text-xs" style={{ marginTop: 8 }}>Only the HR manager or leaders can mark attendance.</div>}
    </ToolBlock>
  );
}

function NotesPanel({ manage }) {
  const [notes, setNotes] = useState(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mdate, setMdate] = useState('');
  const [error, setError] = useState('');

  const load = () => api('/hr/notes').then(setNotes).catch(() => setNotes([]));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/hr/notes', { method: 'POST', body: { title, body, meeting_date: mdate } });
      setTitle(''); setBody(''); setMdate(''); setComposing(false); load();
    } catch (err) { setError(err.message); }
  };

  if (notes === null) return <Skeleton h={140} />;
  return (
    <ToolBlock label="Meeting conclusions" sub={`${notes.length} recorded`}
      action={manage && !composing ? <button className="btn sm" onClick={() => setComposing(true)}><Plus size={13} /> New</button> : null}>
      {composing && (
        <form className="task-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="field"><label htmlFor="n-title">Title</label>
            <input id="n-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div className="field"><label htmlFor="n-date">Meeting date (optional)</label>
            <input id="n-date" className="input" type="date" value={mdate} onChange={(e) => setMdate(e.target.value)} /></div>
          <div className="field"><label htmlFor="n-body">Conclusions</label>
            <textarea id="n-body" className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setComposing(false)}>Cancel</button>
            <button type="submit" className="btn" disabled={!title.trim()}>Save</button>
          </div>
        </form>
      )}
      {notes.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>No conclusions recorded yet. Log what was decided in each meeting.</p>
      ) : (
        <div className="list">
          {notes.map((n) => (
            <div key={n.id} className="list-row" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
              <ClipboardList size={15} className="text-faint" style={{ marginTop: 3 }} />
              <div className="grow">
                <div className="name">{n.title}</div>
                {n.body && <div className="text-sm text-dim" style={{ whiteSpace: 'pre-wrap', marginTop: 3 }}>{n.body}</div>}
                <div className="meta">{n.meeting_date ? `${n.meeting_date} · ` : ''}{n.author}</div>
              </div>
              {manage && (
                <button className="icon-btn" title="Delete" aria-label="Delete conclusion" onClick={() => { if (window.confirm('Delete this conclusion?')) { api(`/hr/notes/${n.id}`, { method: 'DELETE' }).then(load); } }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToolBlock>
  );
}

function AlertsPanel({ manage }) {
  const [alerts, setAlerts] = useState(null);
  const [members, setMembers] = useState([]);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ user_id: '', title: '', description: '', severity: 'minor' });
  const [error, setError] = useState('');

  const load = () => api('/hr/alerts').then(setAlerts).catch(() => setAlerts([]));
  useEffect(() => {
    load();
    api('/users').then((all) => setMembers(all.filter((m) => ['manager', 'member'].includes(m.role)))).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/hr/alerts', { method: 'POST', body: form });
      setForm({ user_id: '', title: '', description: '', severity: 'minor' });
      setComposing(false); load();
    } catch (err) { setError(err.message); }
  };

  if (alerts === null) return <Skeleton h={140} />;
  const sevCls = { minor: 'neutral', major: 'accent', critical: 'danger' };
  return (
    <ToolBlock label="Rule-break alerts" sub={`${alerts.length} on record`}
      action={manage && !composing ? <button className="btn sm" onClick={() => setComposing(true)}><Plus size={13} /> New</button> : null}>
      {composing && (
        <form className="task-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="row" style={{ gap: 10 }}>
            <div className="field grow"><label htmlFor="a-member">Member</label>
              <select id="a-member" className="select" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
                <option value="">—</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select></div>
            <div className="field grow"><label htmlFor="a-sev">Severity</label>
              <select id="a-sev" className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
              </select></div>
          </div>
          <div className="field"><label htmlFor="a-title">Title</label>
            <input id="a-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
          <div className="field"><label htmlFor="a-desc">Details</label>
            <textarea id="a-desc" className="textarea" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setComposing(false)}>Cancel</button>
            <button type="submit" className="btn" disabled={!form.title.trim()}>Record</button>
          </div>
        </form>
      )}
      {alerts.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>No rule breaks recorded. Log incidents here to keep a disciplinary trail.</p>
      ) : (
        <div className="list">
          {alerts.map((a) => (
            <div key={a.id} className="list-row" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
              <ShieldAlert size={15} className="text-faint" style={{ marginTop: 3 }} />
              <div className="grow">
                <div className="name">{a.title} {a.member && <span className="text-faint text-xs">— {a.member}</span>}</div>
                {a.description && <div className="text-sm text-dim" style={{ marginTop: 2 }}>{a.description}</div>}
                <div className="meta">{a.reporter} · {a.created_at?.slice(0, 10)}</div>
              </div>
              <span className={`badge ${sevCls[a.severity] || 'neutral'}`}>{a.severity}</span>
              {manage && (
                <button className="icon-btn" title="Delete" aria-label="Delete alert" onClick={() => { if (window.confirm('Delete this alert?')) { api(`/hr/alerts/${a.id}`, { method: 'DELETE' }).then(load); } }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToolBlock>
  );
}

/* ============================================================
   Media tools — private albums + upload + share to public feed
   ============================================================ */
export function MediaTools({ dept }) {
  const { user } = useAuth();
  const manage = canManage(user, dept.id);
  const [albums, setAlbums] = useState(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');
  const [uploadFor, setUploadFor] = useState(null);

  const load = () => api('/media/albums').then(setAlbums).catch((e) => { setError(e.message); setAlbums([]); });
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/media/albums', { method: 'POST', body: { title, description: desc } });
      setTitle(''); setDesc(''); setComposing(false); load();
    } catch (err) { setError(err.message); }
  };

  if (error && albums === null) return <div className="banner error">{error}</div>;
  if (albums === null) return <Skeleton h={160} />;

  return (
    <ToolBlock label="Media albums" sub={`${albums.length} ${albums.length === 1 ? 'album' : 'albums'} · private to the team`}
      action={manage && !composing ? <button className="btn sm" onClick={() => setComposing(true)}><Plus size={13} /> New album</button> : null}>
      {composing && (
        <form className="task-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="field"><label htmlFor="al-title">Album title</label>
            <input id="al-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div className="field"><label htmlFor="al-desc">Description</label>
            <input id="al-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setComposing(false)}>Cancel</button>
            <button type="submit" className="btn" disabled={!title.trim()}>Create</button>
          </div>
        </form>
      )}
      {albums.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>No albums yet. Albums are private to the Media team — share pictures to the public feed when ready.</p>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {albums.map((a) => (
            <div key={a.id} className="album">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="name">{a.title}</div>
                  {a.description && <div className="text-sm text-dim">{a.description}</div>}
                </div>
                {manage && (
                  <button className="btn secondary sm" onClick={() => setUploadFor(uploadFor === a.id ? null : a.id)}>
                    <Upload size={13} /> Add picture
                  </button>
                )}
              </div>
              {uploadFor === a.id && <AlbumUpload albumId={a.id} onDone={() => { setUploadFor(null); load(); }} />}
              {a.media.length === 0 ? (
                <div className="text-faint text-xs" style={{ marginTop: 8 }}>No pictures yet.</div>
              ) : (
                <div className="album-grid">
                  {a.media.map((m) => (
                    <div key={m.id} className="album-item">
                      <img src={`${BASE}${m.thumb_path || m.file_path}`} alt={m.caption || a.title} />
                      <div className="album-cap">{m.caption || '—'}</div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        {m.shared_post_id ? (
                          <span className="badge success"><Share2 size={11} /> Shared</span>
                        ) : manage ? (
                          <button className="btn secondary sm" title="Share to the public department feed"
                            onClick={() => api(`/media/media/${m.id}/share`, { method: 'POST', body: {} }).then(load).catch((e) => alert(e.message))}>
                            <Share2 size={12} /> Share
                          </button>
                        ) : null}
                        {manage && (
                          <button className="icon-btn" title="Delete" aria-label="Delete picture"
                            onClick={() => { if (window.confirm('Delete this picture?')) { api(`/media/media/${m.id}`, { method: 'DELETE' }).then(load); } }}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </ToolBlock>
  );
}

function AlbumUpload({ albumId, onDone }) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useState(() => ({ current: null }))[0];

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Choose an image'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', await shrinkImage(file));
      fd.append('caption', caption);
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/api/media/albums/${albumId}/media`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setFile(null); setCaption('');
      if (inputRef.current) inputRef.current.value = '';
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="task-form" onSubmit={submit} style={{ marginTop: 8 }}>
      {error && <div className="banner error">{error}</div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <input ref={inputRef} type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <input className="input grow" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
    </form>
  );
}

/* ============================================================
   Events tools — itineraries + decoration planning
   ============================================================ */
export function EventsTools({ dept }) {
  const { user } = useAuth();
  const manage = canManage(user, dept.id);
  const [tab, setTab] = useState('itinerary');
  return (
    <>
      <div className="ws-tabs">
        {[['itinerary', 'Itinerary', Plane], ['decoration', 'Decoration', Palette]].map(([k, label, Icon]) => (
          <button key={k} className={`ws-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === 'itinerary' && <ItineraryPanel manage={manage} />}
      {tab === 'decoration' && <DecorationPanel manage={manage} />}
    </>
  );
}

function ItineraryPanel({ manage }) {
  const [items, setItems] = useState(null);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', event_date: '', steps: '' });
  const [error, setError] = useState('');
  const load = () => api('/plans/itineraries').then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    try { await api('/plans/itineraries', { method: 'POST', body: form }); setForm({ title: '', event_date: '', steps: '' }); setComposing(false); load(); }
    catch (err) { setError(err.message); }
  };
  if (items === null) return <Skeleton h={140} />;
  return (
    <ToolBlock label="Itineraries & journeys" sub={`${items.length} planned`}
      action={manage && !composing ? <button className="btn sm" onClick={() => setComposing(true)}><Plus size={13} /> New</button> : null}>
      {composing && (
        <form className="task-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="row" style={{ gap: 10 }}>
            <div className="field grow"><label htmlFor="i-title">Title</label>
              <input id="i-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
            <div className="field grow"><label htmlFor="i-date">Date</label>
              <input id="i-date" className="input" type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="i-steps">Steps (one per line)</label>
            <textarea id="i-steps" className="textarea" rows={3} value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} placeholder={'07:00 Meet at the club\n09:00 Departure'} /></div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setComposing(false)}>Cancel</button>
            <button type="submit" className="btn" disabled={!form.title.trim()}>Save</button>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>No itineraries yet. Plan the journey and schedule for each event.</p>
      ) : (
        <div className="list">
          {items.map((it) => (
            <div key={it.id} className="list-row" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
              <Plane size={15} className="text-faint" style={{ marginTop: 3 }} />
              <div className="grow">
                <div className="name">{it.title} {it.event_date && <span className="text-faint text-xs">· {it.event_date}</span>}</div>
                {it.steps && (
                  <ol className="text-sm text-dim" style={{ margin: '4px 0 0 18px' }}>
                    {it.steps.split('\n').filter(Boolean).map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                )}
                <div className="meta">{it.author}</div>
              </div>
              {manage && (
                <button className="icon-btn" title="Delete" aria-label="Delete itinerary" onClick={() => { if (window.confirm('Delete this itinerary?')) { api(`/plans/itineraries/${it.id}`, { method: 'DELETE' }).then(load); } }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToolBlock>
  );
}

function DecorationPanel({ manage }) {
  const [items, setItems] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const load = () => api('/plans/decorations').then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const add = async (e) => {
    e.preventDefault(); setError('');
    try { await api('/plans/decorations', { method: 'POST', body: { title } }); setTitle(''); load(); }
    catch (err) { setError(err.message); }
  };
  const cycle = (it) => {
    const next = { todo: 'in_progress', in_progress: 'done', done: 'todo' }[it.status];
    api(`/plans/decorations/${it.id}`, { method: 'PATCH', body: { status: next } }).then(load);
  };
  if (items === null) return <Skeleton h={140} />;
  const meta = { todo: { label: 'To do', cls: 'neutral', Icon: Circle }, in_progress: { label: 'In progress', cls: 'accent', Icon: Loader }, done: { label: 'Done', cls: 'success', Icon: CheckCircle2 } };
  return (
    <ToolBlock label="Decoration" sub={`${items.filter((i) => i.status !== 'done').length} open`}>
      {manage && (
        <form className="row" style={{ gap: 8, marginBottom: 12 }} onSubmit={add}>
          <input className="input grow" placeholder="Add a decoration item…" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <button type="submit" className="btn" disabled={!title.trim()}><Plus size={14} /></button>
        </form>
      )}
      {error && <div className="banner error">{error}</div>}
      {items.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>Nothing planned yet. Track banners, stand setup and decoration tasks.</p>
      ) : (
        <div className="list">
          {items.map((it) => {
            const m = meta[it.status] || meta.todo;
            return (
              <div key={it.id} className="list-row" style={{ padding: '8px 0' }}>
                {manage ? (
                  <button className="task-check" onClick={() => cycle(it)} title="Click to advance status" aria-label={`Status of ${it.title}`}>
                    {it.status === 'done' ? <CheckCircle2 size={18} className="ok" /> : it.status === 'in_progress' ? <Loader size={18} /> : <Circle size={18} />}
                  </button>
                ) : (
                  <Palette size={15} className="text-faint" />
                )}
                <div className="grow"><div className={`name ${it.status === 'done' ? 'done-strike' : ''}`}>{it.title}</div></div>
                <span className={`badge ${m.cls}`}>{m.label}</span>
                {manage && (
                  <button className="icon-btn" title="Delete" aria-label="Delete item" onClick={() => { if (window.confirm('Delete this item?')) { api(`/plans/decorations/${it.id}`, { method: 'DELETE' }).then(load); } }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ToolBlock>
  );
}

/* ============================================================
   Finance tools — sponsor pipeline (table) + budget (ledger).
   Both are shown together as one money picture, not hidden
   behind tabs. Totals are computed from real rows only.
   ============================================================ */
const SPONSOR_STATUS = {
  lead: { cls: 'neutral', label: 'Lead' },
  contacted: { cls: 'neutral', label: 'Contacted' },
  negotiating: { cls: 'accent', label: 'Negotiating' },
  won: { cls: 'success', label: 'Won' },
  declined: { cls: 'danger', label: 'Declined' },
};
const STATUS_ORDER = ['lead', 'contacted', 'negotiating', 'won', 'declined'];

export function FinanceTools({ dept }) {
  const { user } = useAuth();
  const manage = canManage(user, dept.id);
  return (
    <>
      <SponsorsLedger manage={manage} />
      <BudgetLedger manage={manage} />
    </>
  );
}

function SponsorsLedger({ manage }) {
  const [items, setItems] = useState(null);
  const [composing, setComposing] = useState(false);
  const empty = {
    name: '', contact: '', value: '', notes: '', kind: 'money', details: '',
  };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const load = () => api('/finance/sponsors').then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    try { await api('/finance/sponsors', { method: 'POST', body: form }); setForm(empty); setComposing(false); load(); }
    catch (err) { setError(err.message); }
  };
  const setStatus = (it, status) => api(`/finance/sponsors/${it.id}`, { method: 'PATCH', body: { status } }).then(load);
  const remove = (it) => { if (window.confirm(`Remove ${it.name} from the pipeline?`)) api(`/finance/sponsors/${it.id}`, { method: 'DELETE' }).then(load); };

  if (items === null) return <Skeleton h={140} />;

  // money sponsors are summed in TND; goods are counted (they have no price)
  const won = items.filter((s) => s.status === 'won');
  const secured = won.filter((s) => s.kind !== 'goods').reduce((sum, s) => sum + (Number(s.value) || 0), 0);
  const goodsWon = won.filter((s) => s.kind === 'goods').length;
  const openCount = items.filter((s) => s.status !== 'won' && s.status !== 'declined').length;
  const summary = items.length === 0
    ? 'no sponsors tracked yet'
    : `${openCount} open · ${fmtTND(secured)} secured${goodsWon ? ` + ${goodsWon} goods ${goodsWon === 1 ? 'donation' : 'donations'}` : ''}`;

  return (
    <ToolBlock
      label="Sponsor pipeline"
      sub={summary}
      action={manage && !composing ? (
        <button className="btn sm" onClick={() => setComposing(true)}><Plus size={13} /> Add sponsor</button>
      ) : null}
    >
      {composing && (
        <form className="task-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="row" style={{ gap: 10 }}>
            <div className="field grow"><label htmlFor="sp-name">Sponsor</label>
              <input id="sp-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="field grow"><label htmlFor="sp-contact">Contact</label>
              <input id="sp-contact" className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
            <div className="field" style={{ width: 172 }}><label>Contribution</label>
              <div className="seg" role="group" aria-label="Contribution type">
                <button type="button" className={`seg-btn${form.kind === 'money' ? ' on' : ''}`}
                  onClick={() => setForm({ ...form, kind: 'money' })}>Money</button>
                <button type="button" className={`seg-btn${form.kind === 'goods' ? ' on' : ''}`}
                  onClick={() => setForm({ ...form, kind: 'goods' })}>Goods</button>
              </div></div>
          </div>
          {form.kind === 'money' ? (
            <div className="field" style={{ width: 172 }}><label htmlFor="sp-value">Amount (TND)</label>
              <input id="sp-value" className="input" type="number" min="0" step="0.01" value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })} required /></div>
          ) : (
            <div className="field"><label htmlFor="sp-details">What they give</label>
              <input id="sp-details" className="input"
                placeholder="e.g. 20 laptops · meals for the tournament · print & stand material…"
                value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} required /></div>
          )}
          <div className="field"><label htmlFor="sp-notes">Notes</label>
            <textarea id="sp-notes" className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setComposing(false)}>Cancel</button>
            <button type="submit" className="btn" disabled={!form.name.trim()
              || (form.kind === 'money' ? !(Number(form.value) > 0) : !form.details.trim())}>Add to pipeline</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          No sponsors tracked yet. Add a sponsor here when you start talks — move it from lead to won as it progresses.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table ledger">
            <thead>
              <tr>
                <th>Sponsor</th>
                <th>Contribution</th>
                <th>Status</th>
                {manage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const st = SPONSOR_STATUS[it.status] || SPONSOR_STATUS.lead;
                return (
                  <tr key={it.id}>
                    <td>
                      <div className="who">{it.name}</div>
                      {(it.contact || it.notes) && <div className="sub">{[it.contact, it.notes].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td>
                      {it.kind === 'goods' ? (
                        <span className="goods-tag"><Package size={12} /> {it.details || 'goods'}</span>
                      ) : (
                        <span className="mono amount">{it.value ? fmtTND(it.value) : <span className="text-faint">—</span>}</span>
                      )}
                    </td>
                    <td>
                      {manage ? (
                        <select className="select status-select" value={it.status} onChange={(e) => setStatus(it, e.target.value)} aria-label={`Status of ${it.name}`}>
                          {STATUS_ORDER.map((s) => <option key={s} value={s}>{SPONSOR_STATUS[s].label}</option>)}
                        </select>
                      ) : (
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      )}
                    </td>
                    {manage && (
                      <td className="ta-r">
                        <button className="icon-btn" title={`Remove ${it.name}`} aria-label={`Remove ${it.name}`} onClick={() => remove(it)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ToolBlock>
  );
}

function BudgetLedger({ manage }) {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('expense');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [error, setError] = useState('');
  const load = () => api('/finance/budget').then(setData).catch(() => setData({ entries: [], income: 0, expense: 0, balance: 0 }));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/finance/budget', { method: 'POST', body: { kind, label, amount, entry_date: entryDate } });
      setLabel(''); setAmount(''); setEntryDate(''); load();
    } catch (err) { setError(err.message); }
  };
  const remove = (e) => { if (window.confirm(`Delete "${e.label}"?`)) api(`/finance/budget/${e.id}`, { method: 'DELETE' }).then(load); };

  if (data === null) return <Skeleton h={140} />;

  return (
    <ToolBlock
      label="Budget"
      sub={`${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`}
      action={manage ? (
        <span className="ws-sub">record income & expenses below</span>
      ) : null}
    >
      <div className="strip" style={{ marginBottom: 14 }}>
        <div className="pair"><span className="k">Income</span><span className="v pos num">{fmtTND(data.income)}</span></div>
        <div className="strip-sep" />
        <div className="pair"><span className="k">Expense</span><span className="v num">{fmtTND(data.expense)}</span></div>
        <div className="strip-sep" />
        <div className="pair"><span className="k">Balance</span><span className={`v num ${data.balance >= 0 ? 'pos' : 'neg'}`}>{fmtTND(data.balance)}</span></div>
      </div>

      {manage && (
        <form className="add-row" onSubmit={submit}>
          <div className="field"><label htmlFor="b-kind">Kind</label>
            <select id="b-kind" className="select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select></div>
          <div className="field grow"><label htmlFor="b-label">Label</label>
            <input id="b-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. T-shirt printing" required /></div>
          <div className="field" style={{ width: 120 }}><label htmlFor="b-amount">Amount (TND)</label>
            <input id="b-amount" className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
          <div className="field" style={{ width: 150 }}><label htmlFor="b-date">Date</label>
            <input id="b-date" className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
          <button className="btn" type="submit" disabled={!label.trim() || !amount}><Plus size={14} /> Add</button>
        </form>
      )}
      {error && <div className="banner error" style={{ marginBottom: 10 }}>{error}</div>}

      {data.entries.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          No entries yet. Every confirmed sponsorship and purchase is recorded here so the balance stays accurate.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table ledger">
            <thead>
              <tr>
                <th>Date</th>
                <th>Label</th>
                <th className="ta-r">Amount</th>
                {manage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono sub">{e.entry_date || '—'}</td>
                  <td>
                    <div className="who">{e.label}</div>
                    {e.author && <div className="sub">{e.author}</div>}
                  </td>
                  <td className={`ta-r mono amount ${e.kind === 'income' ? 'pos' : ''}`}>
                    {e.kind === 'income' ? '+' : '−'}{fmtTND(e.amount)}
                  </td>
                  {manage && (
                    <td className="ta-r">
                      <button className="icon-btn" title={`Delete ${e.label}`} aria-label={`Delete ${e.label}`} onClick={() => remove(e)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ToolBlock>
  );
}
