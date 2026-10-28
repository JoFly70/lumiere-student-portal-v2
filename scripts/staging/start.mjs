import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildApplicationEnvironment,
  StagingStartupError,
  validateStartupEnvironment,
} from './guard.mjs';

// No app module is loaded until the isolated child has its verified environment.
const mode = process.argv.slice(2);
// --serve (S25): the published staging deployment; runs the production build (dist/) with the same guard.
if (mode.length !== 1 || !['--check', '--start', '--serve', '--check-published'].includes(mode[0])) {
  console.error('Usage: node scripts/staging/start.mjs --check | --start | --check-published | --serve');
  process.exitCode = 1;
} else {
  try {
    const published = mode[0] === '--serve' || mode[0] === '--check-published';
    validateStartupEnvironment(process.env, { published });
    if (mode[0] === '--check' || mode[0] === '--check-published') {
      console.log('Staging startup configuration passed offline checks. No connection attempted; credential authenticity is not verified.');
    } else {
      const lifecycle = (event, fields = {}) => console.log(JSON.stringify({
        component: 'staging-launcher', event, time: new Date().toISOString(), ...fields,
      }));
      const child = spawn(process.execPath, published ? ['dist/index.js'] : ['--import', 'tsx', 'server/index.ts'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: buildApplicationEnvironment(process.env, { published }),
        stdio: 'inherit',
        shell: false,
      });
      child.once('spawn', () => lifecycle('child-started', { pid: child.pid }));
      child.once('error', () => {
        lifecycle('child-launch-failed');
        console.error('Staging application process could not be launched.');
        process.exitCode = 1;
      });
      const forward = (signal) => {
        lifecycle('launcher-signal', { signal });
        child.kill(signal);
      };
      const onTerm = () => forward('SIGTERM');
      const onInt = () => forward('SIGINT');
      process.on('SIGTERM', onTerm);
      process.on('SIGINT', onInt);
      child.once('exit', (code, signal) => {
        lifecycle('child-exited', { code, signal });
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
