import { h, icon, iconBtn } from './dom.js';
import { local } from '../core/storage.js';
import { modal, form } from './dialogs.js';
import { actions } from '../core/actions.js';

// My art: every drawing saved in this browser, as a full-screen library in the same paper style
// as Notes — recent drawings up top, then all of them (thumbnails or a list), sort, search, favourites.
const SORTS = [['date', 'Last modified'], ['name', 'Alphabetical (A–Z)']];
const ago = t => { const d = (Date.now() - t) / 1000; return d < 60 ? 'just now' : d < 3600 ? `${Math.floor(d / 60)} min ago` : d < 86400 ? `${Math.floor(d / 3600)} h ago` : new Date(t).toLocaleDateString(); };

export async function showGallery(project) {
  document.querySelector('.gallery')?.remove();
  const opts = { sort: local.get('pp.galSort', 'date'), grid: local.get('pp.galGrid', true), q: '', favs: false };
  const root = h('div.gallery.nb'), page = h('div.nb-lib');
  root.append(page);
  document.body.append(root);
  const close = () => { root.remove(); removeEventListener('keydown', key, true); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', key, true);
  const open = id => { close(); project.library.open(id); };
  const act = id => { close(); actions.run(id); };

  const tile = it => h('div.nb-item', {},
    h('button.nb-open', { type: 'button', onclick: () => open(it.id) },
      h('img.nb-thumb.gal-thumb', { src: it.thumb, alt: '' }),
      h('span.nb-meta', {}, h('b', {}, it.name), h('small', {}, `${it.w} × ${it.h} · ${ago(it.date)}`))),
    h('div.nb-acts', {},
      iconBtn('star', it.fav ? 'Unfavorite' : 'Favorite', async () => { await project.library.update(it.id, { fav: !it.fav }); render(); }, { className: `ibtn${it.fav ? ' on' : ''}` }),
      iconBtn('text', 'Rename', async () => { const v = await form('Rename', [{ id: 'n', label: 'Name', type: 'text', value: it.name }], 'Rename'); if (v?.n?.trim()) { await project.library.rename(it.id, v.n.trim()); render(); } }),
      iconBtn('trash', 'Delete', async () => { if (await modal('Delete drawing?', h('p', {}, `“${it.name}” will be removed from this browser.`), [['Cancel', null], ['Delete', 'ok', 'danger']])) { await project.library.remove(it.id); render(); } })));

  async function render() {
    const all = await project.library.list();
    let items = all.filter(it => (!opts.favs || it.fav) && (!opts.q || it.name.toLowerCase().includes(opts.q.toLowerCase())));
    if (opts.sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
    const recent = !opts.q && !opts.favs && all.length > 3 ? all.slice(0, 6) : [];
    const search = h('input.nb-search', { type: 'search', placeholder: 'Search drawings', value: opts.q, hidden: !opts.searching, oninput: e => { opts.q = e.target.value; render().then(() => { const s = page.querySelector('.nb-search'); s.focus(); s.setSelectionRange(99, 99); }); } });
    page.replaceChildren(
      h('header.nb-head', {},
        iconBtn('x', 'Close (Esc)', close),
        h('h2', {}, opts.favs ? 'Favorites' : 'My art'),
        h('button.nb-sort', { type: 'button', className: opts.favs ? 'on' : '', onclick: () => { opts.favs = !opts.favs; render(); } }, icon('star'), ' Favorites'),
        h('select.nb-sort', { 'aria-label': 'Sort', onchange: e => { opts.sort = e.target.value; local.set('pp.galSort', opts.sort); render(); } }, SORTS.map(([v, l]) => h('option', { value: v, selected: v === opts.sort }, l)))),
      ...(recent.length ? [h('div.nb-sub', {}, h('span', {}, 'Recent')), h('div.gal-recent', {}, recent.map(tile))] : []),
      h('div.nb-sub', {}, h('span', {}, `${items.length} drawing${items.length === 1 ? '' : 's'}`), search),
      h('div', { className: opts.grid ? 'nb-grid' : 'nb-list' }, items.length ? items.map(tile) : h('p.nb-empty', {}, all.length ? 'Nothing matches.' : 'No saved drawings yet — File ▸ Save to Browser (Ctrl+S) keeps one here.')),
      h('div.nb-pill', {},
        iconBtn('zoom', 'Search', () => { opts.searching = !opts.searching; if (!opts.searching) opts.q = ''; render().then(() => opts.searching && page.querySelector('.nb-search').focus()); }),
        iconBtn('plus', 'New canvas', () => act('file.new')),
        iconBtn('folder', 'Open a file…', () => act('file.open')),
        iconBtn(opts.grid ? 'menu' : 'grid', opts.grid ? 'List view' : 'Thumbnails', () => { opts.grid = !opts.grid; local.set('pp.galGrid', opts.grid); render(); })));
  }
  await render();
}
