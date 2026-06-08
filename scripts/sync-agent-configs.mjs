#!/usr/bin/env node

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const SYNC_PAIRS = [
  ['.claude/rules', '.agents/rules'],
  ['.claude/skills', '.agents/skills'],
  ['.claude/rules', '.codex/rules'],
  ['.claude/skills', '.codex/skills'],
  ['.claude/rules', '.trae/rules']
]

const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')

if (args.has('-h') || args.has('--help')) {
  console.log(`Usage:
  node scripts/sync-agent-configs.mjs
  node scripts/sync-agent-configs.mjs --check

Copies shared agent rules and skills from .claude into the tool-specific
directories. Trae skills are intentionally not copied because Trae discovers
.agents/skills automatically.`)
  process.exit(0)
}

function resolveRepoPath(relativePath) {
  return path.join(ROOT, relativePath)
}

async function assertSourceDirectory(relativePath) {
  const absolutePath = resolveRepoPath(relativePath)
  if (!existsSync(absolutePath)) {
    throw new Error(`Source directory does not exist: ${relativePath}`)
  }

  const stat = await fs.stat(absolutePath)
  if (!stat.isDirectory()) {
    throw new Error(`Source path is not a directory: ${relativePath}`)
  }
}

async function copyDirectory(sourceRelativePath, targetRelativePath) {
  const source = resolveRepoPath(sourceRelativePath)
  const target = resolveRepoPath(targetRelativePath)

  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.cp(source, target, { recursive: true })
}

async function collectFiles(directory, base = directory) {
  const files = new Map()
  const entries = await fs.readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    const relativePath = path.relative(base, absolutePath)

    if (entry.isDirectory()) {
      const childFiles = await collectFiles(absolutePath, base)
      for (const [key, value] of childFiles) {
        files.set(key, value)
      }
      continue
    }

    if (entry.isSymbolicLink()) {
      files.set(relativePath, {
        type: 'symlink',
        value: await fs.readlink(absolutePath)
      })
      continue
    }

    files.set(relativePath, {
      type: 'file',
      value: await fs.readFile(absolutePath)
    })
  }

  return files
}

function describeList(items) {
  const preview = items.slice(0, 8).join(', ')
  return items.length > 8 ? `${preview}, ...` : preview
}

function compareTrees(sourceFiles, targetFiles) {
  const diffs = []
  const sourcePaths = [...sourceFiles.keys()].sort()
  const targetPaths = [...targetFiles.keys()].sort()
  const sourceSet = new Set(sourcePaths)
  const targetSet = new Set(targetPaths)

  const missing = sourcePaths.filter((file) => !targetSet.has(file))
  const extra = targetPaths.filter((file) => !sourceSet.has(file))

  if (missing.length > 0) {
    diffs.push(`missing in target: ${describeList(missing)}`)
  }
  if (extra.length > 0) {
    diffs.push(`extra in target: ${describeList(extra)}`)
  }

  for (const file of sourcePaths) {
    if (!targetSet.has(file)) continue

    const source = sourceFiles.get(file)
    const target = targetFiles.get(file)

    if (source.type !== target.type) {
      diffs.push(`type differs: ${file}`)
      continue
    }

    if (Buffer.isBuffer(source.value) && Buffer.isBuffer(target.value)) {
      if (!source.value.equals(target.value)) {
        diffs.push(`content differs: ${file}`)
      }
      continue
    }

    if (source.value !== target.value) {
      diffs.push(`symlink differs: ${file}`)
    }
  }

  return diffs
}

async function checkDirectory(sourceRelativePath, targetRelativePath) {
  const source = resolveRepoPath(sourceRelativePath)
  const target = resolveRepoPath(targetRelativePath)

  if (!existsSync(target)) {
    return [`target directory does not exist: ${targetRelativePath}`]
  }

  const [sourceFiles, targetFiles] = await Promise.all([collectFiles(source), collectFiles(target)])
  return compareTrees(sourceFiles, targetFiles)
}

async function main() {
  for (const [source] of SYNC_PAIRS) {
    await assertSourceDirectory(source)
  }

  if (checkOnly) {
    const failures = []

    for (const [source, target] of SYNC_PAIRS) {
      const diffs = await checkDirectory(source, target)
      if (diffs.length > 0) {
        failures.push({ source, target, diffs })
      }
    }

    if (failures.length > 0) {
      console.error('Agent configs are out of sync with .claude.')
      for (const failure of failures) {
        console.error(`\n${failure.source} -> ${failure.target}`)
        for (const diff of failure.diffs) {
          console.error(`  - ${diff}`)
        }
      }
      console.error('\nRun `pnpm sync:agent-configs` to update generated copies.')
      process.exit(1)
    }

    console.log('Agent configs are in sync with .claude.')
    return
  }

  for (const [source, target] of SYNC_PAIRS) {
    await copyDirectory(source, target)
    console.log(`synced ${source} -> ${target}`)
  }

  console.log('Trae skills are provided through .agents/skills.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
