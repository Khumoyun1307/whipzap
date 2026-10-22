// Tiny logger. info/error always print; debug only when WHIPZAP_DEBUG=1.
// Message text typed into the target is only ever logged at debug level (docs/ARCHITECTURE.md 15).

const DEBUG = process.env.WHIPZAP_DEBUG === '1';

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  info: (...args) => console.log(`[${stamp()}] whipzap`, ...args),
  error: (...args) => console.error(`[${stamp()}] whipzap!`, ...args),
  debug: (...args) => {
    if (DEBUG) console.log(`[${stamp()}] whipzap~`, ...args);
  },
  isDebug: DEBUG,
};
