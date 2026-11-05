/**
 * eulerocket: a rocket marked EULER flying through the stars above the Claude Code prompt. While
 * Claude works the stars streak into warp and the flame stretches; a finished turn flashes.
 *
 *   /eulerocket                       status and the list of commands
 *   /eulerocket on | off              show or hide it
 *   /eulerocket size <rows|auto>      how tall the band is (2-24 rows, two pixels per row)
 *   /eulerocket working <slim|full|hide>   the band while Claude works
 *   /eulerocket idle <full|slim|hide>      the band while Claude is idle
 *   /eulerocket pixels <standard|fine>     fine: four pixels per character, for tight line spacing
 *   /eulerocket colormode <auto|full|256>  256 for terminals without true colour
 *   /eulerocket animate <on|off>      hold the scene still
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
import { eulerocket, type Renderer } from './rocket'
import { svgWithin } from './svg'

type Shown = 'slim' | 'full' | 'hide'
type ColorMode = 'auto' | 'full' | '256'
/** standard: two pixels per cell (half blocks). fine: four (quadrants), for nearly square cells. */
type Pixels = 'standard' | 'fine'
/** `rows` 0 means auto: about a quarter of the terminal. */
interface Config { rows: number; enabled: boolean; animate: boolean; whileWorking: Shown; whileIdle: Shown; colorMode: ColorMode
  /** Pixels per character, per terminal app: the right choice depends on that terminal's font. */
  pixelsFor: Record<string, Pixels> }

const DEFAULTS: Config = { rows: 0, enabled: true, animate: true, whileWorking: 'slim', whileIdle: 'full', colorMode: 'auto', pixelsFor: {} }
const NAME = 'eulerocket'
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
  blit: (args: { requestId: string; key: string; cells: string; columns: number; rows: number }) => unknown
  invalidate: () => unknown
  /** Redraws only the sites that read the frame counter (the band), for apps without blit. */
  bump: () => unknown
  set: (key: string, value: unknown) => Promise<unknown>
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
    const rkey = `${w}x${fullH}`
    if (!renderer || rendererKey !== rkey) { renderer = eulerocket(w, fullH); rendererKey = rkey }
    const flash = mood === 'done' ? ticks * FRAME_MS : null
    const whole = renderer({ t: sceneT, energy, flash })
    const top = Math.max(0, Math.round((fullH - h) / 2))
    const px = top === 0 && h === fullH ? whole : whole.slice(top * w, (top + h) * w)
    const a: Art = { w, h, px }
    // The scene shows working and done itself (warp, flash); intro and error play over it.
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
  const animating = () => isOneShot(mood) || resizing() || ((mood === 'working' || config.animate) && visible())

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

  on('session.start', async ($, e, next) => {
    host = {
      every: (ms, fn) => $.clock.every(ms, fn),
      blit: (args) => $.ui.blit(args),
      invalidate: () => $.ui.invalidate('ui.render'),
      bump: () => $.state.set({ plugin: 'eulerocket', key: 'frame' }, ++frameNo),
      set: (key, value) => $.store.set(key, value as any),
    }
    const program = String((await $.env.get('TERM_PROGRAM')) ?? '')
    const colorterm = String((await $.env.get('COLORTERM')) ?? '')
    only256 = program === 'Apple_Terminal' && !/truecolor|24bit/i.test(colorterm)
    terminal = program || 'unknown'
    const c = (await $.store.get('config')) as Partial<Config> | undefined
    config = { ...DEFAULTS, ...(c ?? {}) }
    redraw()
    setMood('intro')
    await $.command.register({
      name: NAME,
      description: 'The EULER rocket above your prompt: on, off, size, working, idle, pixels, colormode, animate, demo',
      argumentHint: '[on | off | size <rows|auto> | working <slim|full|hide> | idle <full|slim|hide> | demo <mood>]',
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

  // With the Boxis mod installed, marking a box as understood bumps its "celebrate" state: play the flash.
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

  on('command.run', { command: NAME }, async ($, e, next) => {
    const args = String((e as any).args ?? '').trim()
    const [sub] = args.split(/\s+/)
    const arg = args.slice(sub.length).trim().toLowerCase()
    const reply = (text: string) => ({ text })

    switch ((sub || '').toLowerCase()) {
      case 'on':
      case 'off':
        config.enabled = sub.toLowerCase() === 'on'; await save()
        return reply(config.enabled ? 'on.' : 'off.')
      case 'size': {
        if (arg === 'auto') { config.rows = 0; await save(); return reply('auto height: about a quarter of the terminal.') }
        const n = Number(arg)
        if (!arg || !Number.isFinite(n)) return reply(`Usage: /${NAME} size <rows> (2 to 24) or size auto.`)
        config.rows = clampInt(n, 2, 24); await save()
        return reply(`${config.rows} rows tall, as much as the terminal allows.`)
      }
      case 'working':
        return reply(await setShown('whileWorking', arg))
      case 'idle':
        return reply(await setShown('whileIdle', arg))
      case 'pixels':
        if (!['standard', 'fine'].includes(arg)) return reply(`Usage: /${NAME} pixels standard|fine`)
        config.pixelsFor = { ...(config.pixelsFor ?? {}), [terminal]: arg as Pixels }; await save()
        return reply(`${arg} pixels in this terminal.`)
      case 'colormode':
      case 'colourmode':
        if (!['auto', 'full', '256'].includes(arg)) return reply(`Usage: /${NAME} colormode auto|full|256`)
        config.colorMode = arg as ColorMode; await save()
        return reply(`colours: ${use256() ? '256' : 'full colour'}${arg === 'auto' ? ' (auto)' : ''}.`)
      case 'animate':
        if (!['on', 'off'].includes(arg)) return reply(`Usage: /${NAME} animate on|off`)
        config.animate = arg === 'on'; await save()
        return reply(config.animate ? 'moving.' : 'holding still.')
      case 'demo': {
        if (!['working', 'done', 'error', 'intro'].includes(arg)) return reply(`Usage: /${NAME} demo working|done|error|intro`)
        // A demo "working" has no turn to end it, so stop it after a few seconds.
        working = arg === 'working'
        setMood(arg as Mood)
        if (arg === 'working') $.clock.after(4000, () => { if (mood === 'working') { working = false; setMood('idle') } })
        return reply(`playing ${arg}.`)
      }
      case '':
      case 'status':
      case 'help': {
        const status = `${LABEL}: ${config.enabled ? 'on' : 'off'}, ${config.rows ? `${config.rows} rows` : 'auto height'}, working ${config.whileWorking}, idle ${config.whileIdle}${use256() ? ', 256 colours' : ''}`
        return reply(`${status}.\n/${NAME} on · off · size <rows|auto> · working <slim|full|hide> · idle <full|slim|hide> · pixels <standard|fine> · colormode <auto|full|256> · animate <on|off> · demo <working|done|error|intro>`)
      }
      default:
        return reply(`unknown command "${sub}". /${NAME} help lists them.`)
    }
  })
}
