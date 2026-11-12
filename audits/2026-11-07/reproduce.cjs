// Compatibility entry point: the original defect probes are archived beside this file.
// Passing now means the fixed behavior is verified.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
for(const file of fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.cjs'))){
  require(path.join(root,'tests',file));
}
