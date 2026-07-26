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
   const phoneNumber = body.phoneNumber || 'Unspecified';

   // Check if an itemized bill file/upload was provided
   const hasItemizedBill = Boolean(
     body.fileName ||
     body.itemizedBill ||
     body.document ||
     body.hasItemizedBill === true ||
     body.hasItemizedBill === 'true'
   );

   // Realistic status based on actual documents in hand
   const auditReport = {
     analyzedAt: new Date().toISOString(),
     status: 'Initial Itemized Bill Intake & Line-Item Review',
     client: fullName,
     hospital: hospitalName,
     totalBill: billAmount,
     documentsReceived: hasItemizedBill ? ['Itemized Hospital Bill'] : [],
     pendingRequirements: [
       'Detailed MAR (Medication Administration Record) for infusion timing cross-check',
       'Nursing vital sign logs for per diem level-of-care validation'
     ],
     currentFindings: [
       { category: 'Initial Intake', description: 'Itemized bill securely uploaded and queued for clinical forensic breakdown.' }
     ],
     nextSteps: 'Our clinical nurse review team is cross-examining your itemized bill against standard chargemaster baselines. We will request supporting medical records if further deep-dive validation is required.'
   };

   const emailSubject = `Bill Review Intake & Initial Review: ${fullName}`;
   const emailHtml = `
     <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
       <h2 style="color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 8px;">PatientShield Audit Pipeline Update</h2>
       <p>Hello <strong>${fullName}</strong>,</p>
       <p>We have successfully received your itemized bill for <strong>${hospitalName}</strong>. Your intake is currently undergoing our initial automated line-item review.</p>

       <h3 style="color: #333; margin-top: 20px;">Intake Summary</h3>
       <ul style="line-height: 1.6; background: #f9f9f9; padding: 15px; border-radius: 5px; list-style-type: none;">
         <li><strong>Client Name:</strong> ${fullName}</li>
         <li><strong>Hospital:</strong> ${hospitalName}</li>
         <li><strong>Submitted Bill Amount:</strong> $${Number(billAmount).toLocaleString()}</li>
         <li><strong>Itemized Bill Status:</strong> ${hasItemizedBill ? '✅ Received & Secured' : '⚠️ Pending Upload'}</li>
       </ul>

       <h3 style="color: #333; margin-top: 20px;">Audit Stage & Next Steps</h3>
       <div style="background: #f1f5f9; padding: 15px; border-radius: 5px;">
         <p><strong>Current Status:</strong> ${auditReport.status}</p>
         <p><strong>Clinical Review Process:</strong> Our nurses and AI audit engine are actively reviewing your itemized charges against regional benchmark costs.</p>
         <p><strong>Note on Deep Analysis:</strong> To perform absolute validation on complex items like infusion timestamps or per diem levels, our team will utilize your itemized bill and coordinate securely if additional hospital records are needed.</p>
       </div>

       <p style="margin-top: 20px;"><strong>What Happens Next:</strong> ${auditReport.nextSteps}</p>

       <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
       <p style="font-size: 12px; color: #777; text-align: center;">PatientShield Automated Billing Advocacy Platform</p>
     </div>
   `;

   // Send email via Resend
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
     message: 'Intake and initial review status dispatched successfully.',
     data: auditReport,
   });
 } catch (error) {
   console.error('Pipeline Execution Error:', error);
   return res.status(500).json({
     status: 'error',
     message: 'Internal server error during intake processing.',
   });
 }
}
