// Small inline icon set (no icon font, nothing fetched).
const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 12s3.6 7 10 7a10 10 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2',
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  folder: 'M3 6.5A1.5 1.5 0 014.5 5H9l2 2h8.5A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  rotate: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  pin: 'M9 3.5h6M10 3.5l-.6 6L6.5 13v1.5h11V13l-2.9-3.5-.6-6M12 14.5V21',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 017.7-1.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1 1 0 100-.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  spread: 'M3 5h8.5v14H3zM12.5 5H21v14h-8.5z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  info: 'M12 8v.5M12 11v5M12 21a9 9 0 100-18 9 9 0 000 18z',
  guides: 'M4 8h16M4 16h16M8 4v16M16 4v16',
  left: 'M15 6l-6 6 6 6',
  down: 'M6 9l6 6 6-6',
  right: 'M9 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  swap: 'M7 7h13l-4-4M17 17H4l4 4',
  crop: 'M6 2v16h16M2 6h16v16',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  front: 'M8 8h12v12H8zM4 4h12v4M4 4v12h4',
  history: 'M3 12a9 9 0 103-6.7L3 8M3 3v5h5M12 7v5l3 3',
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}
