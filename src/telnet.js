'use strict';
// Telnet front door: RFC854 negotiation lite, NAWS window size, ANSI detect.
const net = require('node:net');
const Terminal = require('./terminal');

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const OPT_ECHO = 1;
const OPT_SGA = 3;
const OPT_TTYPE = 24;
const OPT_NAWS = 31;
const OPT_BINARY = 0;

function attachTelnet(server, { onConnection, log = () => {} } = {}) {
  net
    .createServer((socket) => {
      socket.setNoDelay(true);
      let cols = 80;
      let rows = 25;
      let buf = Buffer.alloc(0);
      let inSub = false;
      let subOpt = 0;
      let sub = [];

      const term = new Terminal({
        kind: 'telnet',
        remote: `${socket.remoteAddress}:${socket.remotePort}`,
        cols,
        rows,
        ansi: true,
        send: (s) => {
          if (socket.writable) socket.write(Buffer.from(s, 'utf8'));
        },
        close: () => {
          try {
            socket.end();
          } catch {}
        },
      });

      // advertise what we support
      const neg = Buffer.from([
        IAC, WILL, OPT_ECHO,
        IAC, WILL, OPT_SGA,
        IAC, DO, OPT_NAWS,
        IAC, DO, OPT_TTYPE,
        IAC, WILL, OPT_BINARY,
        IAC, DO, OPT_BINARY,
      ]);
      socket.write(neg);

      const handle = (data) => {
        buf = Buffer.concat([buf, data]);
        let i = 0;
        const out = [];
        while (i < buf.length) {
          const b = buf[i];
          if (b !== IAC) {
            if (!inSub) out.push(b);
            i++;
            continue;
          }
          const cmd = buf[i + 1];
          if (cmd === undefined) break;
          if (cmd === IAC) {
            if (!inSub) out.push(IAC);
            i += 2;
            continue;
          }
          if (cmd === SB) {
            inSub = true;
            subOpt = buf[i + 2];
            sub = [];
            i += 3;
            continue;
          }
          if (cmd === SE) {
            if (inSub && subOpt === OPT_NAWS && sub.length >= 4) {
              cols = (sub[0] << 8) | sub[1];
              rows = (sub[2] << 8) | sub[3];
              if (cols > 20 && cols < 400) term.cols = cols;
              if (rows > 8 && rows < 200) term.rows = rows;
              term.emit('resize', { cols: term.cols, rows: term.rows });
            }
            inSub = false;
            i += 2;
            continue;
          }
          if (inSub) {
            if (!(cmd === IAC && buf[i + 1] === SE)) sub.push(b);
            i++;
            continue;
          }
          if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
            const opt = buf[i + 2];
            if (opt === undefined) break;
            if (cmd === DO && (opt === OPT_NAWS || opt === OPT_TTYPE)) {
              socket.write(Buffer.from([IAC, WILL, opt]));
            }
            i += 3;
            continue;
          }
          i += 2;
        }
        buf = Buffer.from(buf.slice(i));
        if (out.length) term.feed(Buffer.from(out));
      };

      socket.on('data', handle);
      socket.on('error', () => {});
      socket.on('close', () => term.hangup('CARRIER LOST'));
      socket.on('end', () => term.hangup('CARRIER LOST'));

      log(`telnet connect from ${term.remote}`);
      onConnection(term);
    })
    .listen(server.port, server.host, () => log(`telnet listening on ${server.host}:${server.port}`));
}

module.exports = { attachTelnet };
