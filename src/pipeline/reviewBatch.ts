import { spawn } from 'node:child_process'
import 'dotenv/config'
import type { LeadRow } from '../types.js'

interface ReviewResult {
  clean: LeadRow[]
  flagged: LeadRow[]
}

function runOpenCode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // execFile defaults to an open, never-closed stdin pipe - opencode treats
    // that as "input is being piped in" and blocks waiting for EOF that never
    // arrives, hanging forever instead of ever returning. execFile's options
    // don't support overriding stdio, so use spawn (which does) instead.
    const child = spawn(
      'opencode',
      ['run', '--agent', process.env.OPENCODE_AGENT_NAME ?? 'leadgen-reviewer', prompt],
      { stdio: ['ignore', 'pipe', 'pipe'] }
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
