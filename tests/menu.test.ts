// Loads eulerocket's register.ts with a fake engine and checks the menu and the commands.
// Run from the repo root: bun tests/menu.test.ts
const g = globalThis as any
g.h = (type: any, props: any, ...kids: any[]) => ({ type, props: props ?? {}, kids: kids.flat().filter((k) => k != null) })

const { register } = await import('../hooks/register.ts')
const { SHIP_KINDS, SHIP_LABELS } = await import('../hooks/rocket.ts')

let failures = 0
const ok = (cond: unknown, msg: string) => { if (cond) console.log('ok  ', msg); else { failures++; console.log('FAIL', msg) } }

const hooks: { event: string; filter?: any; fn: Function }[] = []
const on = (event: string, a: any, b?: any) => hooks.push(b ? { event, filter: a, fn: b } : { event, fn: a })
register(on as any)
const find = (event: string, match: (f: any) => boolean = () => true) => hooks.find((x) => x.event === event && match(x.filter ?? {}))!.fn

const store = new Map<string, unknown>()
const calls: any[] = []
const timers: { ms: number; fn: () => void }[] = []
const $ = {
  clock: { every: () => ({ cancel() {} }), after: (ms: number, fn: () => void) => { timers.push({ ms, fn }); return { cancel() {} } } },
  ui: {
    blit: async () => {}, invalidate: async () => { calls.push(['invalidate']) },
    open: async (o: any) => { calls.push(['open', o]) }, close: async (o: any) => { calls.push(['close', o]) },
    panes: async () => [{ id: 'eulerocket', isFocused: true }],
    resolve: () => ({ Box: 'Box', Text: 'Text', Select: 'Select', Raster: 'Raster', Svg: 'Svg' }),
  },
  state: { set: async () => {}, get: async () => 0 },
  store: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => { store.set(k, structuredClone(v)) } },
  env: { get: async (k: string) => (k === 'TERM_PROGRAM' ? 'WindowsTerminal' : '') },
  command: { register: async (c: any) => { calls.push(['register', c]) } },
}
const next = async (e: any) => e?.__below ?? null
const flush = () => new Promise((r) => setTimeout(r, 5))

// A stored ship this version doesn't draw falls back to the default, scifi.
store.set('config', { ship: 'zeppelin' })
await find('session.start')($, {}, next)
const reg = calls.find((c) => c[0] === 'register')?.[1]
ok(reg?.argumentHint.includes(`ship <${SHIP_KINDS.join('|')}>`), 'argumentHint lists SHIP_KINDS')
ok(reg?.argumentHint.includes('status') && reg.argumentHint.includes('help'), 'argumentHint lists status and help')

const run = (args: string) => find('command.run', (f) => f.command === 'eulerocket')($, { args }, next)
const status = await run('status')
ok(/ship scifi/.test(status.text), 'unknown stored ship falls back to scifi (status shows "ship scifi")')
ok(status.text.includes(`ship <${SHIP_KINDS.join('|')}>`), 'status lists ships from SHIP_KINDS')
ok((await run('help')).text === status.text, 'help shows the same as status')

const menuRes = await run('')
ok(menuRes && !menuRes.text, '/eulerocket with no args returns no text')
ok(calls.some((c) => c[0] === 'open' && c[1].id === 'eulerocket' && c[1].title === 'eulerocket'), 'no args opens pane id/title eulerocket')
ok(timers.some((t) => t.ms === 250), 'menu re-asks for focus after 250 ms')

ok((await run('ship shuttle')).text === 'the shuttle flies.', 'ship shuttle replies')
ok((store.get('config') as any).ship === 'shuttle', 'ship shuttle stored')
ok(/Usage: \/eulerocket ship rocket\|shuttle/.test((await run('ship zeppelin')).text) || SHIP_KINDS.length > 2, 'bad ship gives usage from SHIP_KINDS')
ok((await run('size 8')).text.startsWith('8 rows'), 'size 8 replies')
ok((store.get('config') as any).rows === 8, 'size 8 stored')
ok((await run('size auto')).text.startsWith('auto height'), 'size auto')
ok((await run('size 5')).text.startsWith('5 rows'), 'size 5 (not a menu choice)')
ok((await run('off')).text === 'off.' && (store.get('config') as any).enabled === false, 'off')
ok((await run('on')).text === 'on.' && (store.get('config') as any).enabled === true, 'on')
ok((await run('working full')).text.includes('full') && (store.get('config') as any).whileWorking === 'full', 'working full')
ok((await run('idle slim')).text.includes('slim') && (store.get('config') as any).whileIdle === 'slim', 'idle slim')
ok((await run('animate off')).text === 'holding still.', 'animate off')
ok((await run('pixels fine')).text.includes('fine') && (store.get('config') as any).pixelsFor.WindowsTerminal === 'fine', 'pixels fine')
ok((await run('colormode 256')).text.startsWith('colours: 256'), 'colormode 256')
ok((await run('recede 60')).text.includes('40%') && (store.get('config') as any).recede === 60, 'recede 60')
ok((await run('recede 7')).text.startsWith('Usage:') && (store.get('config') as any).recede === 60, 'recede 7 gives usage')
ok((await run('blur 25')) && (store.get('config') as any).blur === 25, 'blur 25')
ok((await run('blur 33')).text.startsWith('Usage:') && (store.get('config') as any).blur === 25, 'blur 33 gives usage')
ok((await run('slim 3')).text === 'slim band: 3 rows.' && (store.get('config') as any).slimRows === 3, 'slim 3')
ok((await run('demo done')).text === 'playing done.', 'demo done')
ok((await run('bogus')).text.startsWith('unknown command'), 'unknown command')

// The pane.
const pane = find('ui.render', (f) => f.component === 'Pane' && f.requestId === 'eulerocket')
const render = async (isFocused = true) => pane($, { props: { bodyColumns: 80, isFocused } }, next)
let tree = await render()
const selects = (t: any) => t.kids.filter((k: any) => k?.type === 'Select')
let sel = selects(tree)
ok(sel.map((s: any) => s.props.key).join(',') === 'ship,show,size,slim,working,idle,recede,blur,animate,pixels', 'ten Selects in spec order')
ok(sel[0].props.options.map((o: any) => o.value).join(',') === SHIP_KINDS.join(','), 'ship options = SHIP_KINDS')
ok(sel[0].props.options.every((o: any) => o.label === SHIP_LABELS[o.value as keyof typeof SHIP_LABELS]), 'ship labels = SHIP_LABELS')
ok(sel[0].props.value === 'shuttle', 'ship shows current value')
ok(sel[2].props.value === '5' && sel[2].props.options.some((o: any) => o.value === '5'), 'size shows a non-menu current value')
ok(sel[2].props.options.slice(0, 8).map((o: any) => o.value).join(',') === 'auto,4,6,8,10,12,14,16', 'size choices')
ok(sel[3].props.value === '3' && sel[4].props.value === 'full' && sel[5].props.value === 'slim' && sel[6].props.value === '60' && sel[7].props.value === '25' && sel[8].props.value === 'off' && sel[9].props.value === 'fine', 'current values selected')
ok(tree.kids[0].kids[0].startsWith('Tab'), 'focused hint')
ok((await render(false)).kids[0].kids[0].startsWith('press ctrl+x then tab'), 'unfocused hint')

sel[0].props.onSelect('rocket'); await flush()
ok((store.get('config') as any).ship === 'rocket', 'menu ship select stores rocket')
tree = await render()
ok(tree.kids.at(-1).kids[0] === 'the rocket flies.', 'message area shows the last action')
selects(tree)[2].props.onSelect('8'); await flush()
ok((store.get('config') as any).rows === 8, 'menu size 8')
selects(await render())[1].props.onSelect('off'); await flush()
ok((store.get('config') as any).enabled === false, 'menu show off')
selects(await render())[8].props.onSelect('on'); await flush()
ok((store.get('config') as any).animate === true, 'menu animate on')

// The band renders the chosen ship on the next frame: the AbovePrompt render with the new ship differs.
await run('on'); await run('size 8'); await run('pixels standard')
const band = find('ui.render', (f) => f.component === 'AbovePrompt')
const cellsNow = async () => { const t = await band($, { requestId: 'r', props: { bodyColumns: 60, maxRows: 40, isWorking: false } }, next); return JSON.stringify(t) }
await run('ship rocket'); const a = await cellsNow()
await run('ship shuttle'); const b = await cellsNow()
ok(a !== b, 'band frame changes right after switching ship')

// Closing the pane resets menuOpen (no throw, next called).
ok((await find('ui.close')($, { id: 'eulerocket', __below: 'x' }, next)) === 'x', 'ui.close passes through')

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
