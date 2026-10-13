/**
 * Loads real Apps Script src files into a sandbox so tests exercise the shipped
 * code instead of a re-implementation. All files share one script scope, which
 * mirrors how Apps Script itself evaluates a project.
 */
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');

function loadAppsScript(fileNames, exportedNames, globals) {
  const context = vm.createContext(Object.assign({ console }, globals || {}));
  const sources = fileNames.map((fileName) => fs.readFileSync(path.join(SRC_DIR, fileName), 'utf8'));
  const exportLine = `globalThis.__api = { ${exportedNames.join(', ')} };`;

  vm.runInContext([...sources, exportLine].join('\n;\n'), context, { filename: 'appsScriptBundle.js' });
  return context.__api;
}

module.exports = { loadAppsScript };
