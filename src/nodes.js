'use strict';
// Node pool + shared event bus (chat, sysop pages, activity feed).
const { EventEmitter } = require('node:events');

class Nodes {
  constructor() {
    this.nodes = new Map(); // node -> terminal
    this.phantoms = new Map(); // bot handle -> {handle, activity, since, level, location}
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(200);
    this.activity = [];
  }

  addPhantom(handle, info = {}) {
    this.phantoms.set(handle, {
      handle,
      activity: info.activity || 'Reading messages',
      since: info.since || Date.now(),
      level: info.level || 50,
      location: info.location || 'Local',
      bot: true,
    });
    this.bus.emit('node-change', this.online());
  }

  removePhantom(handle) {
    if (this.phantoms.delete(handle)) this.bus.emit('node-change', this.online());
  }

  allocate(term, maxNodes) {
    for (let n = 1; n <= maxNodes; n++) {
      if (!this.nodes.has(n)) {
        term.node = n;
        this.nodes.set(n, term);
        term.on('hangup', () => this.release(n, term));
        return n;
      }
    }
    return null;
  }

  release(node, term) {
    if (this.nodes.get(node) === term) {
      this.nodes.delete(node);
      this.bus.emit('node-change', this.online());
    }
  }

  update(node, patch) {
    const t = this.nodes.get(node);
    if (t) Object.assign(t, patch);
    this.bus.emit('node-change', this.online());
  }

  online() {
    const rows = [...this.nodes.entries()]
      .map(([node, t]) => ({
        node,
        kind: t.kind,
        handle: t.user ? t.user.handle : (t.handle || 'Visiting'),
        activity: t.activity || 'At the main menu',
        since: t.connectedAt,
        minutes: Math.max(0, Math.floor((Date.now() - t.connectedAt) / 60000)),
        location: t.user ? [t.user.city, t.user.state].filter(Boolean).join(', ') : 'Unknown',
        level: t.user ? t.user.level : 0,
        bot: !!t.bot,
      }))
      .sort((a, b) => a.node - b.node);
    let next = rows.length ? Math.max(...rows.map((r) => r.node)) : 0;
    for (const p of this.phantoms.values()) {
      rows.push({
        node: ++next,
        kind: 'phantom',
        handle: p.handle,
        activity: p.activity,
        since: p.since,
        minutes: Math.max(0, Math.floor((Date.now() - p.since) / 60000)),
        location: p.location,
        level: p.level,
        bot: true,
        phantom: true,
      });
    }
    return rows;
  }


  count() {
    return this.nodes.size;
  }
}

module.exports = new Nodes();
