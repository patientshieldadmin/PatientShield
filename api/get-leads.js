import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  try {
    const leadIds = await kv.smembers('all_leads') || [];
    let leads = [];

    for (const id of leadIds) {
      const lead = await kv.get(`lead:${id}`);
      if (lead) leads.push(lead);
    }

    // Sort newest first
    leads.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    return res.status(200).json({ status: 'success', leads });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Failed to fetch leads' });
  }
}
