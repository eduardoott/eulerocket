/**
 * eulerocket: a rocket marked EULER flying through the stars above the Claude Code prompt. While
 * Claude works the stars streak into warp, the rocket recedes and its flame stretches; a finished
 * turn makes the ship glow.
 *
 *   /eulerocket                       a menu pane to pick the ship and settings
 *   /eulerocket status | help         status and the list of commands
 *   /eulerocket on | off              show or hide it
 *   /eulerocket size <rows|auto>      how tall the band is (2-24 rows, two pixels per row)
 *   /eulerocket working <slim|full|hide>   the band while Claude works
 *   /eulerocket idle <full|slim|hide>      the band while Claude is idle
 *   /eulerocket pixels <standard|fine>     fine: four pixels per character, for tight line spacing
 *   /eulerocket colormode <auto|full|256>  256 for terminals without true colour
 *   /eulerocket animate <on|off>      hold the scene still
 *   /eulerocket ship <kind>           which ship flies (SHIP_KINDS in rocket.ts)
 *   /eulerocket demo <working|done|error|intro>
 *
 * The band is one Raster element under `ui.render` for `AbovePrompt`; a clock timer builds each
 * next frame and swaps it in with `$.ui.blit`, so nothing else redraws. The desktop app has no
 * Raster: there the band is an `Svg` of the same pixels, redrawn per frame.
 * Adapted from pixelband by Furqan Khan (MIT), github.com/furqan-khan07/pixelband.
 */
import type { Register, RenderElement } from 'claude-code'
import type { Art } from './art'
import { DURATION, FRAME_MS, frame, isOneShot, type Mood } from './effects'
import { to256 } from './palette256'
import { cellsFor, quadCellsFor } from './raster'
import { eulerocket, SHIP_KINDS, SHIP_LABELS, type Renderer, type ShipKind } from './rocket'
import { svgWithin } from './svg'

type Shown = 'slim' | 'full' | 'hide'
type ColorMode = 'auto' | 'full' | '256'
/** standard: two pixels per cell (half blocks). fine: four (quadrants), for nearly square cells. */
type Pixels = 'standard' | 'fine'
/** `rows` 0 means auto: about a quarter of the terminal. */
interface Config { rows: number; enabled: boolean; animate: boolean; whileWorking: Shown; whileIdle: Shown; colorMode: ColorMode; ship: ShipKind
  /** How far the ship recedes while working, in percent of its size. */
  recede: number
  /** How soft the shrunken ship gets, in percent: 100 fully averaged, 0 crisp pixels. */
  blur: number
  /** Pixels per character, per terminal app: the right choice depends on that terminal's font. */
  pixelsFor: Record<string, Pixels> }

const DEFAULTS: Config = { rows: 0, enabled: true, animate: true, whileWorking: 'slim', whileIdle: 'full', colorMode: 'auto', ship: 'scifi', recede: 30, blur: 100, pixelsFor: {} }
const NAME = 'eulerocket'
/** Menu choices for how far the ship recedes while working, in percent. */
const RECEDES = [0, 30, 45, 60, 75]
/** Menu choices for how soft the shrunken ship gets, in percent. */
const BLURS = [0, 25, 50, 75, 100]
const MENU = 'eulerocket'
const SHIPS_TEXT = SHIP_KINDS.join('|')
const SIZE_CHOICES = ['auto', '4', '6', '8', '10', '12', '16']
const isShip = (v: unknown): v is ShipKind => (SHIP_KINDS as readonly unknown[]).includes(v)
/** How tall the band gets while Claude works, in 'slim' mode: out of the way, still animating. */
const SLIM_ROWS = 4
const ROW_STEP = 2
const MAX_COLS = 250
/** Upper bound on cells per drawing, so a huge terminal can't produce an unreasonably big frame. */
const MAX_CELLS = 6000
const KEY = 'art'
const LABEL = 'a rocket marked EULER flying through the stars'

const pixelCols = (cols: number, pixels: Pixels) => (pixels === 'fine' ? cols * 2 : cols)
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)))
/** Auto height: about a quarter of what the band may take, 4 to 8 rows. */
const autoRows = (maxRows: number) => clampInt(maxRows * 0.28, 4, 8)

/** The engine calls the timer needs later: a mod may not keep `$` itself, so session.start captures them. */
interface Host {
  every: (ms: number, fn: () => void) => { cancel: () => void }
  after: (ms: number, fn: () => void) => unknown
  blit: (args: { requestId: string; key: string; cells: string; columns: number; rows: number }) => unknown
  invalidate: () => unknown
  /** Redraws only the sites that read the frame counter (the band), for apps without blit. */
  bump: () => unknown
  set: (key: string, value: unknown) => Promise<unknown>
  open: () => unknown
  close: () => unknown
  panes: () => unknown
}

export const register: Register = (on) => {
  let host: Host | null = null
  let config: Config = { ...DEFAULTS }

  let renderer: Renderer | null = null
  let rendererKey = ''
  let band: { requestId: string; columns: number; rows: number } | null = null
  let limits: { cols: number; maxRows: number } | null = null

  let mood: Mood = 'idle'
  let ticks = 0
  let working = false
  let timer: { cancel: () => void } | null = null
  let sceneT = 0
  let energy = 0
  let shownRows = -1
  let frameNo = 0
  let only256 = false
  let terminal = 'unknown'
  let surface = 'terminal'
  let menuOpen = false
  /** The last menu action's message, shown in the pane. */
  let note = ''
  const inTerminal = () => surface === 'terminal'
  const pixelsNow = (): Pixels => (inTerminal() ? config.pixelsFor?.[terminal] ?? 'standard' : 'standard')
  const use256 = () => inTerminal() && (config.colorMode === '256' || (config.colorMode === 'auto' && only256))

  const redraw = () => { try { host?.invalidate() } catch { /* not mounted yet */ } }

  /** The band's full height for the current terminal. */
  const fullRows = () => (limits ? Math.min(config.rows || autoRows(limits.maxRows), limits.maxRows, Math.floor(MAX_CELLS / limits.cols)) : 0)

  function targetRows(): number {
    if (!limits) return 0
    const full = fullRows()
    const mode = working ? config.whileWorking : config.whileIdle
    return mode === 'full' ? full : mode === 'hide' ? 0 : Math.min(SLIM_ROWS, full)
  }

  /**
   * This moment's frame. The scene always renders at the band's full height; a slim band shows the
   * middle rows, where the rocket flies.
   */
  function currentFrame(): { a: Art; px: Uint32Array } | null {
    if (!band) return null
    const w = pixelCols(band.columns, pixelsNow()), h = band.rows * 2
    const fullH = Math.max(h, fullRows() * 2)
    const rkey = `${w}x${fullH}:${config.ship}:${config.recede}:${config.blur}`
    if (!renderer || rendererKey !== rkey) { renderer = eulerocket(w, fullH, config.ship, config.recede / 100, config.blur / 100); rendererKey = rkey }
    const flash = mood === 'done' ? ticks * FRAME_MS : null
    const whole = renderer({ t: sceneT, energy, flash })
    const top = Math.max(0, Math.round((fullH - h) / 2))
    const px = top === 0 && h === fullH ? whole : whole.slice(top * w, (top + h) * w)
    const a: Art = { w, h, px }
    // The scene shows working and done itself (warp, ship glow); intro and error play over it.
    const m = mood === 'working' || mood === 'done' ? 'idle' : mood
    return { a, px: frame(a, m, ticks * FRAME_MS) }
  }

  function currentCells(): string | null {
    const f = currentFrame()
    if (!f) return null
    const shown = use256() ? to256(f.px) : f.px
    return pixelsNow() === 'fine' ? quadCellsFor(f.a, shown) : cellsFor(f.a, shown)
  }

  function blit() {
    if (!band || !host) return
    if (!inTerminal()) { Promise.resolve(host.bump()).catch(() => redraw()); return }
    const cells = currentCells()
    if (!cells) return
    Promise.resolve(host.blit({ requestId: band.requestId, key: KEY, cells, columns: band.columns, rows: band.rows }))
      .catch(() => { /* band gone or resized: the next render fixes it */ })
  }

  const resizing = () => limits !== null && config.enabled && shownRows !== targetRows()
  const visible = () => band !== null && config.enabled
  /** In the desktop app the band stands still while the menu is open: redrawing it every frame made the menu's dropdowns flicker. */
  const menuPauses = () => menuOpen && !inTerminal()
  const animating = () => !menuPauses() && (isOneShot(mood) || resizing() || ((mood === 'working' || config.animate) && visible()))

  function syncTimer() {
    if (!animating()) { timer?.cancel(); timer = null }
    else if (!timer && host) timer = host.every(FRAME_MS, tick)
  }

  function tick() {
    ticks++
    if (resizing()) {
      const target = targetRows()
      shownRows = shownRows < target ? Math.min(target, shownRows + ROW_STEP) : Math.max(target, shownRows - ROW_STEP)
      redraw() // a new height needs a real render, not a blit
    }
    if (config.animate) {
      sceneT += FRAME_MS
      energy += ((working ? 1 : 0) - energy) * 0.1
    }
    if (isOneShot(mood) && ticks * FRAME_MS >= DURATION[mood]) setMood(working ? 'working' : 'idle')
    else blit()
  }

  function setMood(next: Mood) {
    mood = next
    ticks = 0
    syncTimer()
    blit()
  }

  async function save() {
    await host?.set('config', config)
    if (limits) shownRows = targetRows()
    redraw(); syncTimer()
  }

  async function setShown(which: 'whileWorking' | 'whileIdle', mode: string): Promise<string> {
    if (!['slim', 'full', 'hide'].includes(mode)) return `Usage: /${NAME} ${which === 'whileWorking' ? 'working' : 'idle'} slim|full|hide`
    config[which] = mode as Shown; await save()
    return `${which === 'whileWorking' ? 'while Claude works' : 'while idle'}: ${mode}.`
  }

  // The actions behind both the commands and the menu; each returns the message to show.
  async function setEnabled(shown: boolean): Promise<string> {
    config.enabled = shown; await save()
    return shown ? 'on.' : 'off.'
  }

  async function setSize(arg: string): Promise<string> {
    if (arg === 'auto') { config.rows = 0; await save(); return 'auto height: about a quarter of the terminal.' }
    const n = Number(arg)
    if (!arg || !Number.isFinite(n)) return `Usage: /${NAME} size <rows> (2 to 24) or size auto.`
    config.rows = clampInt(n, 2, 24); await save()
    return `${config.rows} rows tall, as much as the terminal allows.`
  }

  async function setPixels(arg: string): Promise<string> {
    if (!['standard', 'fine'].includes(arg)) return `Usage: /${NAME} pixels standard|fine`
    config.pixelsFor = { ...(config.pixelsFor ?? {}), [terminal]: arg as Pixels }; await save()
    return `${arg} pixels in this terminal.`
  }

  async function setColorMode(arg: string): Promise<string> {
    if (!['auto', 'full', '256'].includes(arg)) return `Usage: /${NAME} colormode auto|full|256`
    config.colorMode = arg as ColorMode; await save()
    return `colours: ${use256() ? '256' : 'full colour'}${arg === 'auto' ? ' (auto)' : ''}.`
  }

  async function setAnimate(arg: string): Promise<string> {
    if (!['on', 'off'].includes(arg)) return `Usage: /${NAME} animate on|off`
    config.animate = arg === 'on'; await save()
    return config.animate ? 'moving.' : 'holding still.'
  }

  async function setRecede(arg: string): Promise<string> {
    const n = Number(arg)
    if (!RECEDES.includes(n)) return `Usage: /${NAME} recede ${RECEDES.join('|')}`
    config.recede = n; await save()
    return n === 0 ? 'the ship holds its size while working.' : `the ship recedes to ${100 - n}% while working.`
  }

  async function setBlur(arg: string): Promise<string> {
    const n = Number(arg)
    if (!BLURS.includes(n)) return `Usage: /${NAME} blur ${BLURS.join('|')}`
    config.blur = n; await save()
    return n === 0 ? 'the shrunken ship keeps crisp pixels.' : `the shrunken ship softens ${n}%.`
  }

  async function setShip(arg: string): Promise<string> {
    if (!isShip(arg)) return `Usage: /${NAME} ship ${SHIPS_TEXT}`
    config.ship = arg; await save()
    return `the ${arg} flies.`
  }

  function statusText(): string {
    const status = `${LABEL}: ${config.enabled ? 'on' : 'off'}, ${config.rows ? `${config.rows} rows` : 'auto height'}, working ${config.whileWorking}, idle ${config.whileIdle}, ship ${config.ship}${use256() ? ', 256 colours' : ''}`
    return `${status}.\n/${NAME} opens the menu · on · off · size <rows|auto> · working <slim|full|hide> · idle <full|slim|hide> · pixels <standard|fine> · colormode <auto|full|256> · animate <on|off> · recede <${RECEDES.join('|')}> · blur <${BLURS.join('|')}> · ship <${SHIPS_TEXT}> · demo <working|done|error|intro> · status · help`
  }

  async function openMenu() {
    if (!host) return
    note = ''
    await host.open()
    menuOpen = true
    syncTimer()
    // The keyboard only goes to a pane when Claude Code can spare it; ask once more a moment later.
    host.after(250, () => {
      Promise.resolve(host?.panes()).then((list) => {
        const pane = ((list as { id: string; isFocused: boolean }[]) ?? []).find((p) => p.id === MENU)
        if (pane && !pane.isFocused) return host?.open()
      }).catch(() => { /* the hint in the menu covers it */ })
    })
  }

  /** Run a menu action, then show its message in the menu. */
  const act = (fn: () => Promise<string>) => () => {
    fn().then((msg) => { note = msg; redraw() }, (err) => { note = `${err?.message ?? err}`; redraw() })
  }

  on('session.start', async ($, e, next) => {
    host = {
      every: (ms, fn) => $.clock.every(ms, fn),
      after: (ms, fn) => $.clock.after(ms, fn),
      blit: (args) => $.ui.blit(args),
      invalidate: () => $.ui.invalidate('ui.render'),
      bump: () => $.state.set({ plugin: 'eulerocket', key: 'frame' }, ++frameNo),
      set: (key, value) => $.store.set(key, value as any),
      open: () => $.ui.open({ id: MENU, title: 'eulerocket', focus: true, closeOnEscape: true, rows: 12 }),
      close: () => $.ui.close({ id: MENU }),
      panes: () => $.ui.panes(),
    }
    const program = String((await $.env.get('TERM_PROGRAM')) ?? '')
    const colorterm = String((await $.env.get('COLORTERM')) ?? '')
    only256 = program === 'Apple_Terminal' && !/truecolor|24bit/i.test(colorterm)
    terminal = program || 'unknown'
    const c = (await $.store.get('config')) as Partial<Config> | undefined
    config = { ...DEFAULTS, ...(c ?? {}) }
    // a stored ship this version doesn't draw would leave the renderer with no sprite
    if (!isShip(config.ship)) config.ship = DEFAULTS.ship
    if (!(config.recede >= 0 && config.recede <= 90)) config.recede = DEFAULTS.recede
    if (!(config.blur >= 0 && config.blur <= 100)) config.blur = DEFAULTS.blur
    redraw()
    setMood('intro')
    await $.command.register({
      name: NAME,
      description: 'The EULER rocket above your prompt: no argument opens a menu; or on, off, size, working, idle, pixels, colormode, animate, ship, demo, status, help',
      argumentHint: `[on | off | size <rows|auto> | working <slim|full|hide> | idle <full|slim|hide> | ship <${SHIPS_TEXT}> | recede <percent> | blur <percent> | demo <mood> | status | help]`,
    })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (!(e as any).agentId) { working = true; if (mood !== 'working') setMood('working'); else syncTimer() }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (!(e as any).agentId) {
      working = false
      const reason = (e as any).reason
      setMood(reason === 'answer' ? 'done' : reason === 'error' || reason === 'refusal' ? 'error' : 'idle')
    }
    return next(e)
  })

  // With the Boxis mod installed, marking a box as understood bumps its "celebrate" state: play the ship glow.
  on('state.set', async ($, e: any, next) => {
    const r = await next(e)
    if (e?.plugin === 'boxis' && e?.key === 'celebrate') setMood('done')
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const props = (e as any).props
    if (!config.enabled || props.hasSurvey) { band = null; syncTimer(); return next(e) }
    const { Box, Raster, Svg } = $.ui.resolve(e) as any
    surface = (e as any).surface ?? 'terminal'
    if (!inTerminal() && !Svg) { band = null; syncTimer(); return next(e) }
    // Other mods share this band: what they draw stays under the rocket instead of being dropped.
    const stackOver = async (mine: unknown) => {
      const below = await next(e)
      return (below ? h(Box, { flexDirection: 'column' }, mine, below) : mine) as RenderElement
    }
    const cols = Math.max(1, Math.min(props.bodyColumns ?? 80, MAX_COLS))
    limits = { cols, maxRows: Math.max(1, props.maxRows ?? 24) }
    // Catch up if a turn event was missed.
    if (props.isWorking && !working) { working = true; if (mood === 'idle') setMood('working') }
    if (!props.isWorking && working) { working = false; if (mood === 'working') setMood('idle') }
    if (shownRows < 0) shownRows = targetRows()
    const rows = Math.min(shownRows, limits.maxRows, Math.floor(MAX_CELLS / cols))
    if (rows < 1) { band = null; syncTimer(); return next(e) }
    band = { requestId: (e as any).requestId, columns: cols, rows }
    syncTimer()

    if (!inTerminal()) {
      // Reading the counter subscribes the band to it, so each bump redraws this hook alone.
      await $.state.get({ plugin: 'eulerocket', key: 'frame' })
      const f = currentFrame()
      if (!f) return next(e)
      return stackOver(h(Box, { flexDirection: 'row' }, h(Svg, { source: svgWithin(f.a, f.px), alt: `${NAME}: ${LABEL}` })))
    }
    const cells = currentCells()
    if (!cells) return next(e)
    return stackOver(h(Box, { flexDirection: 'row' }, h(Raster, { key: KEY, columns: band.columns, rows: band.rows, cells })))
  })

  on('ui.close', ($, e, next) => {
    if ((e as any).id === MENU) { menuOpen = false; syncTimer() }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: MENU }, ($, e, next) => {
    const { Box, Text, Select } = $.ui.resolve(e) as any
    const props = (e as any).props
    const width = Math.max(30, props.bodyColumns ?? 80)
    const fitText = (t: string, n: number) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t)
    // Every option fits the pane after its label: a wrapped row garbles the terminal redraw.
    const select = (p: { options: { value: string; label?: string }[] } & Record<string, unknown>) =>
      h(Select, { ...p, options: p.options.map((o) => ({ value: o.value, label: fitText(o.label ?? o.value, width - 16) })) })
    const line = (t: string, style: object = {}) => h(Text, { wrap: 'truncate-end', ...style }, fitText(t, width))
    const size = config.rows ? String(config.rows) : 'auto'
    // A size set by command (say 5) is not a menu choice: list it too so the Select can show it.
    const sizes = SIZE_CHOICES.includes(size) ? SIZE_CHOICES : [...SIZE_CHOICES, size]

    return h(Box, { flexDirection: 'column' },
      props.isFocused
        ? line('Tab / ↑↓ move · Enter picks · Esc closes · changes show in the band live', { dimColor: true })
        : line('press ctrl+x then tab to use this menu · Esc closes', { color: 'yellow' }),
      select({
        key: 'ship', label: 'Ship          ', value: config.ship, autoFocus: true,
        options: SHIP_KINDS.map((k) => ({ value: k, label: SHIP_LABELS[k] ?? k })),
        onSelect: (v: string) => act(() => setShip(v))(),
      }),
      select({
        key: 'show', label: 'Show          ', value: config.enabled ? 'on' : 'off',
        options: [{ value: 'on' }, { value: 'off' }],
        onSelect: (v: string) => act(() => setEnabled(v === 'on'))(),
      }),
      select({
        key: 'size', label: 'Size          ', value: size,
        options: sizes.map((v) => ({ value: v, label: v === 'auto' ? 'auto' : `${v} rows` })),
        onSelect: (v: string) => act(() => setSize(v))(),
      }),
      select({
        key: 'working', label: 'While working ', value: config.whileWorking,
        options: [{ value: 'slim' }, { value: 'full' }, { value: 'hide' }],
        onSelect: (v: string) => act(() => setShown('whileWorking', v))(),
      }),
      select({
        key: 'idle', label: 'While idle    ', value: config.whileIdle,
        options: [{ value: 'full' }, { value: 'slim' }, { value: 'hide' }],
        onSelect: (v: string) => act(() => setShown('whileIdle', v))(),
      }),
      select({
        key: 'recede', label: 'Recede        ', value: String(config.recede),
        options: [...new Set([...RECEDES, config.recede])].map((v) => ({ value: String(v), label: v === 0 ? 'off' : `to ${100 - v}%` })),
        onSelect: (v: string) => act(() => setRecede(v))(),
      }),
      select({
        key: 'blur', label: 'Blur          ', value: String(config.blur),
        options: [...new Set([...BLURS, config.blur])].map((v) => ({ value: String(v), label: v === 0 ? 'crisp' : `${v}%` })),
        onSelect: (v: string) => act(() => setBlur(v))(),
      }),
      select({
        key: 'animate', label: 'Animate       ', value: config.animate ? 'on' : 'off',
        options: [{ value: 'on' }, { value: 'off' }],
        onSelect: (v: string) => act(() => setAnimate(v))(),
      }),
      select({
        key: 'pixels', label: 'Pixels        ', value: pixelsNow(),
        options: [{ value: 'standard' }, { value: 'fine' }],
        onSelect: (v: string) => act(() => setPixels(v))(),
      }),
      line(note || ' ', { dimColor: true }),
    ) as RenderElement
  })

  on('command.run', { command: NAME }, async ($, e, next) => {
    const args = String((e as any).args ?? '').trim()
    const [sub] = args.split(/\s+/)
    const arg = args.slice(sub.length).trim().toLowerCase()
    const reply = (text: string) => ({ text })

    switch ((sub || '').toLowerCase()) {
      case '':
      case 'menu':
        await openMenu()
        return {}
      case 'on':
      case 'off':
        return reply(await setEnabled(sub.toLowerCase() === 'on'))
      case 'size':
        return reply(await setSize(arg))
      case 'working':
        return reply(await setShown('whileWorking', arg))
      case 'idle':
        return reply(await setShown('whileIdle', arg))
      case 'pixels':
        return reply(await setPixels(arg))
      case 'colormode':
      case 'colourmode':
        return reply(await setColorMode(arg))
      case 'animate':
        return reply(await setAnimate(arg))
      case 'ship':
        return reply(await setShip(arg))
      case 'recede':
        return reply(await setRecede(arg))
      case 'blur':
        return reply(await setBlur(arg))
      case 'demo': {
        if (!['working', 'done', 'error', 'intro'].includes(arg)) return reply(`Usage: /${NAME} demo working|done|error|intro`)
        // A demo "working" has no turn to end it, so stop it after a few seconds.
        working = arg === 'working'
        setMood(arg as Mood)
        if (arg === 'working') $.clock.after(4000, () => { if (mood === 'working') { working = false; setMood('idle') } })
        return reply(`playing ${arg}.`)
      }
      case 'status':
      case 'help':
        return reply(statusText())
      default:
        return reply(`unknown command "${sub}". /${NAME} help lists them.`)
    }
  })
}
