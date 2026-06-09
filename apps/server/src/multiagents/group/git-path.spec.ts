import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { decodeGitQuotedPath } from './git-path.js'

test('decodeGitQuotedPath decodes legacy git quotePath output', () => {
    assert.equal(
        decodeGitQuotedPath(
            '"\\346\\226\\207\\346\\241\\243/\\346\\265\\213\\350\\257\\225\\346\\212\\245\\345\\221\\212.md"'
        ),
        '文档/测试报告.md'
    )
})

test('decodeGitQuotedPath leaves normal paths unchanged', () => {
    assert.equal(decodeGitQuotedPath('src/report.md'), 'src/report.md')
})
