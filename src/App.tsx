import React, { useEffect, useState, ChangeEvent, useRef } from 'react'
import './App.css'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

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

/** ----- Title cleaner ----- */
function normalizeTitle(raw: string): string {
  let text = raw
    .replace(/[0-9#_=+*{}\[\];:<>/\\|~`"“”'’.,!?()-]/g, ' ')
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

/** ----- Keyword cleaner: সব keyword এক শব্দ করা + ডুপ্লিকেট রিমুভ ----- */
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
    // multi-word phrase → শুধু প্রথম শব্দ
    .map((t) => t.split(/\s+/)[0])
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

/** ----- base + bulk keyword merge + padding to exact count ----- */
function buildKeywords(
  baseKeywords: string,
  bulkKeywordText: string,
  autoRemoveDupKeywords: boolean,
  targetCount: number,
): string {
  // base + bulk একসাথে ক্লিন করি
  let combined = autoCleanKeywords(
    baseKeywords,
    autoRemoveDupKeywords,
    bulkKeywordText || '',
  )
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  // শুধু bulk keyword আলাদা করে parse করি – যাতে সবসময় আগে থাকে
  let bulkTokens: string[] = []
  if (bulkKeywordText && bulkKeywordText.trim()) {
    bulkTokens = autoCleanKeywords(bulkKeywordText, autoRemoveDupKeywords, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }

  if (bulkTokens.length) {
    const reordered: string[] = []
    const seen = new Set<string>()

    for (const word of bulkTokens) {
      if (!seen.has(word)) {
        reordered.push(word)
        seen.add(word)
      }
    }

    for (const t of combined) {
      if (!seen.has(t)) {
        reordered.push(t)
        seen.add(t)
      }
    }

    combined = reordered
  }

  const fillerPool = [
    'vector',
    'illustration',
    'design',
    'art',
    'graphic',
    'symbol',
    'icon',
    'minimal',
    'modern',
    'abstract',
    'background',
    'template',
    'creative',
    'digital',
    'silhouette',
    'pattern',
    'shape',
    'line',
    'curve',
    'poster',
    'print',
    'stock',
    'commercial',
    'concept',
  ]

  for (const word of fillerPool) {
    if (combined.length >= targetCount) break
    if (!combined.includes(word)) {
      combined.push(word)
    }
  }

  return combined.slice(0, targetCount).join(', ')
}

/** ----- File helpers ----- */

// image → base64 (PNG/JPG/WEBP/GIF)
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const base64 = result.split(',')[1] || result
        resolve(base64)
      } else {
        reject(new Error('Failed to read file'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

// SVG / text → string
async function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        resolve(result)
      } else {
        resolve('')
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsText(file)
  })
}

// SVG → PNG (base64) – Gemini vision এর জন্য
async function svgFileToPngBase64(file: File): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        resolve(result)
      } else {
        reject(new Error('Failed to read SVG as data URL'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsDataURL(file)
  })

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const width = img.naturalWidth || img.width || 1024
      const height = img.naturalHeight || img.height || 1024
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      const pngDataUrl = canvas.toDataURL('image/png')
      const base64 = pngDataUrl.split(',')[1] || ''
      resolve(base64)
    }
    img.onerror = () => reject(new Error('Failed to render SVG to canvas'))
    img.src = dataUrl
  })
}

/** ===================== MAIN APP ===================== */

const MAX_KEYS = 5

const App: React.FC = () => {
  // Login
  const [email, setEmail] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Gemini API keys (up to 5)
  const [apiKeys, setApiKeys] = useState<string[]>(Array(MAX_KEYS).fill(''))

  // Mode & platform
  const [mode, setMode] = useState<Mode>('metadata')
  const [platform, setPlatform] = useState<Platform>('adobe')

  // Controls
  const [titleLength, setTitleLength] = useState(80)
  const [keywordsCount, setKeywordsCount] = useState(25)
  const [descriptionLength, setDescriptionLength] = useState(200)
  const [autoRemoveDupKeywords, setAutoRemoveDupKeywords] = useState(true)

  // Bulk keyword, prefix/suffix
  const [bulkKeywordEnabled, setBulkKeywordEnabled] = useState(false)
  const [bulkKeywordText, setBulkKeywordText] = useState('')
  const [prefixEnabled, setPrefixEnabled] = useState(false)
  const [suffixEnabled, setSuffixEnabled] = useState(false)
  const [prefixText, setPrefixText] = useState('')
  const [suffixText, setSuffixText] = useState('')

  // Files & state
  const [files, setFiles] = useState<FileItem[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [generatedCount, setGeneratedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [history, setHistory] = useState<string[]>([])
  const [isGeneratingAll, setIsGeneratingAll] = useState(false)

  // নতুন: stop flag (Start / Stop টগল করার জন্য)
  const [stopRequested, setStopRequested] = useState(false)
  const stopRequestedRef = useRef(false)

  /** ---- Load API keys from localStorage ---- */
  useEffect(() => {
    const stored = localStorage.getItem('csv_tool_gemini_keys')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          const normalized: string[] = Array(MAX_KEYS).fill('')
          parsed.slice(0, MAX_KEYS).forEach((k: string, idx: number) => {
            normalized[idx] = String(k || '')
          })
          setApiKeys(normalized)
        }
      } catch {
        // ignore parse error
      }
    }
  }, [])

  /** ---- Helpers ---- */

  const addHistory = (msg: string) => {
    setHistory((prev) => [`${new Date().toLocaleTimeString()} - ${msg}`, ...prev])
  }

  const handleSaveApiKeys = () => {
    const cleaned = apiKeys.map((k) => k.trim()).filter((k) => k.length > 0)
    if (!cleaned.length) {
      alert('Please add at least one Gemini API key.')
      return
    }
    localStorage.setItem('csv_tool_gemini_keys', JSON.stringify(cleaned))
    const normalized: string[] = Array(MAX_KEYS).fill('')
    cleaned.slice(0, MAX_KEYS).forEach((k, idx) => {
      normalized[idx] = k
    })
    setApiKeys(normalized)
    addHistory(`Saved ${cleaned.length} Gemini API key(s).`)
  }

  const handleApiKeyChange = (index: number, value: string) => {
    setApiKeys((prev) => {
      const copy = [...prev]
      copy[index] = value
      return copy
    })
  }

  // Email login
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

  /** ---- File upload ---- */

  const handleFilesAdded = (fileList: FileList | null) => {
    if (!fileList) return
    const arr = Array.from(fileList).slice(0, 1000 - files.length)
    if (!arr.length) return

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

  /** ---- Gemini single-call, for one key ---- */
  const callGeminiWithKey = async (
    apiKey: string,
    item: FileItem,
  ): Promise<Partial<FileItem>> => {
    const apiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
      encodeURIComponent(apiKey)

    const prompt = `
You are an expert stock content metadata generator for sites like Adobe Stock, Shutterstock, Freepik, and Vecteezy.

You receive a rendered image (PNG/JPG/WEBP/GIF) or a vector (SVG converted to PNG).
Carefully analyze:
- Main subject (e.g. cat, dog, abstract geometric pattern, human, etc.)
- Style (silhouette, line art, flat, geometric, cartoon, minimal, abstract, etc.)
- Colors
- Background and composition (copy space, pattern, framing, etc.)

File name: ${item.file.name}
File type: ${item.file.type || 'unknown'}
Target platform: ${platform}
Mode: ${mode === 'metadata' ? 'metadata for title, keywords, description' : 'prompt focused'}

Requirements:
- Language: English.
- Title: max ${titleLength} characters, no quotes, very specific to THIS image.
- Keywords: EXACTLY ${keywordsCount} single-word keywords (no phrases, no numbers, no symbols). All must be relevant to this image only (subject, style, colors, mood, usage).
- Description: max ${descriptionLength} characters, 1–2 natural sentences describing the image for a stock customer.

Return ONLY a JSON object in this exact shape:
{
  "title": "string",
  "keywords": ["word1", "word2", "..."],
  "description": "string"
}
No explanation. No markdown. No extra text. Only raw JSON.
    `.trim()

    const mimeType = item.file.type || ''
    const isRasterImage = /^image\/(png|jpe?g|webp|gif)$/i.test(mimeType)
    const isSvg = mimeType === 'image/svg+xml' || /\.svg$/i.test(item.file.name)

    const parts: any[] = []

    if (isRasterImage) {
      const base64 = await fileToBase64(item.file)
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64,
        },
      })
    }

    if (isSvg) {
      const pngBase64 = await svgFileToPngBase64(item.file)
      parts.push({
        inline_data: {
          mime_type: 'image/png',
          data: pngBase64,
        },
      })

      const svgText = await fileToText(item.file)
      const truncated = svgText.slice(0, 3000)
      parts.push({
        text: 'Here is the beginning of the SVG source code (truncated):\n' + truncated,
      })
    }

    parts.push({ text: prompt })

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Gemini error (${response.status}): ${text}`)
    }

    const data = await response.json()

    let rawText = ''
    if (
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      Array.isArray(data.candidates[0].content.parts)
    ) {
      rawText =
        data.candidates[0].content.parts
          .map((p: any) => (typeof p.text === 'string' ? p.text : ''))
          .join(' ')
          .trim() || ''
    } else {
      rawText = JSON.stringify(data)
    }

    if (!rawText) {
      throw new Error('Empty response from Gemini')
    }

    let jsonText = rawText.trim()
    jsonText = jsonText.replace(/```json/gi, '').replace(/```/g, '').trim()
    const firstBrace = jsonText.indexOf('{')
    const lastBrace = jsonText.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1)
    }

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch (e) {
      console.error('Gemini rawText:', rawText)
      console.error('Gemini jsonText:', jsonText)
      throw new Error('Failed to parse JSON from Gemini response')
    }

    const rawTitle = String(parsed.title || '')
    const rawKeywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.join(', ')
      : String(parsed.keywords || '')
    const rawDescription = String(parsed.description || '')

    let title = normalizeTitle(rawTitle).slice(0, titleLength)
    if (prefixEnabled && prefixText.trim()) {
      title = `${prefixText.trim()} ${title}`.trim()
    }
    if (suffixEnabled && suffixText.trim()) {
      title = `${title} ${suffixText.trim()}`.trim()
    }

    const keywords = buildKeywords(
      rawKeywords,
      bulkKeywordEnabled ? bulkKeywordText : '',
      autoRemoveDupKeywords,
      keywordsCount,
    )

    const description = rawDescription.slice(0, descriptionLength)

    return {
      title,
      keywords,
      description,
      status: 'success',
    }
  }

  /** ---- Generate metadata with multiple keys (rotation / fallback) ---- */
  const generateMetadataWithGemini = async (
    item: FileItem,
  ): Promise<Partial<FileItem>> => {
    const keys = apiKeys.map((k) => k.trim()).filter((k) => k.length > 0)
    if (!keys.length) {
      throw new Error('No Gemini API keys configured.')
    }

    let lastError: any = null

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      try {
        const result = await callGeminiWithKey(key, item)
        addHistory(`Gemini generation succeeded with key #${i + 1} for ${item.file.name}`)
        return result
      } catch (err: any) {
        lastError = err
        console.error(`Gemini key #${i + 1} failed for ${item.file.name}`, err)
        addHistory(
          `Gemini key #${i + 1} failed for ${item.file.name}: ${
            err && err.message ? err.message : 'Unknown error'
          }`,
        )
      }
    }

    throw lastError || new Error('All Gemini API keys failed.')
  }

  /** ---- Per-file generation ---- */
  const generateForItem = async (id: string, index: number) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'generating', error: '' } : f)),
    )

    try {
      const current = files.find((f) => f.id === id)
      if (!current) return

      const partial = await generateMetadataWithGemini(current)
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...partial } : f)))
      setGeneratedCount((c) => c + 1)
    } catch (err: any) {
      console.error(err)
      addHistory(
        `Generation failed for ${id}: ${
          err && err.message ? err.message : 'Unknown error'
        }`,
      )
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'failed', error: 'Generation failed' } : f,
        ),
      )
      setFailedCount((c) => c + 1)
    }
  }

  /** ---- Generate All / Stop ---- */
  const handleGenerateAll = async () => {
    const hasKey = apiKeys.some((k) => k.trim().length > 0)

    // যদি এখন জেনারেট চলছে → এই ক্লিকটাকে STOP হিসেবে ধরব
    if (isGeneratingAll) {
      setStopRequested(true)
      stopRequestedRef.current = true
      addHistory(
        'Stop requested. Current file will finish and remaining files will stay pending.',
      )
      return
    }

    // নতুনভাবে জেনারেশন শুরু
    if (!hasKey) {
      alert('Please save at least one Gemini API key before generating.')
      return
    }

    setIsGeneratingAll(true)
    setStopRequested(false)
    stopRequestedRef.current = false
    setGeneratedCount(0)
    setFailedCount(0)
    addHistory('Generation started for all files.')

    const pending = files.filter((f) => f.status === 'pending' || f.status === 'failed')
    let stoppedByUser = false

    for (let i = 0; i < pending.length; i++) {
      if (stopRequestedRef.current) {
        stoppedByUser = true
        addHistory('Generation stopped by user.')
        break
      }
      // eslint-disable-next-line no-await-in-loop
      await generateForItem(pending[i].id, i)
    }

    setIsGeneratingAll(false)
    setStopRequested(false)
    stopRequestedRef.current = false

    if (!stoppedByUser) {
      addHistory('Generation finished.')
    }
  }

  const handleRegenerate = (id: string) => {
    const index = files.findIndex((f) => f.id === id)
    if (index === -1) return
    void generateForItem(id, index)
  }

  /** ---- CSV ZIP export ---- */
  const handleExportCsv = async () => {
    if (!files.length) {
      alert('No files to export.')
      return
    }

    const buildCsv = (items: FileItem[]): string => {
      const header = ['filename', 'title', 'keywords', 'description', 'platform']
      const rows = items.map((f) => [
        f.file.name,
        f.title,
        f.keywords,
        f.description,
        platform,
      ])

      const lines = [header, ...rows].map((r) =>
        r
          .map((v) =>
            `"${String(v || '')
              .replace(/"/g, '""')
              .replace(/\r?\n/g, ' ')}"`,
          )
          .join(','),
      )

      return lines.join('\r\n') + '\r\n'
    }

    const aiFiles = files.filter((f) => /\.ai$/i.test(f.file.name))
    const epsFiles = files.filter((f) => /\.eps$/i.test(f.file.name))
    const svgFiles = files.filter((f) => /\.svg$/i.test(f.file.name))
    const otherFiles = files.filter(
      (f) =>
        !/\.ai$/i.test(f.file.name) &&
        !/\.eps$/i.test(f.file.name) &&
        !/\.svg$/i.test(f.file.name),
    )

    const zip = new JSZip()
    zip.file('AI.csv', buildCsv(aiFiles))
    zip.file('EPS.csv', buildCsv(epsFiles))
    zip.file('SVG.csv', buildCsv(svgFiles))

    const generalSource = otherFiles.length ? otherFiles : files
    zip.file('General.csv', buildCsv(generalSource))

    const blob = await zip.generateAsync({ type: 'blob' })
    saveAs(blob, 'metadata_csv.zip')

    addHistory('CSV exported as metadata_csv.zip (AI, EPS, SVG, General).')
  }

  const updateFileField = (
    id: string,
    field: 'title' | 'keywords' | 'description',
    value: string,
  ) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  /** ---- Login screen ---- */
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

  /** ---- Main UI ---- */
  return (
    <div className="app-root">
      {/* Topbar */}
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

          {/* Avatar + Developed By */}
          <div className="topbar-developed-box">
            <img
              src="/anil-chandra-barman.jpg"
              alt="Anil Chandra Barman"
              className="developed-by-avatar"
            />
            <div className="developed-by-text">
              <span className="developed-by-label">Developed By</span>
              <span className="developed-by-name">Anil Chandra Barman</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="main-layout">
        {/* Left Column */}
        <aside className="left-column">
          {/* Generation Controls */}
          <section className="card">
            <div className="card-row">
              <h2 className="card-title">Generation Controls</h2>

              <label className="slider-label" style={{ marginTop: 4 }}>
                Gemini API keys (max {MAX_KEYS})
              </label>
              <div className="api-keys-grid">
                {apiKeys.map((key, idx) => (
                  <input
                    key={idx}
                    type="password"
                    className="text-input full api-key-input"
                    placeholder={`Gemini API key ${idx + 1}`}
                    value={key}
                    onChange={(e) => handleApiKeyChange(idx, e.target.value)}
                  />
                ))}
              </div>

              <button className="primary-btn" style={{ marginTop: 6 }} onClick={handleSaveApiKeys}>
                Save API Keys
              </button>
            </div>

            <div className="card-row toggle-row" style={{ marginTop: 10 }}>
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

          {/* Advance Control */}
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

          {/* Sliders */}
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

          {/* Bulk & Title Options */}
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

          {/* Footer */}
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

        {/* Right Column */}
        <main className="right-column">
          {/* Upload */}
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
                <div className="progress-label">Upload files to begin</div>
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
                  className={`primary-btn ${isGeneratingAll ? 'danger-btn' : ''}`}
                  onClick={handleGenerateAll}
                  disabled={!files.length}
                >
                  {isGeneratingAll ? 'Stop' : 'Generate All'}
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

          {/* Files & Metadata */}
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

          {/* History */}
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
