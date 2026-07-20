const fs = require('fs');
let c = fs.readFileSync('components/builder/workbench.tsx', 'utf8');
const lines = c.split('\n');

// Find and fix the duplicate catch block
// The issue is at line 495-528 area
// We need to remove lines 511-525 (the duplicate)

let startRemove = -1;
let endRemove = -1;

for (let i = 490; i < 530; i++) {
  if (lines[i].includes('} catch (error)')) {
    // Found the catch block, now find the first good block
    let firstBlockEnd = -1;
    let braceCount = 0;
    for (let j = i; j < Math.min(i + 30, lines.length); j++) {
      for (const ch of lines[j]) {
        if (ch === '{') braceCount++;
        if (ch === '}') braceCount--;
      }
      if (braceCount === 0) {
        firstBlockEnd = j;
        break;
      }
    }
    
    // Now check if there's a duplicate after the first block
    if (firstBlockEnd > 0 && firstBlockEnd + 1 < lines.length) {
      // The duplicate starts at firstBlockEnd + 1
      // But we need to find where it ends
      startRemove = firstBlockEnd + 1;
      
      // Find the end of the duplicate
      let dupEnd = -1;
      braceCount = 0;
      for (let j = startRemove; j < Math.min(startRemove + 20, lines.length); j++) {
        for (const ch of lines[j]) {
          if (ch === '{') braceCount++;
          if (ch === '}') braceCount--;
        }
        if (braceCount === 0) {
          dupEnd = j;
          break;
        }
      }
      
      if (dupEnd > 0) {
        endRemove = dupEnd;
      }
    }
    break;
  }
}

if (startRemove >= 0 && endRemove >= 0) {
  console.log('Removing duplicate lines', startRemove + 1, 'to', endRemove + 1);
  lines.splice(startRemove, endRemove - startRemove + 1);
  fs.writeFileSync('components/builder/workbench.tsx', lines.join('\n'), 'utf8');
  console.log('Fixed');
} else {
  console.log('Could not find duplicate block');
}
