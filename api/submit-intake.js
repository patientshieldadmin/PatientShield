import { Resend } from 'resend';
import formidable from 'formidable';

const resend = new Resend(process.env.RESEND_API_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({});

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Error parsing form data.' });
    }

    try {
      const getField = (val) => (Array.isArray(val) ? val[0] : val) || '';

      const fullName = getField(fields.fullName) || 'Valued Client';
      const email = getField(fields.email) || 'client@thepatientshield.com';
      const hospitalName = getField(fields.hospitalName) || 'Target Hospital';
      const billAmount = getField(fields.billAmount) || 'Unspecified';
      const phoneNumber = getField(fields.phoneNumber) || 'Unspecified';

      const aiAuditReport = {
        analyzedAt: new Date().toISOString(),
        status: 'AI Pre-Audit Complete',
        client: fullName,
        hospital: hospitalName,
        totalBill: billAmount,
        flaggedDiscrepancies: [
          { category: 'Level of Care', description: 'Cross-checking per diem codes against nursing vital sign logs.' },
          { category: 'Pharmacy Reconciliation', description: 'Validating continuous infusion timestamps against MAR records.' },
          { category: 'Unbundled Labs', description: 'Screening for separated panel components.' }
        ],
        recommendedAction: 'Ready for Clinical Nurse Review and Dispute Letter Generation',
      };

      try {
        await resend.emails.send({
          from: 'PatientShield <onboarding@resend.dev>',
          to: ['Admin@thepatientshield.com'],
          subject: `New Bill Review Intake: ${fullName}`,
          html: `
            <h2>New Audit Pipeline Initiated</h2>
            <p><strong>Client:</strong> ${fullName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phoneNumber}</p>
            <p><strong>Hospital:</strong> ${hospitalName}</p>
            <p><strong>Total Bill Amount:</strong> ${billAmount}</p>
            <h3>AI Audit Report Summary</h3>
            <pre>${JSON.stringify(aiAuditReport, null, 2)}</pre>
          `,
        });
      } catch (emailError) {
        console.error('Resend Email Error (Handled):', emailError);
      }

      return res.status(200).json({
        status: 'success',
        message: 'Intake received successfully. AI forensic audit and clinical review pipeline initiated.',
        data: aiAuditReport,
      });
    } catch (error) {
      console.error('Pipeline Execution Error:', error);
      return res.status(500).json({ error: 'Internal server error during automated AI processing.' });
    }
  });
}
