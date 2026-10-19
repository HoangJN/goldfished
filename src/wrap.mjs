export function wrap(text, width = 80) {
  return text.split('\n').map(line => {
    const lines = [];
    while (line.length > width) {
      const start = line.search(/[^ ]/);
      let cut = line.lastIndexOf(' ', width);
      if (cut <= start) cut = line.indexOf(' ', start + 1);
      if (cut < 0 || start < 0) break;
      lines.push(line.slice(0, cut));
      line = '  ' + line.slice(cut + 1);
    }
    return [...lines, line].join('\n');
  }).join('\n');
}

export function number(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function plural(n, noun, many = noun + 's') {
  return `${number(n)} ${n === 1 ? noun : many}`;
}
export function per100(kept, total) {
  return Math.floor((200 * kept + total) / (2 * total));
}
export function size(bytes) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let unit = 0;
  while (bytes >= 1000 && unit < units.length - 1) { bytes /= 1000; unit++; }
  if (unit && Math.round(bytes * 10) >= 10000 && unit < units.length - 1) { bytes /= 1000; unit++; }
  return `${unit ? (Math.round(bytes * 10) / 10).toFixed(1) : bytes} ${units[unit]}`;
}
export function secs(s) {
  return s < 1 ? 'under 1s' : `${Math.round(s)}s`;
}
export function date(ms) {
  const d = new Date(ms), months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
