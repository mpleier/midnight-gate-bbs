'use strict';
// Minimal RFC6455 WebSocket server (no dependencies) for the web terminal.
const crypto = require('node:crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

class WSConnection {
  constructor(socket, req, opts = {}) {
    this.socket = socket;
    this.req = req;
    this.closed = false;
    this.buf = Buffer.alloc(0);
    this.onMessage = () => {};
    this.onClose = () => {};
    // proxies and tunnels (Cloudflare, ngrok, a home router's NAT table) drop a
    // socket that has been silent for a while: a caller reading the main menu
    // never sends anything, so the board pings on its own and the browser's
    // automatic pong keeps both directions warm.
    this.lastSeen = Date.now();
    this.pingMs = Number(opts.pingMs) || 0;
    if (this.pingMs > 0) {
      this.pingTimer = setInterval(() => this._ping(), this.pingMs);
      if (this.pingTimer.unref) this.pingTimer.unref(); // a test run must still exit
    }
    socket.on('data', (d) => this._read(d));
    socket.on('close', () => this._close());
    socket.on('error', () => this._close());
  }

  _ping() {
    if (this.closed) return;
    // three silent intervals means the far end is gone, whatever the TCP state says
    if (Date.now() - this.lastSeen > this.pingMs * 3) return this.close();
    this.socket.write(frame(Buffer.alloc(0), 9));
  }

  _read(data) {
    this.lastSeen = Date.now();
    this.buf = Buffer.concat([this.buf, data]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        offset = 10;
      }
      const maskKey = masked ? this.buf.slice(offset, offset + 4) : null;
      if (masked) offset += 4;
      if (this.buf.length < offset + len) return;
      let payload = this.buf.slice(offset, offset + len);
      if (masked) {
        const copy = Buffer.alloc(len);
        for (let i = 0; i < len; i++) copy[i] = payload[i] ^ maskKey[i % 4];
        payload = copy;
      }
      this.buf = this.buf.slice(offset + len);
      if (opcode === 8) {
        this.close();
        return;
      }
      if (opcode === 9) {
        this.socket.write(frame(payload, 10));
        continue;
      }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 2) {
        try {
          this.onMessage(payload.toString('utf8'));
        } catch {}
      }
    }
  }

  send(str) {
    if (this.closed || !this.socket.writable) return;
    this.socket.write(frame(str, 1));
  }

  ping() {
    if (this.closed || !this.socket.writable) return;
    this.socket.write(frame(Buffer.alloc(0), 9));
  }

  close() {
    if (this.closed) return;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.socket.write(frame(Buffer.alloc(0), 8));
    } catch {}
    this.closed = true;
    try {
      this.socket.end();
    } catch {}
    this.onClose();
  }

  _close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.onClose();
  }
}

function attachWebSocket(server, path = '/ws', onConnection = () => {}, opts = {}) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const conn = new WSConnection(socket, req, opts);
    onConnection(conn, url);
  });
}

module.exports = { attachWebSocket, WSConnection };
