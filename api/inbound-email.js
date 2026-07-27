export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const senderEmail = payload.from || '';
    const attachments = payload.attachments || [];

    if (!senderEmail) {
      return res.status(400).json({ status: 'error', message: 'No sender email provided' });
    }

    const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
    const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (redisUrl && redisToken) {
      // Fetch all lead IDs from the database
      const setRes = await fetch(redisUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['SMEMBERS', 'all_leads'])
      });
      const setData = await setRes.json();
      const leadIds = setData.result || [];

      // Find the matching client lead by email address
      for (const leadId of leadIds) {
        const leadRes = await fetch(redisUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(['GET', `lead:${leadId}`])
        });
        const leadDataJson = await leadRes.json();
        
        if (leadDataJson.result) {
          const lead = JSON.parse(leadDataJson.result);
          if (lead.clientEmail && senderEmail.toLowerCase().includes(lead.clientEmail.toLowerCase())) {
            
            // If attachments were sent in the reply, update the client's file vault
            if (attachments.length > 0) {
              const attachment = attachments[0];
              lead.recordsName = attachment.filename || 'Client_Reply_Document.pdf';
              if (attachment.content) {
                lead.fileData = `data:${attachment.content_type || 'application/pdf'};base64,${attachment.content}`;
              }
            }

            // Save updated lead back to Upstash Redis
            await fetch(redisUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(['SET', `lead:${leadId}`, JSON.stringify(lead)])
            });
            break;
          }
        }
      }
    }

    return res.status(200).json({ status: 'success', message: 'Inbound email and attachments processed successfully.' });
  } catch (error) {
    console.error('Inbound Email Webhook Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error processing inbound email.' });
  }
}
