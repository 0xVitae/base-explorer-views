// Base Explorer Views — show .base file views in the file explorer sidebar
const { Plugin, parseYaml, Menu, Notice } = require("obsidian");

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
const VIEW_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect></svg>`;

// DOM selectors — matches what Obsidian Bases uses internally
const SEL_VIEWS_MENU = ".bases-toolbar-views-menu";
const SEL_MENU = ".menu";
const SEL_MENU_ITEM = ".menu-item, .bases-toolbar-menu-item";
const SEL_MENU_ITEM_TITLE = ".menu-item-title, .bases-toolbar-menu-item-name";

// --- Pointer event simulation (required — .click() alone doesn't work with Bases) ---

function getCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function dispatchPointerEvent(el, type, coords) {
  const win = el.ownerDocument?.defaultView || window;
  const opts = { bubbles: true, cancelable: true, view: win, clientX: coords.x, clientY: coords.y, screenX: coords.x, screenY: coords.y };
  if (type.startsWith("pointer") && typeof PointerEvent === "function") {
    el.dispatchEvent(new PointerEvent(type, { ...opts, pointerId: 1, pointerType: "mouse" }));
  } else {
    el.dispatchEvent(new MouseEvent(type, opts));
  }
}

function simulateClick(el) {
  const coords = getCenter(el);
  dispatchPointerEvent(el, "pointerdown", coords);
  dispatchPointerEvent(el, "mousedown", coords);
  dispatchPointerEvent(el, "pointerup", coords);
  dispatchPointerEvent(el, "mouseup", coords);
  dispatchPointerEvent(el, "click", coords);
}

function getClickableChild(el) {
  return el.querySelector("button, .clickable-icon, .text-icon-button, [role='button']") || el;
}

// --- Plugin ---

class BaseExplorerViewsPlugin extends Plugin {
  constructor() {
    super(...arguments);
    this.injectedBases = new Map();
    this.observer = null;
    this.debounceTimer = null;
  }

  async onload() {
    this.app.workspace.onLayoutReady(() => this.debouncedScan());
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.debouncedScan();
      setTimeout(() => this.updateActiveState(), 300);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      setTimeout(() => this.updateActiveState(), 300);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file.path.endsWith(".base")) this.refreshBase(file.path);
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file.path.endsWith(".base")) setTimeout(() => this.debouncedScan(), 300);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file.path.endsWith(".base")) this.removeBase(file.path);
    }));

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!file.path.endsWith(".base")) return;
        menu.addItem((item) => {
          item.setTitle("New View");
          item.setIcon("plus");
          item.onClick(() => this.openBaseFile(file.path));
        });
      })
    );

    this.setupExplorerObserver();
  }

  onunload() {
    for (const [, data] of this.injectedBases) this.cleanupBaseEl(data);
    this.injectedBases.clear();
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
  }

  debouncedScan() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.scanAndInject(), 150);
  }

  setupExplorerObserver() {
    const check = () => {
      const el = this.getFileExplorerEl();
      if (!el) { setTimeout(check, 1000); return; }
      this.observer = new MutationObserver(() => this.debouncedScan());
      this.observer.observe(el, { childList: true, subtree: true });
    };
    setTimeout(check, 500);
  }

  getFileExplorerEl() {
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    return leaves.length > 0 ? leaves[0].view.containerEl : null;
  }

  // --- Active state ---

  updateActiveState() {
    const activeLeaf = this.app.workspace.activeLeaf;
    const activeFile = activeLeaf?.view?.file;
    let currentBasePath = null;
    let currentViewName = null;

    if (activeFile?.path?.endsWith(".base")) {
      currentBasePath = activeFile.path;
      // Read current view from the Bases controller or toolbar
      const controller = activeLeaf.view?.controller;
      if (controller?.viewName) {
        currentViewName = controller.viewName;
      } else {
        const containerEl = activeLeaf.view?.containerEl;
        if (containerEl) {
          const label = containerEl.querySelector(SEL_VIEWS_MENU + " .text-button-label");
          if (label) currentViewName = label.textContent?.trim() || null;
        }
      }
    }

    for (const [path, data] of this.injectedBases) {
      const viewItems = data.childrenEl.querySelectorAll(".bev-view-item");
      viewItems.forEach((item) => {
        const name = item.querySelector(".bev-view-name")?.textContent?.trim();
        const isActive = path === currentBasePath && name === currentViewName;
        item.classList.toggle("bev-active", isActive);
      });
    }
  }

  // --- Scan and inject ---

  scanAndInject() {
    const explorerEl = this.getFileExplorerEl();
    if (!explorerEl) return;

    const navFiles = explorerEl.querySelectorAll(".nav-file");
    const seenPaths = new Set();

    for (const navFile of navFiles) {
      const titleEl = navFile.querySelector(".nav-file-title");
      if (!titleEl) continue;
      const path = titleEl.getAttribute("data-path");
      if (!path || !path.endsWith(".base")) continue;
      seenPaths.add(path);

      const existing = this.injectedBases.get(path);
      if (existing && existing.chevron.isConnected && existing.childrenEl.isConnected) continue;
      if (existing) this.cleanupBaseEl(existing);
      this.injectBase(navFile, titleEl, path);
    }

    for (const [path, data] of this.injectedBases) {
      if (!seenPaths.has(path)) {
        this.cleanupBaseEl(data);
        this.injectedBases.delete(path);
      }
    }
  }

  async injectBase(navFileEl, titleEl, basePath) {
    const views = await this.parseBaseViews(basePath);
    if (!views || views.length === 0) return;

    const chevron = document.createElement("span");
    chevron.className = "bev-chevron";
    chevron.innerHTML = CHEVRON_SVG;
    const titleContent = titleEl.querySelector(".nav-file-title-content");
    if (titleContent) titleEl.insertBefore(chevron, titleContent);
    else titleEl.prepend(chevron);

    const childrenEl = document.createElement("div");
    childrenEl.className = "bev-children";

    for (const view of views) {
      childrenEl.appendChild(this.createViewItem(basePath, view.name));
    }

    navFileEl.after(childrenEl);

    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isOpen = childrenEl.classList.toggle("bev-expanded");
      chevron.classList.toggle("bev-chevron-open", isOpen);
    });

    this.injectedBases.set(basePath, { navFileEl, childrenEl, chevron, views });
    this.updateActiveState();
  }

  createViewItem(basePath, viewName) {
    const el = document.createElement("div");
    el.className = "bev-view-item";
    el.innerHTML = `<span class="bev-view-icon">${VIEW_ICON_SVG}</span><span class="bev-view-name">${this.escapeHtml(viewName)}</span>`;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.openBaseView(basePath, viewName);
    });
    el.addEventListener("contextmenu", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.showViewContextMenu(e, basePath, viewName);
    });
    return el;
  }

  showViewContextMenu(event, basePath, viewName) {
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle("Open view");
      item.setIcon("arrow-right");
      item.onClick(() => this.openBaseView(basePath, viewName));
    });

    menu.addItem((item) => {
      item.setTitle("Duplicate view");
      item.setIcon("copy");
      item.onClick(() => this.duplicateView(basePath, viewName));
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle("Delete view");
      item.setIcon("trash");
      item.onClick(() => this.deleteView(basePath, viewName));
    });

    menu.showAtMouseEvent(event);
  }

  async duplicateView(basePath, viewName) {
    try {
      const file = this.app.vault.getAbstractFileByPath(basePath);
      if (!file) return;
      const content = await this.app.vault.read(file);
      const parsed = parseYaml(content);
      if (!parsed?.views) return;

      const sourceView = parsed.views.find((v) => v.name === viewName);
      if (!sourceView) return;

      const copy = JSON.parse(JSON.stringify(sourceView));
      copy.name = `${viewName} (copy)`;
      delete copy.id;
      parsed.views.push(copy);

      // Rebuild YAML manually to preserve structure
      const { stringifyYaml } = require("obsidian");
      await this.app.vault.modify(file, stringifyYaml(parsed));
      new Notice(`Duplicated "${viewName}"`);
    } catch (e) {
      new Notice(`Failed to duplicate view: ${e.message}`);
    }
  }

  async deleteView(basePath, viewName) {
    try {
      const file = this.app.vault.getAbstractFileByPath(basePath);
      if (!file) return;
      const content = await this.app.vault.read(file);
      const parsed = parseYaml(content);
      if (!parsed?.views) return;

      const idx = parsed.views.findIndex((v) => v.name === viewName);
      if (idx === -1) return;

      if (parsed.views.length <= 1) {
        new Notice("Can't delete the only view");
        return;
      }

      parsed.views.splice(idx, 1);

      const { stringifyYaml } = require("obsidian");
      await this.app.vault.modify(file, stringifyYaml(parsed));
      new Notice(`Deleted "${viewName}"`);
    } catch (e) {
      new Notice(`Failed to delete view: ${e.message}`);
    }
  }

  // --- View switching (uses pointer simulation like base-views plugin) ---

  async openBaseView(basePath, viewName) {
    await this.app.workspace.openLinkText(basePath, "", false);
    await this.sleep(500);

    const leaf = this.findBaseLeaf(basePath);
    if (!leaf) return;

    const containerEl = leaf.view?.containerEl;
    if (!containerEl) return;

    // Check if already on the correct view
    const controller = leaf.view?.controller;
    const currentName = controller?.viewName ||
      containerEl.querySelector(SEL_VIEWS_MENU + " .text-button-label")?.textContent?.trim();

    if (currentName === viewName) {
      this.updateActiveState();
      return;
    }

    // Find the dropdown trigger button
    const dropdownEl = containerEl.querySelector(SEL_VIEWS_MENU);
    if (!dropdownEl) return;

    const button = getClickableChild(dropdownEl);

    // Count existing menus so we can detect when a new one opens
    const menuCountBefore = document.querySelectorAll(SEL_MENU).length;

    // Simulate click on the dropdown button
    simulateClick(button);

    // Wait for menu to appear
    const menu = await this.waitForMenu(menuCountBefore);
    if (!menu) return;

    // Find the menu item matching our view name
    const menuItem = this.findMenuItem(menu, viewName);
    if (menuItem) {
      simulateClick(menuItem);
      await this.sleep(200);
      this.updateActiveState();
    } else {
      // Close menu if view not found
      simulateClick(button);
    }
  }

  async waitForMenu(countBefore) {
    for (let i = 0; i < 30; i++) {
      await this.sleep(50);
      const menus = document.querySelectorAll(SEL_MENU);
      if (menus.length > countBefore) {
        return menus[menus.length - 1];
      }
    }
    return null;
  }

  findMenuItem(menu, viewName) {
    const normalized = viewName.trim().toLowerCase();
    const items = menu.querySelectorAll(SEL_MENU_ITEM);
    let best = null;
    let bestScore = 0;

    for (const item of items) {
      const titleEl = item.querySelector(SEL_MENU_ITEM_TITLE);
      const text = (titleEl || item).textContent?.trim() || "";
      const textLower = text.toLowerCase();

      // Remove checkmark prefix if present
      const cleaned = textLower.replace(/^[✓✔]\s*/, "");

      let score = 0;
      if (cleaned === normalized) score = 3;
      else if (cleaned.includes(normalized)) score = 2;
      else if (normalized.includes(cleaned) && cleaned.length > 0) score = 1;

      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  findBaseLeaf(basePath) {
    for (const leaf of this.app.workspace.getLeavesOfType("bases")) {
      if (leaf.view?.file?.path === basePath) return leaf;
    }
    const active = this.app.workspace.activeLeaf;
    if (active?.view?.file?.path === basePath) return active;
    return null;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- Helpers ---

  async refreshBase(basePath) {
    const data = this.injectedBases.get(basePath);
    if (!data) { setTimeout(() => this.debouncedScan(), 200); return; }

    const views = await this.parseBaseViews(basePath);
    if (!views || views.length === 0) {
      this.cleanupBaseEl(data);
      this.injectedBases.delete(basePath);
      return;
    }

    const wasExpanded = data.childrenEl.classList.contains("bev-expanded");
    data.childrenEl.querySelectorAll(".bev-view-item").forEach((el) => el.remove());

    for (const view of views) {
      data.childrenEl.appendChild(this.createViewItem(basePath, view.name));
    }
    data.views = views;

    if (wasExpanded) {
      data.childrenEl.classList.add("bev-expanded");
      data.chevron.classList.add("bev-chevron-open");
    }
    this.updateActiveState();
  }

  removeBase(basePath) {
    const data = this.injectedBases.get(basePath);
    if (data) { this.cleanupBaseEl(data); this.injectedBases.delete(basePath); }
  }

  cleanupBaseEl(data) {
    if (data.chevron?.parentNode) data.chevron.remove();
    if (data.childrenEl?.parentNode) data.childrenEl.remove();
  }

  async parseBaseViews(basePath) {
    try {
      const file = this.app.vault.getAbstractFileByPath(basePath);
      if (!file) return null;
      const content = await this.app.vault.cachedRead(file);
      const parsed = parseYaml(content);
      if (!parsed || !Array.isArray(parsed.views)) return null;
      return parsed.views.filter((v) => v && v.name).map((v) => ({ name: v.name, type: v.type || "table" }));
    } catch (e) {
      return null;
    }
  }

  async openBaseFile(basePath) {
    await this.app.workspace.openLinkText(basePath, "", false);
    await this.sleep(500);

    // Open the views dropdown so the user can click "New view"
    const leaf = this.findBaseLeaf(basePath);
    if (!leaf) return;
    const containerEl = leaf.view?.containerEl;
    if (!containerEl) return;

    const dropdownEl = containerEl.querySelector(SEL_VIEWS_MENU);
    if (!dropdownEl) return;

    simulateClick(getClickableChild(dropdownEl));
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
}

module.exports = BaseExplorerViewsPlugin;
