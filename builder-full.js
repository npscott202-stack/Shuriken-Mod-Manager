// Installer build with the built-in AI (llama.cpp engine + Qwen3-VL 2B) in resources\ai, so the
// assistant works offline right after install. The portable build stays small and downloads it.
// Stage the files with: npm run ai:bundle (see scripts/bundle-ai.js).
const base = require('./package.json').build;

module.exports = {
  ...base,
  extraResources: [
    { from: 'ai-bundle/engine', to: 'ai/engine' },
    { from: 'ai-bundle/models', to: 'ai/models', filter: ['*.gguf'] },
    { from: 'ai-bundle/NOTICE.txt', to: 'ai/NOTICE.txt' },
  ],
};
