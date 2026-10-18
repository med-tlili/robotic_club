import { useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalIcon, ChevronLeft, ChevronRight, MapPin, Clock,
  Plus, Trash2, Lock, User,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Panel, EmptyState, Skeleton } from '../components/ui';

/* local-date helpers (no UTC shift) */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/* ============================================================
   Global calendar — month agenda grid
   Every day of the month is visible; days with events are
   marked. Leader/Co-Leader add & remove dates, others view.
   ============================================================ */
export default function Calendar() {
  const { user } = useAuth();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const today = new Date();
  const todayISO = iso(today);
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayISO); // selected day (YYYY-MM-DD)

  const canEdit = ['leader', 'coleader'].includes(user.role);

  const load = () => {
    setError('');
    api('/events').then(setEvents).catch((e) => { setError(e.message); setEvents([]); });
  };
  useEffect(load, []);

  // events grouped by date — multi-day events (end_date) appear on EVERY
  // day of their range
  const byDate = useMemo(() => {
    const map = new Map();
    (events || []).forEach((ev) => {
      let d = new Date(ev.event_date + 'T00:00:00');
      if (Number.isNaN(d.getTime())) return;
      const end = ev.end_date && ev.end_date >= ev.event_date
        ? new Date(ev.end_date + 'T00:00:00') : d;
      let guard = 0;
      while (d <= end && guard < 366) {
        const key = iso(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(ev);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        guard += 1;
      }
    });
    return map;
  }, [events]);

  // 6-week grid starting on Monday
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Mon = 0
    return Array.from({ length: 42 }, (_, i) =>
      new Date(cursor.getFullYear(), cursor.getMonth(), 1 - offset + i));
  }, [cursor]);

  const shiftMonth = (delta) => {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  };

  if (events === null && !error) return <Skeleton h={420} />;

  const dayEvents = byDate.get(selected) || [];
  const selDate = new Date(selected + 'T00:00:00');
  const selLabel = `${WEEKDAYS_FULL[selDate.getDay()]} ${selDate.getDate()} ${MONTHS_FULL[selDate.getMonth()]} ${selDate.getFullYear()}`;
  const eventDays = byDate.size;

  return (
    <div className="page">
      <header className="row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="grow">
          <h1>Calendar</h1>
          <p className="text-dim">
            Club-wide agenda set by the Leader — {eventDays} {eventDays === 1 ? 'day' : 'days'} with events.
            {canEdit ? ' You can add and remove dates.' : ' Everyone can view it.'}
          </p>
        </div>
        {canEdit && !adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add date
          </button>
        )}
      </header>

      {error && (
        <div className="banner error row" style={{ gap: 10, marginTop: 12 }}>
          <span className="grow">{error}</span>
          <button className="btn sm secondary" onClick={load}>Retry</button>
        </div>
      )}

      {adding && (
        <EventForm
          initialDate={selected}
          onCancel={() => setAdding(false)}
          onDone={() => { setAdding(false); load(); }}
        />
      )}

      {/* ---------- month grid ---------- */}
      <div className="panel cal">
        <div className="cal-bar">
          <button className="icon-btn" aria-label="Previous month" title="Previous month"
            onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={17} />
          </button>
          <div className="cal-title">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </div>
          <button className="icon-btn" aria-label="Next month" title="Next month"
            onClick={() => shiftMonth(1)}>
            <ChevronRight size={17} />
          </button>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }}
            onClick={() => {
              setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelected(todayISO);
            }}>
            Today
          </button>
        </div>

        <div className="cal-weekdays">
          {WEEKDAYS.map((w) => <div key={w} className="cal-wd">{w}</div>)}
        </div>

        <div className="cal-grid">
          {cells.map((d) => {
            const key = iso(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const dayEvents = byDate.get(key) || [];
            const isToday = key === todayISO;
            const isSel = key === selected;
            return (
              <button
                key={key}
                type="button"
                className={`cal-cell${inMonth ? '' : ' other'}${isToday ? ' today' : ''}${isSel ? ' selected' : ''}${dayEvents.length ? ' has-event' : ''}`}
                onClick={() => setSelected(key)}
                aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''}` : ''}`}
                aria-pressed={isSel}
              >
                <span className="cal-num">{d.getDate()}</span>
                {dayEvents.length > 0 && (
                  <span className="cal-dots">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <span key={ev.id} className={`cal-dot ${(ev.end_date || ev.event_date) < todayISO ? 'past' : ''}`} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- selected day ---------- */}
      <div style={{ marginTop: 16 }}>
        <h2 style={{ marginBottom: 10 }}>
          <span className="row" style={{ gap: 8, display: 'inline-flex' }}>
            <CalIcon size={17} /> {selLabel}
            {selected === todayISO && <span className="badge accent">Today</span>}
          </span>
        </h2>

        {dayEvents.length === 0 ? (
          <div className="panel"><div className="panel-body">
            <EmptyState
              icon={CalIcon}
              title="No event on this day"
              text={canEdit
                ? 'Use "Add date" to put a club event on this day.'
                : 'Days marked on the agenda have events — click one of them.'}
            />
          </div></div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {dayEvents.map((ev) => (
              <EventRow key={ev.id} ev={ev} canEdit={canEdit} onChanged={load} />
            ))}
          </div>
        )}
      </div>

      {!canEdit && (
        <div className="text-dim text-sm row" style={{ gap: 6, marginTop: 16 }}>
          <Lock size={14} /> Only the Leader and Co-Leader can modify the calendar.
        </div>
      )}
    </div>
  );
}

/* ---------- one event row ---------- */
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rangeLabel(ev) {
  if (!ev.end_date || ev.end_date <= ev.event_date) return null;
  const s = new Date(ev.event_date + 'T00:00:00');
  const e = new Date(ev.end_date + 'T00:00:00');
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const days = Math.round((e - s) / 86400000) + 1;
  return `${s.getDate()} ${SHORT_MONTHS[s.getMonth()]} → ${e.getDate()} ${SHORT_MONTHS[e.getMonth()]} · ${days} days`;
}

function EventRow({ ev, canEdit, onChanged }) {
  const remove = async () => {
    if (!window.confirm(`Remove "${ev.title}" from the calendar?`)) return;
    try { await api(`/events/${ev.id}`, { method: 'DELETE' }); onChanged(); }
    catch (e) { alert(e.message); }
  };
  const range = rangeLabel(ev);

  return (
    <article className="panel event-row">
      <div className="grow">
        <strong style={{ fontSize: 14 }}>{ev.title}</strong>
        {ev.description && <p className="text-dim text-sm" style={{ margin: '2px 0 0' }}>{ev.description}</p>}
        <div className="row text-xs text-faint" style={{ gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          {range && <span className="row" style={{ gap: 4 }}><CalIcon size={12} /> {range}</span>}
          {ev.event_time && <span className="row" style={{ gap: 4 }}><Clock size={12} /> {ev.event_time}</span>}
          {ev.location && <span className="row" style={{ gap: 4 }}><MapPin size={12} /> {ev.location}</span>}
          {ev.created_by_name && <span className="row" style={{ gap: 4 }}><User size={12} /> {ev.created_by_name}</span>}
        </div>
      </div>
      {canEdit && (
        <button className="icon-btn" title="Remove date" aria-label="Remove date" onClick={remove}>
          <Trash2 size={14} />
        </button>
      )}
    </article>
  );
}

/* ---------- add form (Leader/Co-Leader) ---------- */
function EventForm({ initialDate, onCancel, onDone }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(initialDate);
  const [endDate, setEndDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const badRange = !!endDate && !!date && endDate < date;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/events', {
        method: 'POST',
        body: { title, description, event_date: date, end_date: endDate, event_time: time, location },
      });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="panel composer" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="panel-head"><h2><CalIcon size={15} /> New calendar date</h2></div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        {error && <div className="banner error">{error}</div>}
        <div className="field">
          <label htmlFor="ev-title">Title</label>
          <input id="ev-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="General assembly, workshop, deadline…" required maxLength={140} />
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="field grow">
            <label htmlFor="ev-date">Date</label>
            <input id="ev-date" className="input" type="date" value={date}
              onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="field grow">
            <label htmlFor="ev-enddate">End date (optional — multi-day)</label>
            <input id="ev-enddate" className="input" type="date" value={endDate} min={date}
              onChange={(e) => setEndDate(e.target.value)}
              style={badRange ? { borderColor: 'var(--danger)' } : undefined} />
          </div>
          <div className="field grow">
            <label htmlFor="ev-time">Time (optional)</label>
            <input id="ev-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="ev-loc">Location (optional)</label>
            <input id="ev-loc" className="input" value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="Lab 203, Amphi A…" />
          </div>
        </div>
        {badRange && <div className="banner warn">The end date cannot be before the start date.</div>}
        <div className="field">
          <label htmlFor="ev-desc">Description (optional)</label>
          <textarea id="ev-desc" className="textarea" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !title.trim() || !date || badRange}>
            {busy ? 'Saving…' : 'Save date'}
          </button>
        </div>
      </div>
    </form>
  );
}
