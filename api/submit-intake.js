export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const fullName = body.fullName || 'Valued Client';
    const clientEmail = body.email || 'client@thepatientshield.com';
    const hospitalName = body.hospitalName || 'Target Hospital';
    const billAmount = body.billAmount || '0';
    const fileName = body.fileName || 'Itemized Bill';

    const estimatedSavings = 'Estimated 35% - 55% Reduction Range';

    // Dispatch emails via Resend securely
    if (process.env.RESEND_API_KEY) {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 8px;">PatientShield Audit Report</h2>
          <p>Hello <strong>${fullName}</strong>,</p>
          <p>We have securely received your intake and itemized bill (<strong>${fileName}</strong>) for <strong>${hospitalName}</strong>.</p>
          
          <h3 style="color: #333; margin-top: 20px;">Summary</h3>
          <ul style="line-height: 1.6; background: #f9f9f9; padding: 15px; border-radius: 5px; list-style-type: none;">
            <li><strong>Hospital:</strong> ${hospitalName}</li>
            <li><strong>Submitted Bill Amount:</strong> $${billAmount}</li>
            <li><strong>Estimated Potential Savings:</strong> <span style="color: #0284c7; font-weight: bold;">${estimatedSavings}</span></li>
          </ul>

          <p style="margin-top: 20px;"><strong>Next Steps:</strong> Our clinical advocacy team is reviewing your files to prepare your formal dispute packet.</p>
        </div>
      `;

      // Send to client and admin
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'PatientShield <audit@thepatientshield.com>',
          to: [clientEmail, 'Admin@thepatientshield.com'],
          subject: `Audit Results: ${fullName} - ${hospitalName}`,
          html: emailHtml,
        }),
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Intake processed successfully.'
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during processing.'
    });
  }
}
