import { google } from 'googleapis'
import 'dotenv/config'
import type { LeadRow } from '../types.js'

const PENDING_TAB = 'Pending Review'
const MASTER_TAB = 'Master'

const HEADER_ORDER: (keyof LeadRow)[] = [
  'businessName', 'country', 'state', 'city', 'phone', 'email', 'socialLink', 'websiteStatus', 'dateFound',
]

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const client = await auth.getClient()
  return google.sheets({ version: 'v4', auth: client as never })
}

function leadToRow(lead: LeadRow): string[] {
  return HEADER_ORDER.map((key) => String(lead[key]))
}

export async function appendToPendingReview(lead: LeadRow): Promise<void> {
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${PENDING_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [leadToRow(lead)] },
  })
}

export async function getPendingReviewRows(): Promise<string[][]> {
  const sheets = await getSheetsClient()
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${PENDING_TAB}!A2:I`,
  })
  return result.data.values ?? []
}

/**
 * Clear all data rows from Pending Review (keeping the header). Call this once
 * a batch has been reviewed and clean rows promoted to Master — otherwise
 * Pending Review grows without bound, the every-500-leads batch threshold
 * never resets, and MiMo ends up re-reviewing the entire accumulated history
 * on every subsequent lead instead of once per batch.
 */
export async function clearPendingReview(): Promise<void> {
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.clear({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${PENDING_TAB}!A2:I`,
  })
}

export async function promoteRowsToMaster(rows: string[][]): Promise<void> {
  if (rows.length === 0) return
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${MASTER_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  })
}
