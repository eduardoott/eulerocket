# eulerocket

A Claude Code mod that puts a pixel-art rocket marked **EULER** above your prompt, flying through
the stars. While Claude works the stars streak into warp, the rocket recedes into the distance and
its blue flame stretches; when a turn finishes, the ship glows. Prefer a space shuttle?
`/eulerocket ship shuttle` swaps it in. It runs in the terminal and in the desktop app, and costs zero tokens.

## Install

```
claude plugin marketplace add eduardoott/eulerocket
claude plugin install eulerocket@eulerocket
```

Then run `/reload-plugins` in Claude Code.

## Commands

| Command | What it does |
|---|---|
| `/eulerocket` | status and the list of commands |
| `/eulerocket on` / `off` | show or hide the rocket |
| `/eulerocket size <rows\|auto>` | band height, 2 to 24 rows |
| `/eulerocket working <slim\|full\|hide>` | the band while Claude works |
| `/eulerocket idle <full\|slim\|hide>` | the band while Claude is idle |
| `/eulerocket pixels <standard\|fine>` | fine: four pixels per character, for tight line spacing |
| `/eulerocket colormode <auto\|full\|256>` | 256 for terminals without true colour |
| `/eulerocket animate <on\|off>` | hold the scene still |
| `/eulerocket ship <rocket\|shuttle>` | which ship flies: the EULER rocket (default) or a space shuttle |
| `/eulerocket demo <working\|done\|error\|intro>` | play an effect |

## Credits

Adapted from [pixelband](https://github.com/furqan-khan07/pixelband) by Furqan Khan, under the MIT
licence. The rendering engine (raster, effects, colours) is his; the rocket scene is new.
