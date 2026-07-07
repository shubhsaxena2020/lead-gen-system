import type { Request, Response } from 'express'
import { createCampaign, stopCampaign } from '../campaign/queue.js'
import { processCampaign } from '../campaign/worker.js'

export async function handleStartCampaign(req: Request, res: Response): Promise<void> {
  const { businessType, country, states } = req.body as {
    businessType: string
    country: string
    states: string[]
  }

  const campaign = await createCampaign(businessType, country, states)

  // Fire-and-forget: the worker runs in the background, the HTTP response
  // doesn't wait for the whole campaign to finish.
  void processCampaign(campaign.id, businessType, country)

  res.json(campaign)
}

export async function handleStopCampaign(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id)
  await stopCampaign(id)
  res.json({ stopped: true })
}
