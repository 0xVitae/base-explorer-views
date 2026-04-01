# Base Explorer Views

An Obsidian plugin that shows Base views as expandable children in the file explorer sidebar.

## What it does

Click the chevron next to any `.base` file in your sidebar to see its views listed underneath — like folders show their contents. Click a view name to open the Base directly to that view.

## Features

- Expandable view list under each `.base` file in the file explorer
- Click a view to open the Base and switch to it
- Active view is highlighted in the sidebar
- Auto-updates when views are added or removed from a Base
- "New View" option in the right-click context menu for `.base` files
- Survives navigation — re-injects if the DOM is rebuilt

## Install

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `base-explorer-views` in your vault's `.obsidian/plugins/` directory
3. Copy the three files into that folder
4. Restart Obsidian
5. Enable the plugin in Settings → Community Plugins

### From source

```bash
git clone https://github.com/0xVitae/base-explorer-views.git
cp -r base-explorer-views ~/.obsidian/plugins/base-explorer-views
```

No build step required — the plugin is plain JavaScript.

## How it works

The plugin observes the file explorer for `.base` files, parses their YAML to extract view names, and injects expandable UI elements into the sidebar. View switching uses pointer event simulation to interact with Obsidian's native Bases dropdown, matching the approach used by other Bases-compatible plugins.

## Compatibility

- Obsidian 1.10.0+
- Works alongside Dynamic Views, Base Views, and other Bases plugins
- Desktop only

## License

MIT
