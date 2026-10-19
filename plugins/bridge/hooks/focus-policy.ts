// Focusing the terminal tab that runs a listed session. Pure: every command is
// built here and every output is parsed here; the caller passes `run`, the one
// edge that reaches `$.process`. Supported hosts: cmux, tmux, Ghostty,
// Terminal.app and iTerm2.
//
// Same app only: the pane finds its own host once (`ownPlaceOf`), and a press
// focuses a target only when the target runs in that same place (same app;
// for tmux the same server socket, for cmux the same instance socket). A live
// target anywhere else runs no focus call (`elsewhere`, or `unknown` when its
// host is not recognised). A dead target, or a failed step, is a fallback the
// caller answers by copying the resume line.
//
// Speed: the host of each session is probed during the pane's refresh and kept
// in module memory (`refreshKnown`), so a press runs no probe; each host's
// focus steps run as one process.
//
// This file is a re-export shim: the code lives in `adapters/`, one file per
// terminal behind one interface (`Adapter`, in `adapters/shared.ts`).

export * from './adapters/shared'
export * from './adapters/cmux'
export * from './adapters/tmux'
export * from './adapters/ghostty'
export * from './adapters/terminal-app'
export * from './adapters/iterm2'
export * from './adapters/index'
