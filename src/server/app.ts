import express from 'express'
import 'dotenv/config'
import { handleStartCampaign, handleStopCampaign } from './routes.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use(express.static('public'))

  app.post('/campaigns', handleStartCampaign)
  app.post('/campaigns/:id/stop', handleStopCampaign)

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { resetStaleInProgressStates } = await import('../campaign/queue.js')
  await resetStaleInProgressStates()

  const app = createApp()
  const port = Number(process.env.PORT ?? 3000)
  app.listen(port, () => console.log(`Lead-gen dashboard listening on port ${port}`))
}
