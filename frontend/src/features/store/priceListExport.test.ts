import { describe, expect, it } from 'vitest'

import type { ProductRecord } from '../../services/storeApi'
import { buildDocx, buildExportTable, buildPrintHtml, buildXlsx, exportFileName, zipStore } from './priceListExport'

/** A bit-by-bit CRC-32, written differently from the table-driven one in the code under test. */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const product = (name: string, category: string, extra: Partial<ProductRecord> = {}): ProductRecord => ({ _id: name, name, category, sellingPrice: 10, costPrice: 6, currentStock: 4, minStock: 1, unit: 'piece', ...extra })
const products = [
  product('Soap & <Scrub> "Plus"', 'Household', { sellingPrice: 29.75, costPrice: 20 }),
  product('Coke Mismo', 'Beverages', { brand: 'Coca-Cola', barcode: '4801981100019', unit: 'bottle', sellingPrice: 15, costPrice: 10.5, currentStock: 24 }),
  product('=HYPERLINK("http://example.invalid","x")', 'Beverages'),
]
const on = new Date(2026, 9, 31)

/** Reads a zip back: every entry's name and text, checking each stored CRC against the bytes. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054B50)
  const count = view.getUint16(end + 10, true)
  let central = view.getUint32(end + 16, true)
  const files: Record<string, string> = {}
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(central, true)).toBe(0x02014B50)
    const crc = view.getUint32(central + 16, true)
    const size = view.getUint32(central + 24, true)
    const nameLength = view.getUint16(central + 28, true)
    const offset = view.getUint32(central + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength))
    expect(view.getUint32(offset, true)).toBe(0x04034B50)
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    const data = bytes.subarray(start, start + size)
    expect(crc32(data)).toBe(crc)
    files[name] = new TextDecoder().decode(data)
    central += 46 + nameLength
  }
  return files
}
const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  expect(doc.querySelector('parsererror')).toBeNull()
  return doc
}

describe('export table', () => {
  it('lists product and selling price only by default, sorted by category then name', () => {
    const table = buildExportTable(products, { title: ' Price list ', columns: [], generatedOn: on })
    expect(table.title).toBe('Price list')
    expect(table.columns.map((column) => column.header)).toEqual(['Product', 'Selling price'])
    expect(table.rows.map((row) => row[0])).toEqual(['=HYPERLINK("http://example.invalid","x")', 'Coke Mismo', 'Soap & <Scrub> "Plus"'])
    expect(table.subtitle).toBe('October 31, 2026 · 3 products')
  })

  it('adds the optional columns in a fixed order and keeps cost out unless it is asked for', () => {
    const withCost = buildExportTable(products, { title: 'x', columns: ['currentStock', 'costPrice', 'unit', 'brand', 'barcode', 'category'] })
    expect(withCost.columns.map((column) => column.header)).toEqual(['Product', 'Category', 'Brand', 'Barcode', 'Unit', 'Cost per unit', 'Selling price', 'Current stock'])
    expect(withCost.rows[1]).toEqual(['Coke Mismo', 'Beverages', 'Coca-Cola', '4801981100019', 'bottle', 10.5, 15, 24])
    const without = buildExportTable(products, { title: 'x', columns: ['category'] })
    expect(JSON.stringify(without)).not.toContain('Cost')
    expect(without.rows.flat()).not.toContain(10.5)
  })

  it('falls back to a default title and says "1 product" for one', () => {
    const table = buildExportTable([products[0]!], { title: '   ', columns: [], generatedOn: on })
    expect(table.title).toBe('Price list')
    expect(table.subtitle).toContain('1 product')
    expect(table.subtitle).not.toContain('products')
  })
})

describe('zip writer', () => {
  it('stores files that read back byte for byte with valid checksums, including non-ASCII text', () => {
    const files = unzip(zipStore([{ name: 'a.txt', text: 'hello' }, { name: 'dir/b.xml', text: 'Ñandú 🥛 ₱1,000.50' }, { name: 'empty.txt', text: '' }]))
    expect(files).toEqual({ 'a.txt': 'hello', 'dir/b.xml': 'Ñandú 🥛 ₱1,000.50', 'empty.txt': '' })
  })
})

describe('Excel file', () => {
  const table = buildExportTable(products, { title: 'Price list: Oct/2026 [draft]', columns: ['category', 'costPrice', 'currentStock'], generatedOn: on })
  const files = unzip(buildXlsx(table, on))

  it('has the parts Excel needs, and every part is well-formed XML', () => {
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    for (const text of Object.values(files)) parse(text)
  })

  it('uses a legal sheet name, a header row, and real numbers for prices', () => {
    expect(parse(files['xl/workbook.xml']!).querySelector('sheet')?.getAttribute('name')).toBe('Price list  Oct 2026  draft')
    const sheet = parse(files['xl/worksheets/sheet1.xml']!)
    const header = [...sheet.querySelectorAll('row[r="4"] c')].map((cell) => cell.textContent)
    expect(header).toEqual(['Product', 'Category', 'Cost per unit', 'Selling price', 'Current stock'])
    const coke = [...sheet.querySelectorAll('row[r="6"] c')]
    expect(coke.map((cell) => cell.getAttribute('t'))).toEqual(['inlineStr', 'inlineStr', null, null, null])
    expect(coke.slice(2).map((cell) => cell.querySelector('v')?.textContent)).toEqual(['10.5', '15', '24'])
  })

  it('keeps text that looks like a formula as plain text, and escapes markup', () => {
    const sheet = parse(files['xl/worksheets/sheet1.xml']!)
    const formulaCell = sheet.querySelector('row[r="5"] c')!
    expect(formulaCell.getAttribute('t')).toBe('inlineStr')
    expect(formulaCell.querySelector('f')).toBeNull()
    expect(formulaCell.textContent).toBe('=HYPERLINK("http://example.invalid","x")')
    expect(sheet.querySelector('row[r="7"] c')?.textContent).toBe('Soap & <Scrub> "Plus"')
  })

  it('drops characters XML cannot carry instead of producing a damaged file', () => {
    const bad = buildExportTable([product('Bad\u0001name\u0000', 'Misc')], { title: 'x', columns: [] })
    expect(parse(unzip(buildXlsx(bad))['xl/worksheets/sheet1.xml']!).querySelector('row[r="5"] c')?.textContent).toBe('Badname')
  })
})

describe('Word file', () => {
  const table = buildExportTable(products, { title: 'Customer prices', columns: ['category', 'unit'], generatedOn: on })
  const files = unzip(buildDocx(table, on))

  it('has the parts Word needs, and every part is well-formed XML', () => {
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
    for (const text of Object.values(files)) parse(text)
  })

  it('has the title, the date and count, and a table with a repeating header and formatted prices', () => {
    const document = parse(files['word/document.xml']!)
    const paragraphs = [...document.querySelectorAll('body > p')].map((paragraph) => paragraph.textContent).filter(Boolean)
    expect(paragraphs).toEqual(['Customer prices', 'October 31, 2026 · 3 products'])
    const rows = [...document.querySelectorAll('tbl > tr')]
    expect(rows).toHaveLength(4)
    expect(rows[0]!.querySelector('tblHeader')).not.toBeNull()
    expect([...rows[0]!.querySelectorAll('tc')].map((cell) => cell.textContent)).toEqual(['Product', 'Category', 'Unit', 'Selling price'])
    expect([...rows[2]!.querySelectorAll('tc')].map((cell) => cell.textContent)).toEqual(['Coke Mismo', 'Beverages', 'bottle', '₱15.00'])
    expect(document.querySelectorAll('tblGrid > gridCol')).toHaveLength(4)
    expect(rows[3]!.textContent).toContain('Soap & <Scrub> "Plus"')
  })
})

describe('print page', () => {
  it('is a complete page with the title, a header row and escaped product text, and no script', () => {
    const html = buildPrintHtml(buildExportTable(products, { title: 'A <b>bold</b> list', columns: ['category'], generatedOn: on }))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<h1>A &lt;b&gt;bold&lt;/b&gt; list</h1>')
    expect(html).toContain('<th>Product</th><th>Category</th><th class="num">Selling price</th>')
    expect(html).toContain('Soap &amp; &lt;Scrub&gt; &quot;Plus&quot;')
    expect(html).toContain('₱29.75')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toContain('<b>bold</b>')
  })
})

describe('file names', () => {
  it('are lower-case slugs with the date and the right extension', () => {
    expect(exportFileName('Price list', 'xlsx', on)).toBe('price-list-2026-10-31.xlsx')
    expect(exportFileName('Tindahan ni Aling Nena!!', 'docx', on)).toBe('tindahan-ni-aling-nena-2026-10-31.docx')
    expect(exportFileName('../../etc/passwd', 'xlsx', on)).toBe('etc-passwd-2026-10-31.xlsx')
    expect(exportFileName('???', 'docx', on)).toBe('price-list-2026-10-31.docx')
  })
})
