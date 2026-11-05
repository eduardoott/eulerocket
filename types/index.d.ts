// The reactive state eulerocket keeps: `frame` counts animation frames in apps without `$.ui.blit`
// (the desktop app). The band reads it while drawing, so bumping it redraws the band alone.
declare module 'claude-code' {
  interface PluginState {
    eulerocket: {
      frame: number
    }
  }
}
