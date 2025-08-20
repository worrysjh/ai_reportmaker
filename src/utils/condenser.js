export function condense(events) {
  const important = [];
  const minor = [];
  for (const e of events) {
    const t = (e.title || "").toLowerCase();
    if (/^(chore|docs|style|typo)/.test(t)) minor.push(e);
    else important.push(e);
  }
  return { important, minor };
}
