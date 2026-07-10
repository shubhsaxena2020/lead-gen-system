import { spawn } from 'node:child_process'
import 'dotenv/config'
import type { LeadRow } from '../types.js'

interface ReviewResult {
  clean: LeadRow[]
  flagged: LeadRow[]
}

function runOpenCode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // The prompt used to be passed as a CLI argument, but a large review
    // batch serializes to more bytes than the OS allows in a single process's
    // argv (spawn fails with E2BIG). Pipe it over stdin instead - explicitly
    // writing then ending the stream avoids the original hang bug too (that
    // one came from execFile's default of leaving stdin open with nothing
    // ever written to it, so opencode blocked forever waiting for EOF).
    const child = spawn(
      'opencode',
      ['run', '--agent', process.env.OPENCODE_AGENT_NAME ?? 'leadgen-reviewer'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`opencode exited with code ${code}: ${stderr}`))
        return
      }
      resolve(stdout)
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// The model sometimes prefixes its answer with reasoning prose before the
// JSON object despite being told to respond with ONLY JSON (observed live:
// "Looking at this batch, I'll scan for..." ahead of the real payload).
// Slicing from the first '{' to the last '}' recovers the object regardless
// of surrounding commentary.
function extractJson(text: string): { flaggedIndexes: number[] } {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in opencode response: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text.slice(start, end + 1))
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
  const parsed = extractJson(stdout)
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
