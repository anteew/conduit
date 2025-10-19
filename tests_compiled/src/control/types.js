export function encodeFrame(f) { return JSON.stringify(f) + '\n'; }
export function decodeLines(buf, onFrame) {
    let start = 0;
    while (true) {
        const idx = buf.indexOf('\n', start);
        if (idx === -1)
            break;
        const line = buf.slice(start, idx);
        start = idx + 1;
        if (!line.trim())
            continue;
        try {
            onFrame(JSON.parse(line));
        }
        catch { }
    }
    return buf.slice(start);
}
