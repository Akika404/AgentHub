const GIT_QUOTED_PATH_RE = /^"(?:[^"\\]|\\.)*"$/
const GIT_ESCAPE_RE = /\\(?:[0-7]{1,3}|["\\abfnrtv])/

export function decodeGitQuotedPath(path: string): string {
    if (!GIT_QUOTED_PATH_RE.test(path) || !GIT_ESCAPE_RE.test(path)) return path

    const inner = path.slice(1, -1)
    let decoded = ''
    let bytes: number[] = []

    const flushBytes = (): void => {
        if (bytes.length === 0) return
        decoded += Buffer.from(bytes).toString('utf8')
        bytes = []
    }

    for (let i = 0; i < inner.length; ) {
        const char = inner[i]
        if (char !== '\\') {
            flushBytes()
            decoded += char
            i += 1
            continue
        }

        const next = inner[i + 1]
        if (!next) {
            flushBytes()
            decoded += char
            i += 1
            continue
        }

        if (/[0-7]/.test(next)) {
            let octal = next
            let j = i + 2
            while (j < inner.length && octal.length < 3 && /[0-7]/.test(inner[j])) {
                octal += inner[j]
                j += 1
            }
            bytes.push(Number.parseInt(octal, 8))
            i = j
            continue
        }

        flushBytes()
        const escapes: Record<string, string> = {
            '"': '"',
            '\\': '\\',
            a: '\u0007',
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
            v: '\v'
        }
        decoded += escapes[next] ?? next
        i += 2
    }

    flushBytes()
    return decoded
}
