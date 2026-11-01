import { api } from '../api';
import { useEditor } from '../store';
import { demoIds, forgetDemo, loadDemo } from './sample';

// The portfolio's demo welcome (projects/DEMO.md): a visitor arriving with ?from=portfolio and
// nothing saved can see the demo, with a walk-through, or start fresh. Look and behaviour come
// from public/demo-welcome.js, an unchanged copy of the portfolio's master; this file supplies
// the words, the sample and the steps. Web version only.

interface DemoWelcomeApi {
  init(cfg: object): void;
}

const loadScript = () =>
  new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${import.meta.env.BASE_URL}demo-welcome.js`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('demo-welcome.js did not load'));
    document.head.appendChild(s);
  });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `test` holds (the app re-renders after a route or store change). */
async function until(test: () => boolean, ms = 6000) {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await wait(50);
}

/** The demo's book (or poster), opened with the app's own route, once its pages are on screen. */
async function openProject(which: 'book' | 'poster' | 'tea') {
  const id = demoIds()?.[which];
  if (!id) return;
  if (location.hash !== `#/book/${id}`) location.hash = `#/book/${id}`;
  await until(() => useEditor.getState().doc?.id === id && !!document.querySelector('main.stage'));
}

async function home() {
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  await until(() => !!document.querySelector('.project-grid .project-card'));
}

/** A small notice while the sample loads (import and drafting take a few seconds). */
function progress() {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147482000;padding:16px 22px;border-radius:14px;background:#26231f;color:#f2ede4;font:500 14px/1.4 system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.45)';
  el.textContent = 'Setting up the demo…';
  document.body.appendChild(el);
  return { set: (t: string) => (el.textContent = t), done: () => el.remove() };
}

export async function startDemoWelcome() {
  const web = api.web;
  if (!web) return;
  // Only load the welcome for visitors it can concern: from the portfolio, or mid-demo.
  let demoOn = false;
  try {
    demoOn = !!localStorage.getItem('demo-welcome:photobook-studio');
  } catch {
    // storage unavailable
  }
  if (!/[?&]from=portfolio(&|$)/.test(location.search) && !demoOn) return;
  await loadScript();
  const DemoWelcome = (window as unknown as { DemoWelcome: DemoWelcomeApi }).DemoWelcome;
  DemoWelcome.init({
    id: 'photobook-studio',
    name: 'Photobook Studio',
    accent: '#e7a65f',
    demo: 'A three-day Amalfi Coast trip drafted into a travel journal and a lemon grove poster, plus a Japanese teas poster designed by hand.',
    fresh: 'No books yet. Make one, import a folder of photos, and it drafts the pages.',
    isEmpty: async () => (await api.listProjects()).length === 0 && (await api.deletedProjects()).length === 0,
    loadDemo: async () => {
      const p = progress();
      try {
        await loadDemo(p.set);
      } finally {
        p.done();
      }
      // Reload so the home page lists the new books; the walk-through runs after the reload.
      history.replaceState(null, '', location.pathname + location.search);
      location.reload();
      await new Promise(() => undefined);
    },
    clear: async () => {
      forgetDemo();
      await web.eraseEverything();
      history.replaceState(null, '', location.pathname + location.search);
      location.reload();
    },
    tour: [
      {
        go: home,
        el: '.project-grid',
        title: 'Your books',
        text: 'Everything you make lives here, in this browser. The demo has Amalfi Coast, a 24-page travel journal, and two posters: Lemon grove and Japanese teas.',
      },
      {
        go: () => openProject('poster'),
        el: ['main.stage .canvas', 'main.stage'],
        title: 'A poster in one click',
        text: 'Lemon grove is an automatic collage of the same photos. Arrange and Shuffle try other layouts; the side panel changes the style, spacing and photo shapes.',
      },
      {
        go: async () => {
          if (demoIds()?.tea) await openProject('tea');
          else await home();
        },
        el: ['main.stage .canvas', 'main.stage'],
        title: 'Or design it yourself',
        text: 'Japanese teas was made by hand from scanned tea labels: photos cut out along their edges, some turned into black-and-white negatives, over a background photo.',
      },
      {
        go: () => openProject('book'),
        el: ['.library .grid', '.library'],
        title: 'The library',
        text: '22 photos from three days. The boat burst is grouped, an exact copy of the sunset is flagged and hidden, and ★ keeps a photo in every draft.',
      },
      {
        go: async () => {
          await openProject('book');
          useEditor.getState().setView('overview');
          await until(() => !!document.querySelector('main.stage .overview'));
        },
        el: ['main.stage .overview', 'main.stage'],
        title: 'A first draft for you',
        text: 'Import a folder and it lays out the whole book: a chapter per day, the best shot of each burst, and room for your words.',
      },
      {
        go: async () => {
          await openProject('book');
          useEditor.getState().goToSpread(-1);
          await until(() => !!document.querySelector('main.stage .canvas'));
        },
        el: ['main.stage .canvas', 'main.stage'],
        title: 'Ready for the printer',
        text: 'The cover is sized from the printer and the page count: back, spine and front, with bleed. This one is a Lulu hardcover.',
      },
      {
        go: async () => {
          await openProject('book');
          const st = useEditor.getState();
          st.goToSpread(1);
          useEditor.setState({ draftFocus: st.draftFocus + 1 });
          await until(() => !!document.querySelector('.book-templates'));
        },
        el: ['.book-templates', '.inspector'],
        title: 'Templates that restyle',
        text: 'One click sets the type, paper, cover and colour grade for the whole book. This is Travel journal; try Year in review.',
      },
      {
        go: () => openProject('book'),
        el: ['.topbar .btn-primary', '.topbar'],
        title: 'Print PDFs and a flipbook',
        text: 'Export makes the interior and cover PDFs right here in your browser and checks every page. It also makes a web flipbook.',
      },
      {
        go: () => openProject('book'),
        el: ['.topbar', '.editor'],
        title: 'Where everything lives',
        text: 'The top bar has undo, the views, Preview and Export; its arrow goes back to all your books. The library, the pages and the side panel sit around the page.',
      },
      {
        title: 'Over to you',
        text: 'Everything works, and it all stays in this browser. Drag a photo onto a page, or open the poster. Start fresh is at the bottom left.',
      },
    ],
  });
}
