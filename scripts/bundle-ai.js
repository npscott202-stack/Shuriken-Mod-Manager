// Stages the built-in AI for the installer: the llama.cpp Vulkan server (from Shuriken's data
// folder, after the engine has been set up once) and the Qwen3-VL 2B model files.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'ai-bundle');
const data = path.join(process.env.APPDATA, 'ModForge', 'engine');
const MODEL = 'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/';
const FILES = ['Qwen3VL-2B-Instruct-Q4_K_M.gguf', 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf'];

async function main() {
  const builds = fs.readdirSync(data).filter((n) => /^b\d+$/.test(n)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  if (!builds.length) throw new Error('Set up the Shuriken AI engine once in the app first.');
  const eng = path.join(out, 'engine');
  fs.rmSync(eng, { recursive: true, force: true });
  fs.mkdirSync(eng, { recursive: true });
  for (const f of fs.readdirSync(path.join(data, builds[0]))) {
    // Only the server and its libraries; the other llama.cpp programs are not needed.
    if (/\.exe$/i.test(f) && f !== 'llama-server.exe') continue;
    if (/-impl\.dll$/i.test(f) && f !== 'llama-server-impl.dll') continue;
    fs.copyFileSync(path.join(data, builds[0], f), path.join(eng, f));
  }
  fs.mkdirSync(path.join(out, 'models'), { recursive: true });
  for (const f of FILES) {
    const dest = path.join(out, 'models', f);
    if (fs.existsSync(dest)) continue;
    console.log(`Downloading ${f}…`);
    const res = await fetch(MODEL + f);
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(`${dest}.part`, dest);
  }
  fs.writeFileSync(path.join(out, 'NOTICE.txt'), [
    'Shuriken built-in AI',
    '',
    `llama.cpp (${builds[0]}) - MIT License - https://github.com/ggml-org/llama.cpp`,
    'Qwen3-VL-2B-Instruct (GGUF) - Apache License 2.0 - https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF',
    '',
  ].join('\r\n'));
  console.log(`AI bundle ready (${builds[0]})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
