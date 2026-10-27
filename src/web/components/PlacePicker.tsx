import { useEffect, useMemo, useState } from 'react';
import type { PlaceOutline } from '../../core';
import { api } from '../api';
import { useEditor } from '../store';

// Pick a country or territory outline: places where the photos were taken first (from their GPS),
// then search the rest. Outlines come from the bundled map data — nothing is fetched online.

let allPlaces: Promise<{ id: string; name: string }[]> | null = null;

export function PlacePicker({ onPick, action }: { onPick: (o: PlaceOutline) => void; action: string }) {
  const assets = useEditor((s) => s.assets);
  const [places, setPlaces] = useState<{ id: string; name: string }[]>([]);
  const [suggested, setSuggested] = useState<{ id: string; name: string; photos: number }[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const points = useMemo(
    () => assets.filter((a) => !a.excluded && !a.missing).filter((a) => a.gpsLat != null && a.gpsLon != null).map((a) => [a.gpsLon!, a.gpsLat!] as [number, number]),
    [assets],
  );
  useEffect(() => {
    void (allPlaces ??= api.places()).then(setPlaces).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (points.length) void api.suggestPlaces(points).then(setSuggested).catch(() => undefined);
  }, [points]);

  const pick = async (id: string) => {
    setBusy(id);
    try {
      onPick(await api.placeOutline(id));
    } catch (e) {
      useEditor.getState().toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const matches = q.trim() ? places.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 24) : [];
  return (
    <div className="stack tight">
      {suggested.length > 0 && (
        <div className="place-list">
          <span className="muted small">Where your photos were taken</span>
          {suggested.slice(0, 4).map((p) => (
            <button key={p.id} className="place" disabled={!!busy} onClick={() => void pick(p.id)}>
              <span>{p.name}</span><span className="muted small">{busy === p.id ? '…' : `${p.photos} photo${p.photos === 1 ? '' : 's'} · ${action}`}</span>
            </button>
          ))}
        </div>
      )}
      <input className="text-mask-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search a country or territory…" aria-label="Search places" />
      {matches.length > 0 && (
        <div className="place-list">
          {matches.map((p) => (
            <button key={p.id} className="place" disabled={!!busy} onClick={() => void pick(p.id)}>
              <span>{p.name}</span><span className="muted small">{busy === p.id ? '…' : action}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim() && !matches.length && places.length > 0 && <p className="muted small">No place called “{q}”. Countries and territories (e.g. Hong Kong, Macao, Singapore) are included; cities aren’t yet.</p>}
    </div>
  );
}
