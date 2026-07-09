import express from 'express'
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { handleStartCampaign, handleStopCampaign, handleCampaignsStatus } from './routes.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use(express.static('public'))

  app.post('/campaigns', handleStartCampaign)
  app.post('/campaigns/:id/stop', handleStopCampaign)
  app.get('/campaigns/status', handleCampaignsStatus)

  return app
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { resetStaleInProgressStates, getRunningCampaigns } = await import('../campaign/queue.js')
  const { processCampaign } = await import('../campaign/worker.js')
  await resetStaleInProgressStates()

  const runningCampaigns = await getRunningCampaigns()
  for (const campaign of runningCampaigns) {
    void processCampaign(campaign.id, campaign.businessType, campaign.country)
  }

  const app = createApp()
  const port = Number(process.env.PORT ?? 3000)
  app.listen(port, () => console.log(`Lead-gen dashboard listening on port ${port}`))
}
