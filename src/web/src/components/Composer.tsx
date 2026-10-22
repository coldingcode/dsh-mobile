import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ImagePlus, Loader2, Square, X } from 'lucide-react'
import type { PromptImage } from '../api.ts'
import { haptic } from '../native.ts'

interface Props {
  running: boolean
  sending: boolean
  onSend: (text: string, images: PromptImage[]) => void
  onStop: () => void
}

async function prepareImage(file: File): Promise<PromptImage> {
  if (!file.type.startsWith('image/')) throw new Error('只能发送图片')
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB')
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image()
      node.onload = () => resolve(node)
      node.onerror = () => reject(new Error('无法读取这张图片'))
      node.src = url
    })
    const maxSide = 1600
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('无法处理图片')
    context.drawImage(image, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    const comma = dataUrl.indexOf(',')
    return {
      data: dataUrl.slice(comma + 1),
      mimeType: 'image/jpeg',
      preview: dataUrl,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function Composer({ running, sending, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<PromptImage[]>([])
  const [busy, setBusy] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const node = textarea.current
    if (node === null) return
    node.style.height = '0px'
    node.style.height = Math.min(132, Math.max(24, node.scrollHeight)) + 'px'
  }, [text])

  const canSend = !running && !sending && !busy && (text.trim() !== '' || images.length > 0)

  const submit = () => {
    if (!canSend) return
    haptic('medium')
    onSend(text.trim(), images)
    setText('')
    setImages([])
    if (textarea.current !== null) textarea.current.style.height = '24px'
  }

  const pickFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0) return
    setBusy(true)
    try {
      const next: PromptImage[] = []
      for (const file of Array.from(files).slice(0, 4 - images.length)) next.push(await prepareImage(file))
      setImages((current) => [...current, ...next].slice(0, 4))
      haptic('success')
    } catch (error) {
      haptic('error')
      window.alert(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }

  return (
    <div className="composer-wrap">
      {images.length > 0 && (
        <div className="composer-images">
          {images.map((image, index) => (
            <div className="composer-image" key={image.preview.slice(-24) + index}>
              <img src={image.preview} alt={'附件 ' + (index + 1)} />
              <button
                className="composer-image-x"
                onClick={() => setImages((current) => current.filter((_, at) => at !== index))}
                aria-label="移除图片"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={'composer' + (running ? ' is-running' : '')}>
        <button className="composer-plus" onClick={() => fileInput.current?.click()} disabled={busy || images.length >= 4} aria-label="添加图片">
          {busy ? <Loader2 size={19} className="spin" /> : <ImagePlus size={19} strokeWidth={1.9} />}
        </button>
        <textarea
          ref={textarea}
          className="composer-input"
          value={text}
          rows={1}
          placeholder={running ? '本机 DSH 正在运行…' : '给本机 DSH 发消息…'}
          enterKeyHint="enter"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        {running ? (
          <button className="composer-send stop" onClick={onStop} aria-label="停止">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button className={'composer-send' + (canSend ? ' ready' : '')} onClick={submit} disabled={!canSend} aria-label="发送">
            {sending ? <Loader2 size={18} className="spin" /> : <ArrowUp size={19} strokeWidth={2.4} />}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => void pickFiles(event.target.files)}
        />
      </div>
    </div>
  )
}
