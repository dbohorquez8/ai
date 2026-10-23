# dbohorquez8/ai

Claude Code mods by dbohorquez8: a sessions pane and a reply format you can scan.

## Plugins

| Plugin | Gets you | Looks like | Install |
| --- | --- | --- | --- |
| [**Bridge**](plugins/bridge/README.md) | A pane beside your chat that shows which Claude Code session needs an answer, is working, or is done. | <img src="plugins/bridge/assets/card-needs-you.png" alt="A Bridge card for billing-api with a red Needs you pill, its title, branch and model" width="400"> | `claude plugin install bridge@dbohorquez` |
| [**reply-style**](plugins/reply-style/README.md) | Replies whose answer, question and next step show as colored bars you find at a glance. | <img src="plugins/reply-style/assets/needs-you.png" alt="A reply with a blue Read bar on its opening sentence and a red Needs You block asking two lettered-option questions" width="289"> | `claude plugin install reply-style@dbohorquez` |

## Add the marketplace

```sh
claude plugin marketplace add dbohorquez8/ai
```

Then install a plugin with the command in its row above, and start a new Claude Code session.

## Licence and credits

MIT, see [LICENSE](LICENSE). A plugin that adapts code from other projects lists their notices in its own `THIRD_PARTY_NOTICES.md`. Not affiliated with or endorsed by Anthropic.
