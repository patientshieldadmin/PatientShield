export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const isPortalUpload = body.isPortalUpload || false;
    const fullName = body.fullName || 'Valued Client';
    const clientEmail = body.email || 'client@thepatientshield.com';
    const hospitalName = body.hospitalName || 'Target Hospital';
    const phone = body.phone || 'Unspecified';
    const fileName = body.fileName || 'Itemized Bill Uploaded';
    const fileData = body.fileData || null;
    const eobName = body.eobName || 'Not Provided';
    const recordsName = body.recordsName || 'Not Provided';

    let extractedBillAmount = isPortalUpload ? 'Existing Case Total' : '$0';
    let analysisFindings = [];
    let estimatedSavingsValue = 'Pending Complete Review';
    let disputeLetterDraft = 'Draft pending complete document verification.';
    let isAValidMedicalBill = true;
    let validationErrorMessage = '';

    if (!isPortalUpload && process.env.OPENAI_API_KEY && fileData) {
      try {
        let userContent = [
          {
            type: 'text',
            text: `Hospital Name: ${hospitalName}\nAnalyze this uploaded document. First, check if this document is a valid hospital itemized bill, UB-04, or medical billing statement. If it is NOT a medical bill or billing document, set "isValidBill": false and provide an explanation. If it IS valid, extract the exact total bill amount, identify line-item markup errors, unbundled charges, or phantom items, and output a JSON object.`
          },
          {
            type: 'image_url',
            image_url: { url: fileData }
          }
        ];

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
                content: 'You are an elite medical bill forensic auditor. Validate whether the uploaded document is a legitimate hospital bill. Return a JSON object strictly with: { "isValidBill": boolean, "invalidReason": string, "extractedTotal": string, "findings": [{ "category": string, "description": string }], "estimatedSavings": string, "disputeLetter": string }'
              },
              {
                role: 'user',
                content: userContent
              }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 1500
          })
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          if (openaiData.choices?.[0]?.message?.content) {
            const parsed = JSON.parse(openaiData.choices[0].message.content);
            if (parsed.isValidBill === false) {
              isAValidMedicalBill = false;
              validationErrorMessage = parsed.invalidReason || 'The uploaded document does not appear to be a valid hospital itemized bill.';
            } else {
              if (parsed.extractedTotal) extractedBillAmount = parsed.extractedTotal;
              if (parsed.findings) analysisFindings = parsed.findings;
              if (parsed.estimatedSavings) estimatedSavingsValue = parsed.estimatedSavings;
              if (parsed.disputeLetter) disputeLetterDraft = parsed.disputeLetter;
            }
          }
        }
      } catch (aiErr) {
        console.error('AI Validation Error:', aiErr);
      }
    }

    if (!isPortalUpload && !isAValidMedicalBill) {
      return res.status(400).json({ 
        status: 'error', 
        message: `Document Validation Failed: ${validationErrorMessage} Please upload a valid itemized hospital bill.` 
      });
    }

    try {
      const leadId = Date.now().toString();
      const leadData = {
        id: leadId,
        fullName,
        clientEmail,
        phone,
        hospitalName,
        extractedBillAmount,
        fileName,
        fileData, // Saved so admin can view/download it
        eobName,
        recordsName,
        analysisFindings,
        disputeLetterDraft,
        submittedAt: new Date().toISOString()
      };

      const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
      const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

      if (redisUrl && redisToken) {
        await fetch(redisUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(['SET', `lead:${leadId}`, JSON.stringify(leadData)])
        });
        await fetch(redisUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(['SADD', 'all_leads', leadId])
        });
      }
    } catch (dbErr) {
      console.error('Database Storage Error:', dbErr);
    }

    return res.status(200).json({ status: 'success', message: 'Documents processed securely.' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error during document processing.' });
  }
}
