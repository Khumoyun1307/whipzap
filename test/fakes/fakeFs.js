// In-memory fs with the promise API surface config.js uses. Errors are shaped like Node's (err.code).

function enoent(p) {
  const err = new Error(`ENOENT: no such file or directory, '${p}'`);
  err.code = 'ENOENT';
  return err;
}

export function createFakeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set();
  return {
    files,
    dirs,
    async readFile(p) {
      if (!files.has(p)) throw enoent(p);
      return files.get(p);
    },
    async writeFile(p, data) {
      files.set(p, String(data));
    },
    async rename(from, to) {
      if (!files.has(from)) throw enoent(from);
      files.set(to, files.get(from));
      files.delete(from);
    },
    async mkdir(p) {
      dirs.add(p);
    },
  };
}
