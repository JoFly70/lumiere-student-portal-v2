import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildApplicationEnvironment,
  StagingStartupError,
  validateStartupEnvironment,
} from './guard.mjs';

// No app module is loaded until the isolated child has its verified environment.
const mode = process.argv.slice(2);
if (mode.length !== 1 || !['--check', '--start'].includes(mode[0])) {
  console.error('Usage: node scripts/staging/start.mjs --check | --start');
  process.exitCode = 1;
} else {
  try {
    validateStartupEnvironment(process.env);
    if (mode[0] === '--check') {
      console.log('Staging startup configuration passed offline checks. No connection attempted; credential authenticity is not verified.');
    } else {
      const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: buildApplicationEnvironment(process.env),
        stdio: 'inherit',
        shell: false,
      });
      child.once('error', () => {
        console.error('Staging application process could not be launched.');
        process.exitCode = 1;
      });
      const forward = (signal) => { child.kill(signal); };
      const onTerm = () => forward('SIGTERM');
      const onInt = () => forward('SIGINT');
      process.on('SIGTERM', onTerm);
      process.on('SIGINT', onInt);
      child.once('exit', (code, signal) => {
        process.removeListener('SIGTERM', onTerm);
        process.removeListener('SIGINT', onInt);
        process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
      });
    }
  } catch (error) {
    console.error(error instanceof StagingStartupError
      ? `Staging startup refused: ${error.message}`
      : 'Staging startup refused: configuration validation failed.');
    process.exitCode = 1;
  }
}
