import { useEffect, useState } from 'react';
import { Images, ChevronDown, ChevronUp } from 'lucide-react';
import { api, BASE } from '../api';
import { Skeleton, EmptyState } from './ui';

/* ============================================================
   Media home · ALBUMS — every club member browses the
   department's albums straight from the public page (managing
   albums stays in the private workspace). A card per album with
   its real cover photo; clicking opens the album inline.
   ============================================================ */
export default function AlbumsGallery() {
  const [albums, setAlbums] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    api('/media/albums').then(setAlbums).catch((e) => { setError(e.message); setAlbums([]); });
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (albums === null) return <Skeleton h={180} />;

  const photos = albums.reduce((n, a) => n + a.media.length, 0);

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow members"><span className="dot" />Albums · club members</span>
        <span className="text-faint text-xs row" style={{ gap: 6 }}>
          <Images size={13} />
          {photos} {photos === 1 ? 'photo' : 'photos'} in {albums.length} {albums.length === 1 ? 'album' : 'albums'}
        </span>
      </div>

      {albums.length === 0 ? (
        <div className="panel"><div className="panel-body">
          <EmptyState
            icon={Images}
            title="No albums yet"
            text="The Media team publishes albums here — every club member can open them."
          />
        </div></div>
      ) : (
        <div className="album-cards">
          {albums.map((a) => {
            const cover = a.media[0];
            const open = openId === a.id;
            return (
              <div key={a.id} className={`album-card${open ? ' open' : ''}`}>
                <button
                  type="button"
                  className="album-card-head"
                  onClick={() => setOpenId(open ? null : a.id)}
                  aria-expanded={open}
                >
                  <span className="album-cover">
                    {cover ? <img src={`${BASE}${cover.thumb_path || cover.file_path}`} alt="" /> : <Images size={22} />}
                  </span>
                  <span className="album-card-body">
                    <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <span className="album-title">{a.title}</span>
                      {open ? <ChevronUp size={14} className="text-faint" /> : <ChevronDown size={14} className="text-faint" />}
                    </span>
                    {a.description && <span className="album-desc">{a.description}</span>}
                    <span className="album-meta">
                      {a.media.length} {a.media.length === 1 ? 'photo' : 'photos'}
                      {a.created_at ? ` · added ${String(a.created_at).slice(0, 10)}` : ''}
                    </span>
                  </span>
                </button>

                {open && (a.media.length === 0 ? (
                  <div className="album-empty text-faint text-xs">No pictures in this album yet.</div>
                ) : (
                  <div className="album-open">
                    {a.media.map((m) => (
                      <figure key={m.id} className="album-shot">
                        <img src={`${BASE}${m.thumb_path || m.file_path}`} alt={m.caption || a.title} loading="lazy" />
                        {m.caption && <figcaption>{m.caption}</figcaption>}
                      </figure>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
