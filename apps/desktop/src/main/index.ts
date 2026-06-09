import { app, shell, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { basename, join, relative, sep } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { ImportLocalSkillFolderPayload, LocalSkillFolderFile } from '@agenthub/shared'
import icon from '../../resources/icon.png?asset'
import { registerApiProxy } from './api-proxy'
import { registerPreviewProtocol, registerPreviewScheme } from './preview-protocol'

// Must run before app `ready`: privileged schemes can only be declared early.
registerPreviewScheme()

const MAX_LOCAL_SKILL_IMPORT_BYTES = 20 * 1024 * 1024
const MAX_LOCAL_SKILL_IMPORT_FILE_BYTES = 5 * 1024 * 1024
const MAX_LOCAL_SKILL_IMPORT_FILES = 300
const SKIPPED_LOCAL_SKILL_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '.gradle',
  '.idea'
])
const SKIPPED_LOCAL_SKILL_FILES = new Set(['.DS_Store'])

async function collectLocalSkillFolder(
  directory: string
): Promise<ImportLocalSkillFolderPayload> {
  const root = directory
  const files: LocalSkillFolderFile[] = []
  let totalSize = 0

  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIPPED_LOCAL_SKILL_DIRECTORIES.has(entry.name)) continue
        await visit(path)
        continue
      }
      if (!entry.isFile() || SKIPPED_LOCAL_SKILL_FILES.has(entry.name)) continue

      const info = await stat(path)
      if (info.size > MAX_LOCAL_SKILL_IMPORT_FILE_BYTES) {
        throw new Error(`文件过大，无法导入：${entry.name}`)
      }
      totalSize += info.size
      if (totalSize > MAX_LOCAL_SKILL_IMPORT_BYTES) {
        throw new Error('Skill 文件夹过大，无法导入')
      }
      if (files.length >= MAX_LOCAL_SKILL_IMPORT_FILES) {
        throw new Error('Skill 文件夹文件数量过多，无法导入')
      }

      const relativePath = relative(root, path).split(sep).join('/')
      const data = await readFile(path)
      files.push({
        relativePath,
        contentBase64: data.toString('base64'),
        size: data.length
      })
    }
  }

  await visit(root)
  if (files.length === 0) {
    throw new Error('所选文件夹没有可导入的文件')
  }
  return {
    folderName: basename(root),
    files
  }
}

function registerDialogHandlers(): void {
  ipcMain.handle('dialog:select-directory', async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('dialog:select-directories', async (event): Promise<string[]> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory', 'multiSelections']
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(
    'dialog:import-local-skill-folder',
    async (event): Promise<ImportLocalSkillFolderPayload | null> => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        properties: ['openDirectory']
      }
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled) return null
      const directory = result.filePaths[0]
      return directory ? collectLocalSkillFolder(directory) : null
    }
  )
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Backend REST calls funnel through the main process (avoids renderer CORS).
  registerApiProxy()
  registerPreviewProtocol()
  registerDialogHandlers()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
