import { describe, expect, it } from 'vitest'
import { renderForTest } from '../src/lib/printPlan'

const MD = `# 《暴雪山庄的密室》

> 一句话卖点

## 一、案件速览

| 题材 | 人数 | 难度 |
| --- | --- | --- |
| 本格 | 5 人 | 新手 |

## 三、核心诡计

### 手法拆解

1. 用录音机伪造争执声
2. 把怀表调快 25 分钟
3. 用冰块支撑门闩

## 五、线索清单

| 编号 | 线索 | 指向 |
| --- | --- | --- |
| C1 | 炉灰中的怀表零件 | 指向医生 |

> 注意：本条为公平性提示。

---

结尾一段普通文字，包含 **加粗** 与 \`代码\`。
`

describe('打印排版渲染', () => {
  const html = renderForTest(MD)

  it('渲染标题层级', () => {
    expect(html).toContain('<h1>《暴雪山庄的密室》</h1>')
    expect(html).toContain('<h2>一、案件速览</h2>')
    expect(html).toContain('<h3>手法拆解</h3>')
  })

  it('渲染表格（含表头与多行数据）', () => {
    expect(html).toContain('<table>')
    expect(html).toContain('<th>题材</th>')
    expect(html).toContain('<td>本格</td>')
    expect(html).toContain('<td>炉灰中的怀表零件</td>')
    expect((html.match(/<table>/g) || []).length).toBe(2)
  })

  it('渲染有序列表', () => {
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>用录音机伪造争执声</li>')
    expect(html).toContain('</ol>')
  })

  it('渲染引用与分隔线', () => {
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<hr/>')
  })

  it('行内加粗与代码不破坏结构', () => {
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<code>代码</code>')
  })

  it('HTML 特殊字符被转义，不会注入', () => {
    const out = renderForTest('一句 <script>alert(1)</script> 内容')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('空输入不崩溃且返回空串', () => {
    expect(renderForTest('')).toBe('')
  })
})
