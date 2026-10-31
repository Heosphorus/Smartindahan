/** One line of the bulk box. `price` is what was typed after the last comma, or '' when the line has none. */
export type BulkLine = { name: string; price: string }

/** "Safeguard Soap, 20" is the product Safeguard Soap at ₱20. A line whose last comma is not followed by a number (such as "Nido, 400g") is all name. */
export function parseBulkLine(line: string): BulkLine {
  const match = /^(.*\S)\s*,\s*₱?\s*(\d[\d.]*|\.\d[\d.]*)$/.exec(line.trim())
  return match ? { name: match[1]!, price: match[2]! } : { name: line.trim(), price: '' }
}
