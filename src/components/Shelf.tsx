import { useMemo, useState } from 'react'
import { Markdown } from '../lib/markdown'
import { copyText } from '../lib/exporters'
import { filterShelf, snippetAround, type ShelfItem, type ShelfSort } from '../lib/shelf'

interface Props {
  items: ShelfItem[]
  onClose: () => void
  onDelete: (id: string) => void
}

/** 往期案卷：本地书架抽屉，点击回看 / 复制 / 导出。 */
export default function Shelf({ items, onClose, onDelete }: Props) {
  const [active, setActive] = useState<ShelfItem | null>(null)
  const [msg, setMsg] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ShelfSort>('recent')

  const visible = useMemo(() => filterShelf(items, query, sort), [items, query, sort])

  const flash = (text: string) => {
    setMsg(text)
    window.setTimeout(() => setMsg(''), 3000)
  }

  const downloadWord = async (item: ShelfItem) => {
    flash('正在准备 Word 导出…')
    try {
      const { downloadDocx } = await import('../lib/docxExporters')
      await downloadDocx(item.markdown, { title: item.title })
      flash('完成')
    } catch (err) {
      flash(err instanceof Error ? err.message : '导出失败，请重试。')
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="案卷书架"
      onClick={onClose}
    >
      <div className="modal-panel shelf-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>📚 往期案卷</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭书架">✕</button>
        </header>

        {active ? (
          <div className="shelf-preview">
            <button
              className="shelf-back"
              onClick={() => setActive(null)}
            >
              ← 返回书架
            </button>
            <h3 className="shelf-title">{active.title}</h3>
            <p className="shelf-meta">
              存于 {new Date(active.savedAt).toLocaleString('zh-CN')}
            </p>
            <div className="shelf-actions">
              <button onClick={() => void copyText(active.markdown).then((ok) => flash(ok ? '已复制全文' : '复制失败'))}>
                复制全文
              </button>
              <button onClick={() => void downloadWord(active)}>下载 Word</button>
              <button
                className="shelf-del"
                onClick={() => {
                  if (window.confirm(`移除《${active.title}》？`)) {
                    onDelete(active.id)
                    setActive(null)
                  }
                }}
              >
                移除
              </button>
            </div>
            <div className="shelf-body">
              <Markdown content={active.markdown} />
            </div>
          </div>
        ) : (
          <div className="shelf-list">
            {items.length > 0 && (
              <div className="shelf-toolbar">
                <input
                  className="shelf-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜标题或正文，比如「雪夜」「叙诡」"
                  aria-label="搜索案卷"
                />
                <select
                  className="shelf-sort"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as ShelfSort)}
                  aria-label="排序方式"
                >
                  <option value="recent">最近保存</option>
                  <option value="oldest">最早保存</option>
                  <option value="title">按标题</option>
                </select>
              </div>
            )}

            {items.length === 0 && (
              <p className="shelf-empty">书架还是空的。生成方案后会自动存入最近 12 份。</p>
            )}

            {items.length > 0 && visible.length === 0 && (
              <p className="shelf-empty">没有匹配「{query}」的案卷。换个关键词，或清空搜索。</p>
            )}

            {visible.map((item) => {
              const snippet = snippetAround(item.markdown, query)
              return (
                <button key={item.id} className="shelf-item" onClick={() => setActive(item)}>
                  <span className="shelf-item-head">
                    <span className="shelf-item-title">《{item.title}》</span>
                    <span className="shelf-item-date">
                      {new Date(item.savedAt).toLocaleDateString('zh-CN')}
                    </span>
                  </span>
                  {snippet && <span className="shelf-item-snippet">{snippet}</span>}
                </button>
              )
            })}
          </div>
        )}
        {msg && <div className="shelf-msg">{msg}</div>}
      </div>
    </div>
  )
}
