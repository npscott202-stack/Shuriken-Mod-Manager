// Run an external program, capture its output, and enforce a timeout.
const { spawn } = require('child_process');

function run(exe, args, { cwd, timeoutMs = 10 * 60 * 1000, env, hidden = true } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    const child = spawn(exe, args, { cwd, env: env ? { ...process.env, ...env } : process.env, windowsHide: hidden });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${exe} timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);
    const collect = (d) => {
      out += d.toString();
      if (out.length > 400000) out = out.slice(-200000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output: out });
    });
  });
}

function tail(text, lines = 120) {
  return String(text || '').split(/\r?\n/).slice(-lines).join('\n');
}

module.exports = { run, tail };
