let currentCampaignId = null

document.getElementById('startBtn').addEventListener('click', async () => {
  const businessType = document.getElementById('businessType').value
  const country = document.getElementById('country').value
  const states = document.getElementById('states').value.split(',').map((s) => s.trim()).filter(Boolean)

  const response = await fetch('/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessType, country, states }),
  })
  const campaign = await response.json()
  currentCampaignId = campaign.id

  document.getElementById('startBtn').disabled = true
  document.getElementById('stopBtn').disabled = false
  document.getElementById('status').textContent = `Campaign #${campaign.id} running: ${states.join(', ')}`
})

document.getElementById('stopBtn').addEventListener('click', async () => {
  if (!currentCampaignId) return
  await fetch(`/campaigns/${currentCampaignId}/stop`, { method: 'POST' })
  document.getElementById('status').textContent = `Campaign #${currentCampaignId} stopped.`
  document.getElementById('startBtn').disabled = false
  document.getElementById('stopBtn').disabled = true
})
