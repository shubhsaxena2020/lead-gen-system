import { execFile } from 'node:child_process'
import 'dotenv/config'
import type { LeadRow } from '../types.js'

interface ReviewResult {
  clean: LeadRow[]
  flagged: LeadRow[]
}

function runOpenCode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'opencode',
      ['run', '--agent', process.env.OPENCODE_AGENT_NAME ?? 'leadgen-reviewer', prompt],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        resolve(stdout)
      }
    )
  })
}

export async function reviewBatch(leads: LeadRow[]): Promise<ReviewResult> {
  const prompt = [
    'Review this batch of business leads for likely errors: garbled fields,',
    'obvious duplicate entries, or mismatched contact info.',
    'Respond with ONLY JSON: {"flaggedIndexes": [<0-based indexes of bad rows>]}.',
    '',
    JSON.stringify(leads, null, 2),
  ].join('\n')

  const stdout = await runOpenCode(prompt)
  const parsed = JSON.parse(stdout) as { flaggedIndexes: number[] }
  const flaggedSet = new Set(parsed.flaggedIndexes)

  const clean: LeadRow[] = []
  const flagged: LeadRow[] = []

  leads.forEach((lead, index) => {
    if (flaggedSet.has(index)) {
      flagged.push(lead)
    } else {
      clean.push(lead)
    }
  })

  return { clean, flagged }
}
