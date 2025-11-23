import React, { useEffect, useState, ChangeEvent } from 'react'
import './App.css'

type Platform = 'adobe' | 'freepik' | 'shutterstock' | 'general' | 'vecteezy'
type Mode = 'metadata' | 'prompt'
type FileStatus = 'pending' | 'generating' | 'success' | 'failed'

interface FileItem {
  id: string
  file: File
  previewUrl?: string
  title: string
  keywords: string
  description: string
  status: FileStatus
  error?: string
}

function normalizeTitle(raw: string): string {
  let text = raw
    .replace(/[0-9#_=+*{}\[\];:<>/\\|~`\"“”'’.,!?()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!text) return ''

  const words = text.split(' ')
  const unique: string[] = []
  const seen = new Set<string>()

  for (const w of words) {
    if (!w) continue
    if (!seen.has(w)) {
      seen.add(w)
      unique.push(w)
    }
  }

  const cleaned = unique.join(' ')
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function autoCleanKeywords(
  raw: string,
  autoRemoveDupKeywords: boolean,
  bulkKeywordExtra: string,
): string {
  const base = raw + (bulkKeywordExtra ? ',' + bulkKeywordExtra : '')
  let tokens = base
    .toLowerCase()
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean)

  if (autoRemoveDupKeywords) {
    const unique: string[] = []
    const seen = new Set<string>()
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t)
        unique.push(t)
      }
    }
    tokens = unique
  }

  return tokens.join(', ')
}

const App: React.FC = () => {
  const [email, setEmail] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const [apiKey, setApiKey] = useState('')
  const [savedApiKey, setSavedApiKey] = useState('')

  const [mode, setMode] = useState<Mode>('metadata')
  const [platform, setPlatform] = useState<Platform>('adobe')

  const [titleLength, setTitleLength] = useState(80)
  const [keywordsCount, setKeywordsCount] = useState(25)
  const [descriptionLength, setDescriptionLength] = useState(200)
  const [autoRemoveDupKeywords, setAutoRemoveDupKeywords] = useState(true)

  const [bulkKeywordEnabled, setBulkKeywordEnabled] = useState(false)
  const [bulkKeywordText, setBulkKeywordText] = useState('')

  const [prefixEnabled, setPrefixEnabled] = useState(false)
  const [suffixEnabled, setSuffixEnabled] = useState(false)
  const [prefixText, setPrefixText] = useState('')
  const [suffixText, setSuffixText] = useState('')

  const [files, setFiles] = useState<FileItem[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [generatedCount, setGeneratedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [history, setHistory] = useState<string[]>([])
  const [isGeneratingAll, setIsGeneratingAll] = useState(false)

  useEffect(() => {
    const storedKey = localStorage.getItem('csv_tool_api_key') || ''
    setApiKey(storedKey)
    setSavedApiKey(storedKey)
  }, [])

  const handleSaveApiKey = () => {
    const trimmed = apiKey.trim()
    localStorage.setItem('csv_tool_api_key', trimmed)
    setSavedApiKey(trimmed)
    addHistory('API key saved.')
  }

  const addHistory = (msg: string) => {
    setHistory((prev) => [`${new Date().toLocaleTimeString()} - ${msg}`, ...prev])
  }

  const handleLogin = () => {
    if (!email.includes('@')) {
      alert('Please enter a valid email.')
      return
    }
    setIsLoggedIn(true)
  }

  const handleLogout = () => {
    setIsLoggedIn(false)
    setEmail('')
  }

  const handleFilesAdded = (fileList: FileList | null) => {
    if (!fileList) return
    const arr = Array.from(fileList).slice(0, 1000 - files.length)

    if (arr.length === 0) return

    const total = files.length + arr.length
    let processed = files.length

    const newItems = arr.map((file, index) => {
      processed++
      const id = `${Date.now()}-${index}-${file.name}`
      const previewUrl = file.type.startsWith('image/')
        ? URL.createObjectURL(file)
        : undefined

      const item: FileItem = {
        id,
        file,
        previewUrl,
        title: '',
        keywords: '',
        description: '',
        status: 'pending',
      }

      const progress = Math.round((processed / total) * 100)
      setUploadProgress(progress)

      return item
    })

    setFiles((prev) => [...prev, ...newItems])
    addHistory(`${newItems.length} files added.`)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    handleFilesAdded(e.dataTransfer.files)
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFilesAdded(e.target.files)
  }

  const clearAll = () => {
    files.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
    })
    setFiles([])
    setUploadProgress(0)
    setGeneratedCount(0)
    setFailedCount(0)
    addHistory('All files cleared.')
  }

  const fakeGenerateMetadata = async (item: FileItem, index: number): Promise<Partial<FileItem>> => {
    const baseName = item.file.name.replace(/\.[^.]+$/, '')
    const rawTitle = `${baseName} stock image illustration`

    let title = normalizeTitle(rawTitle).slice(0, titleLength)
    if (prefixEnabled && prefixText.trim()) {
      title = `${prefixText.trim()} ${title}`.trim()
    }
    if (suffixEnabled && suffixText.trim()) {
      title = `${title} ${suffixText.trim()}`.trim()
    }

    const kwBase = `abstract vector, clean silhouette, high quality, commercial use, ${platform} ready, stock image, ${baseName}`
    const keywords = autoCleanKeywords(
      kwBase,
      autoRemoveDupKeywords,
      bulkKeywordEnabled ? bulkKeywordText : '',
    )
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, keywordsCount)
      .join(', ')

    const descBase = `High quality ${platform} friendly stock asset generated from file ${baseName}. Perfect for print-on-demand, templates, mockups, stickers and professional use.`
    const description = descBase.slice(0, descriptionLength)

    await new Promise((res) => setTimeout(res, 200 + index * 5))

    return {
      title,
      keywords,
      description,
      status: 'success',
    }
  }

  const generateForItem = async (id: string, index: number) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'generating', error: '' } : f)),
    )
    try {
      const current = files.find((f) => f.id === id)
      if (!current) return
      const partial = await fakeGenerateMetadata(current, index)
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...partial } : f)))
      setGeneratedCount((c) => c + 1)
    } catch (err) {
      console.error(err)
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'failed', error: 'Generation failed' } : f,
        ),
      )
      setFailedCount((c) => c + 1)
    }
  }

  const handleGenerateAll = async () => {
    if (!savedApiKey) {
      if (
        !window.confirm(
          'No API key saved. Do you still want to generate using demo logic?',
        )
      ) {
        return
      }
    }
    setIsGeneratingAll(true)
    setGeneratedCount(0)
    setFailedCount(0)
    addHistory('Generation started for all files.')

    const pending = files.filter((f) => f.status === 'pending' || f.status === 'failed')

    for (let i = 0; i < pending.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await generateForItem(pending[i].id, i)
    }

    setIsGeneratingAll(false)
    addHistory('Generation finished.')
  }

  const handleRegenerate = (id: string) => {
    const index = files.findIndex((f) => f.id === id)
    if (index === -1) return
    void generateForItem(id, index)
  }

  const handleExportCsv = async () => {
    if (!files.length) {
      alert('No files to export.')
      return
    }

    const header = ['filename', 'title', 'keywords', 'description', 'platform']
    const rows = files.map((f) => [
      f.file.name,
      f.title,
      f.keywords,
      f.description,
      platform,
    ])

    const csvContent =
      [header, ...rows]
        .map((r) =>
          r
            .map((v) =>
              `"${String(v || '')
                .replace(/"/g, '""')
                .replace(/\r?\n/g, ' ')}"`,
            )
            .join(','),
        )
        .join('\r\n') + '\r\n'

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'general.csv'
    a.click()
    URL.revokeObjectURL(url)

    addHistory('CSV exported (general.csv).')
  }

  const updateFileField = (
    id: string,
    field: 'title' | 'keywords' | 'description',
    value: string,
  ) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  if (!isLoggedIn) {
    return (
      <div className="login-wrapper">
        <div className="login-card">
          <h1 className="site-title">CSV Metadata Generator</h1>
          <p className="login-subtitle">Please login with your email to use this tool.</p>
          <input
            type="email"
            placeholder="Enter your email"
            className="login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="primary-btn" onClick={handleLogin}>
            Login
          </button>
          <div className="login-developed">
            Developed By <strong>Anil Chandra Barman</strong>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-site-name">CSV Metadata Generator</span>
        </div>
        <div className="topbar-right">
          <div className="topbar-login">
            <span className="topbar-email-label">Logged in as:</span>
            <span className="topbar-email-value">{email}</span>
            <button className="small-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
          <div className="topbar-developed-box">
            <span className="developed-by-label">Developed By</span>
            <span className="developed-by-name">Anil Chandra Barman</span>
          </div>
        </div>
      </header>

      <div className="main-layout">
        <aside className="left-column">
          <section className="card">
            <div className="card-row">
              <h2 className="card-title">Generation Controls</h2>
              <div className="api-row">
                <input
                  type="password"
                  placeholder="Enter Gemini / ChatGPT API key"
                  className="text-input full"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button className="primary-btn" onClick={handleSaveApiKey}>
                  Save
                </button>
              </div>
            </div>
            <div className="card-row toggle-row">
              <button
                className={'toggle-btn' + (mode === 'metadata' ? ' toggle-btn-active' : '')}
                onClick={() => setMode('metadata')}
              >
                Metadata
              </button>
              <button
                className={'toggle-btn' + (mode === 'prompt' ? ' toggle-btn-active' : '')}
                onClick={() => setMode('prompt')}
              >
                Prompt
              </button>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">Advance Control</h2>
            <p className="small-caption">Select where you want to use the CSV:</p>
            <div className="platform-row">
              <button
                className={'pill-btn' + (platform === 'adobe' ? ' pill-btn-active' : '')}
                onClick={() => setPlatform('adobe')}
              >
                Adobe Stock
              </button>
              <button
                className={'pill-btn' + (platform === 'freepik' ? ' pill-btn-active' : '')}
                onClick={() => setPlatform('freepik')}
              >
                Freepik
              </button>
              <button
                className={
                  'pill-btn' + (platform === 'shutterstock' ? ' pill-btn-active' : '')
                }
                onClick={() => setPlatform('shutterstock')}
              >
                Shutterstock
              </button>
              <button
                className={'pill-btn' + (platform === 'general' ? ' pill-btn-active' : '')}
                onClick={() => setPlatform('general')}
              >
                General
              </button>
              <button
                className={'pill-btn' + (platform === 'vecteezy' ? ' pill-btn-active' : '')}
                onClick={() => setPlatform('vecteezy')}
              >
                Vecteezy
              </button>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">Title & Keywords Settings</h2>

            <div className="slider-group">
              <label className="slider-label">
                Title Length: <strong>{titleLength}</strong> characters
              </label>
              <input
                type="range"
                min={10}
                max={120}
                value={titleLength}
                onChange={(e) => setTitleLength(Number(e.target.value))}
              />
            </div>

            <div className="slider-group">
              <label className="slider-label">
                Keywords Count: <strong>{keywordsCount}</strong>
              </label>
              <input
                type="range"
                min={5}
                max={50}
                value={keywordsCount}
                onChange={(e) => setKeywordsCount(Number(e.target.value))}
              />
            </div>

            <div className="slider-group">
              <label className="slider-label">
                Description Length: <strong>{descriptionLength}</strong> characters
              </label>
              <input
                type="range"
                min={50}
                max={200}
                value={descriptionLength}
                onChange={(e) => setDescriptionLength(Number(e.target.value))}
              />
            </div>

            <div className="toggle-line">
              <label>
                <input
                  type="checkbox"
                  checked={autoRemoveDupKeywords}
                  onChange={(e) => setAutoRemoveDupKeywords(e.target.checked)}
                />{' '}
                Auto remove duplicate keywords
              </label>
            </div>

            <p className="small-caption">
              Title cleaning: removes duplicate words, numbers, #, =, dots and other
              symbols. First letter Capital, others small, single spaces between words.
            </p>
          </section>

          <section className="card">
            <h2 className="card-title">Bulk & Title Options</h2>

            <div className="toggle-line">
              <label>
                <input
                  type="checkbox"
                  checked={bulkKeywordEnabled}
                  onChange={(e) => setBulkKeywordEnabled(e.target.checked)}
                />{' '}
                Bulk: Add Keyword (for all files)
              </label>
            </div>
            {bulkKeywordEnabled && (
              <textarea
                className="text-area"
                placeholder="Write extra keywords. These will be merged with generated keywords."
                value={bulkKeywordText}
                onChange={(e) => setBulkKeywordText(e.target.value)}
              />
            )}

            <div className="toggle-line">
              <label>
                <input
                  type="checkbox"
                  checked={prefixEnabled}
                  onChange={(e) => setPrefixEnabled(e.target.checked)}
                />{' '}
                Prefix for Title
              </label>
            </div>
            {prefixEnabled && (
              <input
                className="text-input full"
                placeholder="Prefix text (added before title)"
                value={prefixText}
                onChange={(e) => setPrefixText(e.target.value)}
              />
            )}

            <div className="toggle-line">
              <label>
                <input
                  type="checkbox"
                  checked={suffixEnabled}
                  onChange={(e) => setSuffixEnabled(e.target.checked)}
                />{' '}
                Suffix for Title
              </label>
            </div>
            {suffixEnabled && (
              <input
                className="text-input full"
                placeholder="Suffix text (added after title)"
                value={suffixText}
                onChange={(e) => setSuffixText(e.target.value)}
              />
            )}
          </section>

          <section className="card footer-card">
            <div className="footer-left">
              <div>
                Developed By <strong>Anil Chandra</strong>
              </div>
              <div className="footer-links">
                Follow:{' '}
                <a
                  href="https://www.facebook.com/anil.chandrabarman.3"
                  target="_blank"
                  rel="noreferrer"
                >
                  Facebook
                </a>{' '}
                |{' '}
                <a href="https://wa.me/8801770735110" target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              </div>
            </div>
          </section>
        </aside>

        <main className="right-column">
          <section className="card upload-card">
            <h2 className="card-title">Upload Files</h2>
            <div
              className="dropzone"
              onDrop={onDrop}
              onDragOver={onDragOver}
              role="button"
            >
              <input
                type="file"
                multiple
                onChange={handleFileInputChange}
                className="file-input"
              />
              <div className="dropzone-content">
                <p className="dropzone-main">
                  Drag &amp; drop files here, or click to select.
                </p>
                <p className="dropzone-sub">
                  Supports common image, video, SVG, and EPS formats. Max 1000 files.
                </p>
              </div>
            </div>

            <div className="upload-progress-row">
              <div className="progress-info">
                <div className="progress-label">
                  Upload files to begin
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="progress-stats">
                  Uploaded: {files.length} | Success: {generatedCount} | Failed:{' '}
                  {failedCount}
                </div>
              </div>
              <div className="upload-actions">
                <button className="secondary-btn" onClick={clearAll}>
                  Clear All
                </button>
                <button
                  className="primary-btn"
                  onClick={handleGenerateAll}
                  disabled={!files.length || isGeneratingAll}
                >
                  {isGeneratingAll ? 'Generating…' : 'Generate All'}
                </button>
                <button
                  className="outline-btn"
                  onClick={handleExportCsv}
                  disabled={!files.length}
                >
                  Export CSV (ZIP later)
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => addHistory('History button clicked')}
                >
                  History
                </button>
              </div>
            </div>
          </section>

          <section className="card files-card">
            <h2 className="card-title">Files & Metadata</h2>
            {!files.length && (
              <p className="empty-state">
                No files uploaded yet. Upload files to see preview, title, keywords and
                description fields.
              </p>
            )}

            {files.map((item) => (
              <div key={item.id} className="file-row">
                <div className="file-preview">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt={item.file.name} />
                  ) : (
                    <div className="file-icon-fallback">
                      <span>{item.file.name.split('.').pop()?.toUpperCase()}</span>
                    </div>
                  )}
                </div>
                <div className="file-meta">
                  <div className="file-name">{item.file.name}</div>
                  <div className="field-group">
                    <label>Title</label>
                    <input
                      className="text-input full"
                      value={item.title}
                      onChange={(e) =>
                        updateFileField(item.id, 'title', e.target.value)
                      }
                      placeholder="Generated or custom title"
                    />
                  </div>
                  <div className="field-group">
                    <label>Keywords</label>
                    <textarea
                      className="text-area"
                      value={item.keywords}
                      onChange={(e) =>
                        updateFileField(item.id, 'keywords', e.target.value)
                      }
                      placeholder="Comma-separated keywords"
                    />
                  </div>
                  <div className="field-group">
                    <label>Description</label>
                    <textarea
                      className="text-area"
                      value={item.description}
                      onChange={(e) =>
                        updateFileField(item.id, 'description', e.target.value)
                      }
                      placeholder="Description (up to 200 chars will be used)"
                    />
                  </div>
                  <div className="file-actions">
                    <span className={`status-badge status-${item.status}`}>
                      {item.status === 'pending' && 'Pending'}
                      {item.status === 'generating' && 'Generating'}
                      {item.status === 'success' && 'Ready'}
                      {item.status === 'failed' && 'Failed'}
                    </span>
                    {item.status === 'failed' && (
                      <button
                        className="small-btn"
                        type="button"
                        onClick={() => handleRegenerate(item.id)}
                      >
                        Regenerate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="card history-card">
            <h2 className="card-title">Activity History</h2>
            {!history.length && (
              <p className="empty-state">No activity yet. Actions will appear here.</p>
            )}
            {history.length > 0 && (
              <ul className="history-list">
                {history.map((h, idx) => (
                  <li key={idx}>{h}</li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
