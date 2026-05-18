# Pi dotfiles

Symlinked into `~/.pi/agent`:

- `settings.json`
- `keybindings.json` if present
- `models.json` if present
- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

Do not store `auth.json`, `sessions/`, package caches, or other secrets here.

## Restore/bootstrap

After Pi packages are installed, run:

```bash
~/Documents/Repos/dotfiles/pi/bootstrap.sh
```

This recreates ignored local `node_modules` links needed by custom extensions, including `plan-mode` → `@juicesharp/rpiv-todo`.
