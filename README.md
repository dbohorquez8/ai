# ai

David Bohórquez's Claude Code plugins: mods, skills and hooks.

## Install

```sh
claude plugin marketplace add dbohorquez8/ai
claude plugin install <plugin>@dbohorquez
```

## Plugins

| Plugin | What it does |
| --- | --- |
| [Bridge](plugins/bridge/README.md) | A pane beside your chat that lists every Claude session on this machine, shows which ones are working, done or need you, and chimes when one asks you something. Open it with `/bridge`. |
| [Reply style](plugins/reply-style/README.md) | Draws replies that use the **Read** and **Needs You** markers as bars in the terminal: an accent bar on the opening, a red bar on the action block, a green, yellow or plain bar on the closing Waiting / Working / Done line. Every other reply shows as usual. |

## License

MIT, see [LICENSE](LICENSE). Plugins that adapt code from other MIT projects list those notices in their own `THIRD_PARTY_NOTICES.md`.
