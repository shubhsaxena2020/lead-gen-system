export type CampaignStatus = 'running' | 'stopped' | 'completed'
export type StateQueueStatus = 'pending' | 'in_progress' | 'done'

export interface Campaign {
  id: number
  businessType: string
  country: string
  status: CampaignStatus
  createdAt: Date
}

export interface StateQueueItem {
  id: number
  campaignId: number
  stateName: string
  status: StateQueueStatus
}

export interface RawBusiness {
  name: string
  street: string | null
  city: string | null
  phone: string | null
  email: string | null
  facebook: string | null
  instagram: string | null
  hasWebsite: boolean
}

export interface LeadRow {
  businessName: string
  country: string
  state: string
  city: string
  phone: string
  email: string
  socialLink: string
  websiteStatus: 'none'
  dateFound: string
}
