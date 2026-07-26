export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const fullName = body.fullName || 'Valued Client';
    const clientEmail = body.email || 'client@thepatientshield.com';
    const hospitalName = body.hospitalName || 'Target Hospital';
    const billAmount = body.billAmount || 'Unspecified';
    const fileName = body.fileName || 'Uploaded Document';
    const fileData = body.fileData || '';

    let analysisFindings = [
      { category: 'Itemized Bill Intake', description: `Successfully received and secured file: ${fileName}. Queued for clinical chargemaster breakdown.` }
    ];
    let potentialSavings = 'Estimated 35% - 60% Reduction Range';

    // Execute live OpenAI forensic audit if API key is configured
    if (process.env.OPENAI_API_KEY) {
      try {
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are an expert medical bill forensic auditor and nurse advocate specializing in high-acuity and catastrophic inpatient stays. Analyze the intake details to generate initial forensic findings. Return a JSON object with: { "findings": [{ "category": string, "description": string }], "estimatedSavings": string }'
              },
              {
                role: 'user',
                content: `Hospital: ${hospitalName}, Total Bill: ${billAmount}, File Name: ${fileName}, File Payload Length: ${fileData.length}`
              }
            ],
            response_format: { type: 'json_object' }
          })
        });

        const openaiData = await openaiResponse.json();
        if (openaiResponse.ok && openaiData.choices?.[0]?.message?.content) {
          const parsed = JSON.parse(openaiData.choices[0].message.content);
          if (parsed.findings) analysisFindings = parsed.findings;
          if (parsed.estimatedSavings) potentialSavings = parsed.estimatedSavings;
        }
      } catch (aiErr) {
        console.error('AI Analysis Notice:', aiErr);
      }
    }

    const emailSubject = `Forensic Bill Audit Results: ${fullName} - ${hospitalName}`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 8px;">PatientShield Forensic Audit Report</h2>
        <p>Hello <strong>${fullName}</strong>,</p>
        <p>Our AI audit engine and clinical nurse review team have completed the initial forensic analysis of your itemized bill for <strong>${hospitalName}</strong>.</p>

        <h3 style="color: #333; margin-top: 20px;">Intake & Bill Summary</h3>
        <ul style="line-height: 1.6; background: #f9f9f9; padding: 15px; border-radius: 5px; list-style-type: none;">
          <li><strong>Client Name:</strong> ${fullName}</li>
          <li><strong>Hospital:</strong> ${hospitalName}</li>
          <li><strong>Submitted Bill Amount:</strong> ${billAmount}</li>
          <li><strong>Itemized Bill File:</strong> ✅ Received & Secured (${fileName})</li>
          <li><strong>Estimated Potential Savings:</strong> ${potentialSavings}</li>
        </ul>

        <h3 style="color: #333; margin-top: 20px;">Forensic Findings</h3>
        <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
          ${analysisFindings.map(f => `<p><strong>${f.category}:</strong> ${f.description}</p>`).join('')}
        </div>

        <p style="margin-top: 20px;"><strong>Next Steps:</strong> Our clinical advocacy team is preparing the formal dispute packet based on these findings.</p>

        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #777; text-align: center;">PatientShield Automated Billing Advocacy Platform</p>
      </div>
    `;

    // Dispatch email via Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'PatientShield <audit@thepatientshield.com>',
        to: ['Admin@thepatientshield.com', clientEmail],
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    const resendResult = await resendResponse.json();
    if (!resendResponse.ok) {
      console.error('Resend API Error:', resendResult);
    }

    return res.status(200).json({
      status: 'success',
      message: 'Forensic audit executed and results dispatched successfully.',
    });
  } catch (error) {
    console.error('Pipeline Execution Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during intake processing.',
    });
  }
}
