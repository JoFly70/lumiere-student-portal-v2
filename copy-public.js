import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Copy server/public to dist/server/public
const src = path.join(__dirname, 'server', 'public');
const dest = path.join(__dirname, 'dist', 'server', 'public');

if (fs.existsSync(src)) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log('✓ Copied server/public to dist/server/public');
} else {
  console.log('⚠ server/public not found');
}
