import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogProvider, useDialog } from './components/DialogProvider.tsx';
import { Icon } from './components/Icon.tsx';
import { Checkbox } from './components/ui/Checkbox.tsx';
import { Dialog } from './components/ui/Dialog.tsx';
import { Select, TextArea, TextField } from './components/ui/Field.tsx';
import { Menu } from './components/ui/Menu.tsx';
import { PhotoViewer } from './components/ui/PhotoViewer.tsx';
import { RadioCards } from './components/ui/RadioCards.tsx';
import { Segmented } from './components/ui/Segmented.tsx';
import { Stepper } from './components/ui/Stepper.tsx';
import { StickyBar } from './components/ui/StickyBar.tsx';
import { useToast } from './components/ui/Toast.tsx';
import './styles.css';
import './styles/ui.css';

const DEMO = {
  title: 'UI primitives',
  post: 'Friday Post',
  postMeta: 'Live price · 2 photos · 19 cards',
  card: 'Lord Skitter, Sewer King',
  setLine: 'WOE #97 · Wilds of Eldraine',
  printings: 'All printings of Lord Skitter, Sewer King',
  cancel: 'Cancel', save: 'Save', close: 'Close', savePrice: 'Save price', undo: 'Undo',
  addAll: 'Add all to post', share: 'Share photos', download: 'Download all', select: 'Select', addPhotos: 'Add photos',
  signOut: 'Sign out', deletePay: 'Delete my payment details', change: 'Change',
  notAdded: '2 photos not added', inPost: 'In post', unpaid: 'Unpaid', foil: 'Foil', fresh: 'New',
  rename: 'Rename post', renameHint: 'Buyers see this name on their claims.', postName: 'Post name', nameNeeded: 'Give the post a name',
  editPrice: 'Edit price', finish: 'Finish', nonFoil: 'Non-foil', multiplier: 'Multiplier', lower: 'Lower multiplier', raise: 'Raise multiplier',
  resetMult: 'Reset to ×2.5', override: 'Price override (this card)', calc: 'USD 4.99 × 2.5, rounded up to RM 1',
  changeCard: 'Change card', search: 'Wrong card? Search by name', find: 'Find', useAsIs: 'Use as-is',
  useAsIsTitle: 'Use “Lord Skitter, Sewer King” as it is?', useAsIsMsg: 'The scan stops looking it up, and you set its price yourself.',
  support: 'Support this app', supportBody: 'Pasar Malam MTG is free. If it saves you time at the stall, a small tip keeps the price list fresh every night.',
  deletePost: 'Delete post', deleteTitle: 'Delete “Friday Post”?', deleteMsg: 'Its 2 photos, 19 cards and any claims will be removed. This can’t be undone.',
  errorTitle: 'Couldn’t save', errorMsg: 'Check your connection and try again.',
  addCard: 'Add missing card', addCardMsg: 'The name of the card the scan missed.', findIt: 'Find it',
  archive: 'Archive post', archiveHint: 'Hides it from Posts. Claims stay, and you can bring it back.',
  deleteHint: 'Removes its photos, cards and claims for good.', managePost: 'Manage post',
  archived: 'Post archived', copied: 'Message copied. Paste it in Messenger.',
  bank: 'Bank', bankEg: 'e.g. Maybank', account: 'Account number', note: 'Note for buyers', noteEg: 'e.g. Send the receipt here after paying',
  mult: 'Multiplier', foilMult: 'Foil multiplier', minPrice: 'Minimum price', badNumber: 'Use a number from 1 to 5',
  rounding: 'Rounding', currency: 'Currency label', currencyHint: 'Set by the post’s pricing.',
  cents: 'Show cents (.00)', outlines: 'Draw card outlines', outlinesHint: 'A thin box around each card the scan found.',
  forNew: 'Use these for new posts too', forNewHint: 'New posts now start with ×2.5 · Foil ×2.8.',
  howSee: 'How buyers see prices', photo: 'Price on photo', photoDesc: 'Prices are printed on the photo. Finishing the post locks them for claims.',
  live: 'Live price', liveDesc: 'No prices on the photo. Each buyer’s price is set when you send them their total.',
  filter: 'Show buyers', all: 'All', paid: 'Paid', done: 'Done', appearance: 'Appearance', auto: 'Auto', light: 'Light', dark: 'Dark',
  quantity: 'Quantity', fewer: 'Fewer', more: 'More', remove: 'Remove card',
  unsaved: 'Unsaved changes', viewerLabel: 'Photo 2, full screen', yours: 'Your card', matched: 'Matched card', flip: 'Show the other card',
  rows: ['Friday Post', '22 Oct, 4:11 pm', 'MH3 singles'],
};

const WORST: typeof DEMO = {
  title: 'Primitif UI',
  post: 'Jumaat malam: Commander staples, foils & bulk rares (part 2 of 3)',
  postMeta: 'Harga semasa · 47 foto · 1,284 kad',
  card: 'Our Market Research Shows That Players Like Really Long Card Names So We Made This Card to Have the Absolute Longest Card Name Ever Elemental',
  setLine: 'LTR #1000 · Universes Beyond: The Lord of the Rings: Tales of Middle-earth',
  printings: 'Semua cetakan Asmoranomardicadaistinaculdacar',
  cancel: 'Batal', save: 'Simpan perubahan', close: 'Tutup', savePrice: 'Simpan harga', undo: 'Buat asal',
  addAll: 'Tambah semua 1,284 kad ke post', share: 'Kongsi foto', download: 'Muat turun semua', select: 'Pilih', addPhotos: 'Tambah foto',
  signOut: 'Log keluar', deletePay: 'Padam butiran pembayaran saya', change: 'Tukar',
  notAdded: '47 foto belum ditambah', inPost: 'Dalam post', unpaid: 'Belum bayar', foil: 'Foil', fresh: 'Baharu',
  rename: 'Tukar nama post', renameHint: 'Pembeli nampak nama ini pada tuntutan mereka.', postName: 'Nama post', nameNeeded: 'Beri post ini nama',
  editPrice: 'Ubah harga', finish: 'Kemasan', nonFoil: 'Bukan foil', multiplier: 'Pendarab', lower: 'Kurangkan pendarab', raise: 'Naikkan pendarab',
  resetMult: 'Set semula ke ×2.5', override: 'Harga ganti (kad ini)', calc: 'USD 1,299.99 × 2.5, dibundarkan ke atas ke RM 1',
  changeCard: 'Tukar kad', search: 'Kad salah? Cari ikut nama', find: 'Cari', useAsIs: 'Guna seadanya',
  useAsIsTitle: 'Guna “Asmoranomardicadaistinaculdacar” seadanya?', useAsIsMsg: 'Imbasan berhenti mencarinya, dan anda tetapkan harganya sendiri.',
  support: 'Sokong aplikasi ini', supportBody: 'Pasar Malam MTG percuma. Kalau ia menjimatkan masa anda di gerai, sedikit tip membantu senarai harga dikemas kini setiap malam, termasuk kad foil, kad promo dan kad dari set Universes Beyond.',
  deletePost: 'Padam post', deleteTitle: 'Padam “Jumaat malam: Commander staples, foils & bulk rares (part 2 of 3)”?', deleteMsg: '47 foto, 1,284 kad dan semua tuntutannya akan dibuang. Ini tidak boleh dibatalkan.',
  errorTitle: 'Tidak dapat menyimpan', errorMsg: 'Semak sambungan anda dan cuba lagi. Kalau masih gagal, muat semula halaman ini.',
  addCard: 'Tambah kad yang tertinggal', addCardMsg: 'Nama kad yang imbasan terlepas.', findIt: 'Cari',
  archive: 'Arkibkan post', archiveHint: 'Menyembunyikannya daripada senarai Post. Tuntutan kekal, dan anda boleh memulihkannya.',
  deleteHint: 'Membuang foto, kad dan tuntutannya buat selamanya.', managePost: 'Urus post',
  archived: '“Jumaat malam: Commander staples, foils & bulk rares (part 2 of 3)” diarkibkan', copied: 'Mesej disalin. Tampal dalam Messenger.',
  bank: 'Bank', bankEg: 'Bank Kerjasama Rakyat Malaysia Berhad (Bank Rakyat)', account: 'Nombor akaun', note: 'Nota untuk pembeli', noteEg: 'cth. Hantar resit di sini selepas bayar 🙏',
  mult: 'Pendarab', foilMult: 'Pendarab foil', minPrice: 'Harga minimum', badNumber: 'Guna nombor dari 1 hingga 5',
  rounding: 'Pembundaran', currency: 'Label mata wang', currencyHint: 'Ditetapkan oleh harga post.',
  cents: 'Tunjuk sen (.00)', outlines: 'Lukis garisan kad', outlinesHint: 'Kotak nipis di sekeliling setiap kad yang dijumpai imbasan.',
  forNew: 'Guna ini untuk post baharu juga', forNewHint: 'Post baharu kini bermula dengan ×2.5 · Foil ×2.8.',
  howSee: 'Cara pembeli nampak harga', photo: 'Harga pada foto', photoDesc: 'Setiap kad ada harga tertulis pada foto. Menyiapkan post mengunci harga untuk tuntutan.',
  live: 'Harga semasa', liveDesc: 'Tiada harga pada foto. Harga setiap pembeli ditetapkan apabila anda hantar jumlah mereka.',
  filter: 'Tunjuk pembeli', all: 'Semua', paid: 'Dibayar', done: 'Selesai', appearance: 'Paparan', auto: 'Auto', light: 'Cerah', dark: 'Gelap',
  quantity: 'Kuantiti', fewer: 'Kurang', more: 'Lagi', remove: 'Buang kad',
  unsaved: 'Ada perubahan yang belum disimpan', viewerLabel: 'Foto 2, skrin penuh', yours: 'Kad anda', matched: 'Kad dipadankan', flip: 'Tunjuk kad satu lagi',
  rows: ['Jumaat malam: Commander staples, foils & bulk rares (part 2 of 3)', '<b>Clearance</b> & 50% off', 'A'],
};

type Copy = typeof DEMO;
const params = new URLSearchParams(location.search);

function setParam(key: string, value: string) {
  params.set(key, value);
  history.replaceState(null, '', `?${params}`);
}

function Gallery() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [data, setData] = useState(params.get('data') === 'worst' ? 'worst' : 'demo');
  const c = data === 'worst' ? WORST : DEMO;
  return (
    <main className="gallery">
      <header className="gallery-head">
        <h1 className="gallery-title">{c.title}</h1>
        <Segmented
          aria-label="Theme"
          value={theme}
          onChange={v => { setTheme(v); setParam('theme', v); document.documentElement.dataset.theme = v; }}
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />
        <Segmented
          aria-label="Data"
          value={data}
          onChange={v => { setData(v); setParam('data', v); }}
          options={[{ value: 'demo', label: 'Demo data' }, { value: 'worst', label: 'Worst case' }]}
        />
      </header>
      <Buttons c={c} />
      <Lists c={c} />
      <Form c={c} />
      <Overlays c={c} />
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery-section">
      <h2 className="gallery-label">{title}</h2>
      {children}
    </section>
  );
}

function Buttons({ c }: { c: Copy }) {
  return (
    <Section title="Buttons and chips">
      <div className="ui-card gallery-stack">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block" id="first-button"><Icon name="addList" />{c.addAll}</button>
        <div className="gallery-pair">
          <button type="button" className="ui-btn"><Icon name="share" size={18} />{c.share}</button>
          <button type="button" className="ui-btn"><Icon name="download" size={18} />{c.download}</button>
        </div>
        <div className="gallery-row">
          <button type="button" className="ui-btn ui-btn--primary">{c.save}</button>
          <button type="button" className="ui-btn">{c.change}</button>
          <button type="button" className="ui-btn ui-btn--ink">{c.cancel}</button>
          <button type="button" className="ui-btn ui-btn--ink">{c.signOut}</button>
          <button type="button" className="ui-btn ui-btn--plain">{c.select}</button>
          <button type="button" className="ui-btn ui-btn--danger">{c.deletePay}</button>
          <button type="button" className="ui-btn ui-btn--danger-fill">{c.deletePost}</button>
        </div>
        <div className="gallery-row">
          <button type="button" className="ui-btn ui-btn--primary" disabled>{c.save}</button>
          <button type="button" className="ui-btn" disabled>{c.change}</button>
          <button type="button" className="ui-icon-btn" aria-label={c.managePost}><Icon name="more" /></button>
          <button type="button" className="ui-icon-btn" aria-label={c.rename}><Icon name="edit" size={18} /></button>
          <button type="button" className="ui-icon-btn ui-icon-btn--sm" aria-label={c.editPrice}><Icon name="edit" size={16} /></button>
          <button type="button" className="ui-icon-btn" aria-label={c.deletePost} disabled><Icon name="trash" size={18} /></button>
        </div>
        <div className="gallery-row">
          <span className="ui-chip">{c.fresh}</span>
          <span className="ui-chip ui-chip--accent">{c.notAdded}</span>
          <span className="ui-chip ui-chip--green">{c.inPost}</span>
          <span className="ui-chip ui-chip--warn">{c.unpaid}</span>
          <span className="ui-chip ui-chip--gold">{c.foil}</span>
        </div>
      </div>
    </Section>
  );
}

function Lists({ c }: { c: Copy }) {
  const toast = useToast();
  return (
    <Section title="Section head, list, card">
      <div className="gallery-title-row">
        <h2 className="ui-section-title">{c.post}</h2>
        <Menu
          label={c.managePost}
          items={[
            { label: c.archive, hint: c.archiveHint, onSelect: () => toast(c.archived, { undoLabel: c.undo, onUndo: () => undefined }) },
            { label: c.deletePost, hint: c.deleteHint, destructive: true, onSelect: () => undefined },
          ]}
        >
          <Icon name="more" />
        </Menu>
      </div>
      <div className="ui-section-head">
        <h2 className="ui-section-title">Photos <span className="ui-count">· 47</span></h2>
        <div className="ui-section-actions">
          <button type="button" className="ui-btn ui-btn--plain">{c.select}</button>
          <button type="button" className="ui-btn"><Icon name="plus" size={16} />{c.addPhotos}</button>
        </div>
      </div>
      <ul className="ui-list">
        {c.rows.map((title, i) => (
          <li key={title}>
            <a className="ui-row" href="#row">
              <span className="gallery-mosaic" aria-hidden="true">{i === 0 ? '+43' : ''}</span>
              <span className="ui-row-main">
                <span className="ui-row-title">{title}</span>
                <span className="ui-row-meta">{c.postMeta}</span>
                {i === 0 ? <span><span className="ui-chip ui-chip--accent">{c.notAdded}</span></span> : null}
              </span>
            </a>
          </li>
        ))}
        <li><div className="ui-row"><span className="ui-row-meta">{c.renameHint}</span></div></li>
      </ul>
      <div className="ui-card gallery-stack" style={{ marginTop: 16 }}>
        <h2 className="ui-card-title">{c.card}</h2>
        <span className="ui-row-meta">{c.setLine}</span>
      </div>
    </Section>
  );
}

function Form({ c }: { c: Copy }) {
  const [mult, setMult] = useState('2.5');
  const [foilMult, setFoilMult] = useState('9');
  const [kind, setKind] = useState<'photo' | 'live'>('photo');
  const [filter, setFilter] = useState('unpaid');
  const [look, setLook] = useState('auto');
  const [qty, setQty] = useState(1);
  const [m, setM] = useState(2.5);
  const bad = (v: string) => !(Number(v) >= 1 && Number(v) <= 5);
  return (
    <Section title="Form controls">
      <div className="ui-card gallery-stack">
        <div className="gallery-grid">
          <TextField label={c.bank} placeholder={c.bankEg} id="bank" />
          <TextField label={c.account} inputMode="numeric" defaultValue="1234567890123456" />
          <TextField label={c.mult} prefix="×" inputMode="decimal" value={mult} onChange={e => setMult(e.target.value)} error={bad(mult) ? c.badNumber : undefined} />
          <TextField label={c.foilMult} prefix="×" inputMode="decimal" value={foilMult} onChange={e => setFoilMult(e.target.value)} error={bad(foilMult) ? c.badNumber : undefined} />
          <TextField label={c.minPrice} prefix="RM" inputMode="numeric" defaultValue="1" />
          <Select label={c.rounding} defaultValue="1">
            <option value="1">Up to RM 1</option>
            <option value="5">Up to RM 5</option>
            <option value="10">Up to RM 10</option>
          </Select>
          <TextField label={c.currency} defaultValue="RM" disabled hint={c.currencyHint} />
        </div>
        <TextArea label={c.note} rows={2} placeholder={c.noteEg} />
        <div>
          <Checkbox label={c.cents} />
          <Checkbox label={c.outlines} hint={c.outlinesHint} defaultChecked />
          <Checkbox label={c.forNew} hint={c.forNewHint} disabled />
        </div>
        <h3 id="how-see" className="ui-card-title">{c.howSee}</h3>
        <RadioCards
          aria-labelledby="how-see"
          value={kind}
          onChange={setKind}
          options={[{ value: 'photo', title: c.photo, description: c.photoDesc }, { value: 'live', title: c.live, description: c.liveDesc }]}
        />
        <Segmented
          aria-label={c.filter}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `${c.all} 150` }, { value: 'unpaid', label: `${c.unpaid} 12` },
            { value: 'paid', label: `${c.paid} 3` }, { value: 'done', label: `${c.done} 0` },
          ]}
        />
        <Segmented label={c.appearance} value={look} onChange={setLook} options={[{ value: 'auto', label: c.auto }, { value: 'light', label: c.light }, { value: 'dark', label: c.dark }]} />
        <div className="gallery-row">
          <Stepper value={qty} onChange={setQty} min={1} max={99} label={c.quantity} decrementLabel={c.fewer} incrementLabel={c.more} onRemove={() => setQty(1)} removeLabel={c.remove} />
          <Stepper value={m} onChange={setM} min={1} max={5} step={0.1} format={v => `×${v.toFixed(1)}`} label={c.multiplier} decrementLabel={c.lower} incrementLabel={c.raise} />
        </div>
      </div>
    </Section>
  );
}

function Overlays({ c }: { c: Copy }) {
  const dialog = useDialog();
  const toast = useToast();
  const [open, setOpen] = useState<null | 'rename' | 'price' | 'picker' | 'support' | 'photo' | 'compare'>(null);
  const [name, setName] = useState(c.post);
  const [sticky, setSticky] = useState(false);
  const [result, setResult] = useState('');
  const [finish, setFinish] = useState('foil');
  const [m, setM] = useState(2.8);
  const close = () => setOpen(null);
  const ask = async (label: string, run: () => Promise<unknown>) => setResult(`${label}: ${JSON.stringify(await run())}`);
  const cancel = <button type="button" className="ui-btn ui-btn--ink" onClick={close}>{c.cancel}</button>;

  return (
    <Section title="Dialogs, toast, viewer, sticky bar">
      <div className="ui-card gallery-stack">
        <div className="gallery-row">
          <button type="button" className="ui-btn" id="open-rename" onClick={() => { setName(c.post); setOpen('rename'); }}>{c.rename}</button>
          <button type="button" className="ui-btn" id="open-price" onClick={() => setOpen('price')}>{c.editPrice}</button>
          <button type="button" className="ui-btn" id="open-picker" onClick={() => setOpen('picker')}>{c.changeCard}</button>
          <button type="button" className="ui-btn" id="open-support" onClick={() => setOpen('support')}>{c.support}</button>
          <button type="button" className="ui-btn ui-btn--danger" id="open-confirm" onClick={() => ask('confirm', () => dialog.confirm({ title: c.deleteTitle, message: c.deleteMsg, okLabel: c.deletePost, cancelLabel: c.cancel, destructive: true }))}>{c.deletePost}</button>
          <button type="button" className="ui-btn" id="open-alert" onClick={() => ask('alert', () => dialog.alert({ title: c.errorTitle, message: c.errorMsg }))}>Alert</button>
          <button type="button" className="ui-btn" id="open-prompt" onClick={() => ask('prompt', () => dialog.prompt({ title: c.addCard, message: c.addCardMsg, placeholder: 'Sol Ring', okLabel: c.findIt, cancelLabel: c.cancel }))}>Prompt</button>
          <button type="button" className="ui-btn" id="open-two" onClick={() => ask('two', () => Promise.all([dialog.alert({ title: c.errorTitle, message: c.errorMsg }), dialog.confirm({ title: c.deleteTitle, message: c.deleteMsg, okLabel: c.deletePost, destructive: true })]))}>Two at once</button>
        </div>
        <div className="gallery-row">
          <button type="button" className="ui-btn" id="toast-plain" onClick={() => toast(c.copied)}>Toast</button>
          <button type="button" className="ui-btn" id="toast-undo" onClick={() => toast(c.archived, { undoLabel: c.undo, onUndo: () => setResult('undo: clicked') })}>Toast with Undo</button>
          <button type="button" className="ui-btn" id="open-photo" onClick={() => setOpen('photo')}>Photo viewer</button>
          <button type="button" className="ui-btn" id="open-compare" onClick={() => setOpen('compare')}>Compare viewer</button>
        </div>
        <Checkbox label="Show the sticky bar" checked={sticky} onChange={e => setSticky(e.target.checked)} id="sticky-toggle" />
        <p className="ui-row-meta" aria-live="polite" id="result">{result || '…'}</p>
      </div>

      <Dialog
        open={open === 'rename'}
        onClose={close}
        title={c.rename}
        subtitle={c.renameHint}
        closeLabel={c.close}
        footer={<>{cancel}<button type="button" className="ui-btn ui-btn--primary" disabled={!name.trim()} onClick={close}>{c.save}</button></>}
      >
        <TextField label={c.postName} value={name} onChange={e => setName(e.target.value)} error={name.trim() ? undefined : c.nameNeeded} data-autofocus="" />
      </Dialog>

      <Dialog
        open={open === 'price'}
        onClose={close}
        title={c.card}
        subtitle={c.setLine}
        closeLabel={c.close}
        footer={<>{cancel}<button type="button" className="ui-btn ui-btn--primary" onClick={close}>{c.savePrice}</button></>}
      >
        <div className="gallery-stack">
          <div className="gallery-price"><div><span className="gallery-approx">≈</span>RM35</div><span className="ui-row-meta">{c.calc}</span></div>
          <Segmented label={c.finish} value={finish} onChange={setFinish} options={[{ value: 'nonfoil', label: c.nonFoil }, { value: 'foil', label: <span className="gallery-gold">{c.foil}</span> }]} />
          <div className="gallery-row gallery-between">
            <span className="ui-label">{c.multiplier}</span>
            <button type="button" className="ui-btn ui-btn--plain" onClick={() => setM(2.5)}>{c.resetMult}</button>
          </div>
          <Stepper value={m} onChange={setM} min={1} max={5} step={0.1} format={v => `×${v.toFixed(1)}`} label={c.multiplier} decrementLabel={c.lower} incrementLabel={c.raise} />
          <TextField label={c.override} prefix="RM" inputMode="decimal" placeholder="35" />
        </div>
      </Dialog>

      <Dialog
        open={open === 'picker'}
        onClose={close}
        variant="picker"
        title={c.changeCard}
        subtitle={c.printings}
        closeLabel={c.close}
      >
        <div className="gallery-stack">
          <div className="gallery-row gallery-search">
            <TextField aria-label={c.search} placeholder={c.search} prefix={<Icon name="search" size={16} />} className="gallery-grow" />
            <button type="button" className="ui-btn ui-btn--primary">{c.find}</button>
          </div>
          <div className="gallery-printings">
            {Array.from({ length: 12 }, (_, i) => (
              <button type="button" key={i} className="gallery-printing" aria-pressed={i === 3}>
                <span className="gallery-printing-art" />
                <span className="ui-row-meta">WOE #{90 + i}</span>
              </button>
            ))}
          </div>
          <button type="button" className="ui-btn ui-btn--ink" id="nested-confirm" onClick={() => ask('nested', () => dialog.confirm({ title: c.useAsIsTitle, message: c.useAsIsMsg, okLabel: c.useAsIs, cancelLabel: c.cancel }))}>{c.useAsIs}</button>
        </div>
      </Dialog>

      <Dialog
        open={open === 'support'}
        onClose={close}
        title={c.support}
        closeLabel={c.close}
        footer={<button type="button" className="ui-btn ui-btn--ink" onClick={close}>{c.close}</button>}
      >
        <p style={{ margin: 0 }}>{c.supportBody}</p>
      </Dialog>

      <PhotoViewer open={open === 'photo'} onClose={close} label={c.viewerLabel} closeLabel={c.close} image={{ src: '/demo/sample-scan.jpg', alt: c.viewerLabel }}>
        <div className="ui-viewer-caption"><div className="ui-row-title">Photo 2</div><div className="ui-row-meta">11 cards · 2000×1500</div></div>
      </PhotoViewer>
      <PhotoViewer
        open={open === 'compare'}
        onClose={close}
        label={c.card}
        closeLabel={c.close}
        flipLabel={c.flip}
        pair={[{ src: '/demo/claims-arkenstone.jpg', alt: c.yours, label: c.yours }, { src: '/demo/claims-delay.jpg', alt: c.matched, label: c.matched }]}
      >
        <div className="ui-viewer-caption"><div className="ui-row-title">{c.card}</div><div className="ui-row-meta">{c.setLine}</div></div>
      </PhotoViewer>

      {sticky ? (
        <StickyBar>
          <span className="ui-sticky-status" aria-live="polite">{c.unsaved}</span>
          <button type="button" className="ui-btn ui-btn--ink" onClick={() => setSticky(false)}>{c.cancel}</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled>{c.save}</button>
        </StickyBar>
      ) : null}
    </Section>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <Gallery />
    </DialogProvider>
  </StrictMode>,
);
