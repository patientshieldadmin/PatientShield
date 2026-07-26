export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const sender = payload.from || 'Unknown Sender';
    const subject = payload.subject || 'Client Reply';
    const textBody = payload.text || '';
    const attachments = payload.attachments || [];

    if (process.env.RESEND_API_KEY) {
      const notificationHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #0284c7; border-bottom: 2px solid #0284c7; padding-bottom: 8px;">Secure Inbound Client Document</h2>
          <p><strong>From:</strong> ${sender}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Attachments Received:</strong> ${attachments.length > 0 ? attachments.map(a => a.filename).join(', ') : 'None attached'}</p>
          <div style="background: #f8fafc; padding: 15px; border-radius: 5px; margin-top: 15px;">
            <p><strong>Message:</strong></p>
            <p>${textBody}</p>
          </div>
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'PatientShield Ingestion <audit@thepatientshield.com>',
          to: ['Admin@thepatientshield.com'],
          subject: `[INBOUND DOCUMENT] Reply from ${sender}`,
          html: notificationHtml,
        }),
      });
    }

    return res.status(200).json({ status: 'success', message: 'Inbound message processed.' });
  } catch (error) {
    console.error('Inbound Webhook Error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to process inbound email.' });
  }
}
