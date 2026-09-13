// An owned service must stop if its supervisor disappears, including SIGKILL.
import { pathToFileURL } from 'node:url';
const entry = process.argv[2];
if (!entry || !process.send) throw new Error('Managed services require a supervisor.');
process.once('disconnect', () => {
  const deadline = setTimeout(() => process.exit(1), 15_000);
  deadline.unref();
  process.kill(process.pid, 'SIGTERM');
});
await import(pathToFileURL(entry).href);
