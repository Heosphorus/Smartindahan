import type { ProductRecord } from '../../services/storeApi'

/** Optional columns of an exported price list. The product name and selling price are always included. */
export type ExportColumn = 'category' | 'brand' | 'barcode' | 'unit' | 'costPrice' | 'currentStock'

/** Columns in the order they appear in a document; those marked `always` cannot be left out. */
const COLUMN_SPEC: Array<{ id: ExportColumn | 'name' | 'sellingPrice'; header: string; kind: 'text' | 'money' | 'integer'; always?: boolean }> = [
  { id: 'name', header: 'Product', kind: 'text', always: true },
  { id: 'category', header: 'Category', kind: 'text' },
  { id: 'brand', header: 'Brand', kind: 'text' },
  { id: 'barcode', header: 'Barcode', kind: 'text' },
  { id: 'unit', header: 'Unit', kind: 'text' },
  { id: 'costPrice', header: 'Cost per unit', kind: 'money' },
  { id: 'sellingPrice', header: 'Selling price', kind: 'money', always: true },
  { id: 'currentStock', header: 'Current stock', kind: 'integer' },
]

/** Labels for the optional columns, for the export dialog. */
export const EXPORT_COLUMNS = COLUMN_SPEC.filter((column): column is typeof column & { id: ExportColumn } => !column.always)

type Cell = string | number
type Kind = 'text' | 'money' | 'integer'
export type ExportTable = {
  title: string
  subtitle: string
  columns: Array<{ header: string; kind: Kind }>
  rows: Cell[][]
}

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long' })
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function cellFor(product: ProductRecord, id: (typeof COLUMN_SPEC)[number]['id']): Cell {
  switch (id) {
    case 'name': return product.name
    case 'category': return product.category
    case 'brand': return product.brand ?? ''
    case 'barcode': return product.barcode ?? ''
    case 'unit': return product.unit ?? ''
    case 'costPrice': return finite(product.costPrice) ? product.costPrice : ''
    case 'sellingPrice': return finite(product.sellingPrice) ? product.sellingPrice : ''
    case 'currentStock': return finite(product.currentStock) ? product.currentStock : ''
  }
}

/** Products sorted by category then name, shaped as the rows of a document. Cost is only included when asked for. */
export function buildExportTable(products: ProductRecord[], options: { title: string; columns: ExportColumn[]; generatedOn?: Date }): ExportTable {
  const chosen = new Set(options.columns)
  const spec = COLUMN_SPEC.filter((column) => column.always || chosen.has(column.id as ExportColumn))
  const sorted = [...products].sort((left, right) => left.category.localeCompare(right.category, undefined, { sensitivity: 'base' }) || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
  const columns = spec.map((column) => ({ header: column.header, kind: column.kind }))
  const rows = sorted.map((product) => spec.map((column) => cellFor(product, column.id)))
  const count = products.length
  return {
    title: options.title.trim() || 'Price list',
    subtitle: `${dateFormat.format(options.generatedOn ?? new Date())} · ${count} ${count === 1 ? 'product' : 'products'}`,
    columns,
    rows,
  }
}

/** Text shown for a cell in a printed page or Word table. */
const displayCell = (cell: Cell, kind: Kind) => typeof cell === 'number' ? (kind === 'money' ? peso.format(cell) : cell.toLocaleString('en-PH')) : cell

// ---------------------------------------------------------------- XML and HTML escaping

// Characters XML 1.0 cannot carry at all would make Excel and Word report a damaged file.
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g
const escapeXml = (value: string) => value.replace(XML_INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ---------------------------------------------------------------- zip (store only; .xlsx and .docx are zip files)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** Packs files into an uncompressed zip. Office files open fine without compression, and the sizes here are small. */
export function zipStore(files: Array<{ name: string; text: string }>, now = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  const header = (size: number) => { const view = new DataView(new ArrayBuffer(size)); return view }
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.text)
    const crc = crc32(data)

    const local = header(30)
    local.setUint32(0, 0x04034B50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // file names are UTF-8
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, dosTime, true)
    local.setUint16(12, dosDate, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), name, data)

    const entry = header(46)
    entry.setUint32(0, 0x02014B50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(10, 0, true)
    entry.setUint16(12, dosTime, true)
    entry.setUint16(14, dosDate, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), name)
    offset += 30 + name.length + data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = header(22)
  end.setUint32(0, 0x06054B50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let position = 0
  for (const part of all) { out.set(part, position); position += part.length }
  return out
}

// ---------------------------------------------------------------- Excel (.xlsx)

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

const columnLetter = (index: number) => String.fromCharCode(65 + index) // an export has at most eight columns

/** Sheet names are at most 31 characters and cannot contain : \ / ? * [ ] */
const sheetName = (title: string) => title.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Price list'

const STYLES = `${XML_HEAD}<styleSheet xmlns="${SHEET_NS}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₱&quot;#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0EE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFC9CC"/></left><right style="thin"><color rgb="FFBFC9CC"/></right><top style="thin"><color rgb="FFBFC9CC"/></top><bottom style="thin"><color rgb="FFBFC9CC"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const textCell = (ref: string, value: string, style: number) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`

/** The bytes of an .xlsx workbook with one sheet. Prices are real numbers with a peso format, so they can be summed or sorted in Excel. */
export function buildXlsx(table: ExportTable, now = new Date()): Uint8Array {
  const headerRow = 4
  const widths = table.columns.map((column, index) => {
    const longest = Math.max(column.header.length, ...table.rows.map((row) => String(row[index] ?? '').length))
    return Math.min(60, Math.max(column.kind === 'text' ? 12 : 14, longest + 2))
  })
  const rows: string[] = [
    `<row r="1">${textCell('A1', table.title, 1)}</row>`,
    `<row r="2">${textCell('A2', table.subtitle, 2)}</row>`,
    `<row r="${headerRow}">${table.columns.map((column, index) => textCell(`${columnLetter(index)}${headerRow}`, column.header, 3)).join('')}</row>`,
  ]
  table.rows.forEach((row, rowIndex) => {
    const number = headerRow + 1 + rowIndex
    rows.push(`<row r="${number}">${row.map((cell, index) => {
      const ref = `${columnLetter(index)}${number}`
      const kind = table.columns[index]!.kind
      return typeof cell === 'number' ? `<c r="${ref}" s="${kind === 'money' ? 5 : 6}"><v>${cell}</v></c>` : textCell(ref, cell, 4)
    }).join('')}</row>`)
  })
  const lastColumn = columnLetter(table.columns.length - 1)
  const sheet = `${XML_HEAD}<worksheet xmlns="${SHEET_NS}">
<dimension ref="A1:${lastColumn}${headerRow + table.rows.length}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
</worksheet>`

  return zipStore([
    { name: '[Content_Types].xml', text: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', text: `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `${XML_HEAD}<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${escapeXml(sheetName(table.title))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: STYLES },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ], now)
}

// ---------------------------------------------------------------- Word (.docx)

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const BORDER_COLOR = 'BFC9CC'

function wordParagraph(text: string, options: { bold?: boolean; size?: number; color?: string; align?: 'right'; after?: number } = {}): string {
  const run = `<w:rPr>${options.bold ? '<w:b/>' : ''}${options.color ? `<w:color w:val="${options.color}"/>` : ''}${options.size ? `<w:sz w:val="${options.size}"/>` : ''}</w:rPr>`
  return `<w:p><w:pPr><w:spacing w:after="${options.after ?? 0}"/>${options.align ? `<w:jc w:val="${options.align}"/>` : ''}</w:pPr><w:r>${run}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

/** The bytes of a .docx file: a title, the date and product count, and the price list as a table. */
export function buildDocx(table: ExportTable, now = new Date()): Uint8Array {
  const total = 9360 // usable width of a Letter page with one-inch margins, in twentieths of a point
  const nameShare = 2.2
  const shares = table.columns.map((column) => (column.header === 'Product' ? nameShare : 1))
  const shareTotal = shares.reduce((sum, share) => sum + share, 0)
  const grid = shares.map((share) => Math.round((share / shareTotal) * total))
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${BORDER_COLOR}"/>`
  const cell = (text: string, index: number, header: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${grid[index]}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E2F0EE"/>' : ''}</w:tcPr>${wordParagraph(text, { bold: header, size: 20, ...(table.columns[index]!.kind !== 'text' ? { align: 'right' as const } : {}) })}</w:tc>`

  const headerRow = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${table.columns.map((column, index) => cell(column.header, index, true)).join('')}</w:tr>`
  const bodyRows = table.rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((value, index) => cell(displayCell(value, table.columns[index]!.kind), index, false)).join('')}</w:tr>`).join('')
  const document = `${XML_HEAD}<w:document xmlns:w="${WORD_NS}"><w:body>${wordParagraph(table.title, { bold: true, size: 36, after: 60 })}${wordParagraph(table.subtitle, { size: 20, color: '5F6B73', after: 200 })}<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${headerRow}${bodyRows}</w:tbl><w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`

  return zipStore([
    { name: '[Content_Types].xml', text: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: '_rels/.rels', text: `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', text: document },
  ], now)
}

// ---------------------------------------------------------------- print

/** A complete, self-contained HTML page for printing. All text is escaped; there are no scripts. */
export function buildPrintHtml(table: ExportTable): string {
  const head = table.columns.map((column) => `<th${column.kind === 'text' ? '' : ' class="num"'}>${escapeHtml(column.header)}</th>`).join('')
  const body = table.rows.map((row) => `<tr>${row.map((value, index) => `<td${table.columns[index]!.kind === 'text' ? '' : ' class="num"'}>${escapeHtml(displayCell(value, table.columns[index]!.kind))}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(table.title)}</title><style>
@page { margin: 16mm; }
body { margin: 0; color: #12212b; font: 12px/1.4 Arial, Helvetica, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
p { margin: 0 0 14px; color: #5f6b73; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #bfc9cc; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #e2f0ee; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
.num { text-align: right; white-space: nowrap; }
</style></head><body><h1>${escapeHtml(table.title)}</h1><p>${escapeHtml(table.subtitle)}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
}

/** Prints a document through a hidden frame, so no pop-up is opened and the app page itself is left alone. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000)
  frame.addEventListener('load', () => {
    const view = frame.contentWindow
    if (!view) { frame.remove(); return }
    view.addEventListener('afterprint', cleanup)
    view.focus()
    view.print()
    window.setTimeout(() => frame.remove(), 120_000) // closed without printing in browsers that never fire afterprint
  }, { once: true })
  frame.srcdoc = html
  document.body.appendChild(frame)
}

// ---------------------------------------------------------------- download

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** A safe file name such as "price-list-2026-10-31.xlsx". */
export function exportFileName(title: string, extension: 'xlsx' | 'docx', now = new Date()): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'price-list'
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${slug}-${now.getFullYear()}-${month}-${day}.${extension}`
}

export function downloadFile(name: string, mime: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
