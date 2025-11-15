const PDFDocument = require('pdfkit');
const fs = require('fs');
const logger = require('./logger');

/**
 * Generate a PDF file with credentials
 * @param {Object} data - Data to include in the PDF
 * @param {string} data.title - PDF title
 * @param {string} data.name - User name
 * @param {string} data.email - User email
 * @param {string} data.password - User password
 * @param {string} data.loginUrl - URL for logging in
 * @param {string} outputPath - Path where to save the PDF file
 * @returns {Promise<void>}
 */
const generatePDF = (data, outputPath) => {
  return new Promise((resolve, reject) => {
    try {
      // Create a new PDFDocument
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: '10X Partner Credentials',
          Author: '10X',
          Subject: 'Account Credentials'
        }
      });

      // Pipe the PDF to the output file
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Add logo if available
      try {
        const logoPath = 'public/images/logo.png'; // Adjust path as needed
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, {
            fit: [150, 150],
            align: 'center'
          });
          doc.moveDown(2);
        }
      } catch (error) {
        logger.warn(`Could not add logo to PDF: ${error.message}`);
        // Continue without logo
      }

      // Add title
      doc.fontSize(24)
        .font('Helvetica-Bold')
        .fillColor('#0D1C5A') // Primary blue color
        .text(data.title, { align: 'center' });

      doc.moveDown(2);

      // Add welcome text
      doc.fontSize(14)
        .font('Helvetica')
        .fillColor('#000000')
        .text(`Hello ${data.name},`, { align: 'left' });

      doc.moveDown(0.5);

      // Add introduction text
      doc.fontSize(12)
        .text('Welcome to the 10X Partner Program! Your application has been approved, and we\'re excited to have you on board.', {
          align: 'left'
        });

      doc.moveDown(0.5);
      
      doc.text('Below are your account credentials. Please keep this information secure.');

      doc.moveDown(2);

      // Add credentials section
      doc.fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#0D1C5A')
        .text('Account Credentials', { align: 'center' });

      doc.moveDown(1);

      // Create a credentials box
      const boxTop = doc.y;
      doc.roundedRect(50, boxTop, 495, 130, 10)
        .fillAndStroke('#f5f5f5', '#cccccc');

      // Add credentials content
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#0D1C5A')
        .text('Login URL:', 70, boxTop + 20);

      doc.fontSize(12)
        .font('Helvetica')
        .fillColor('#000000')
        .text(data.loginUrl, 170, boxTop + 20);

      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#0D1C5A')
        .text('Email:', 70, boxTop + 50);

      doc.fontSize(12)
        .font('Helvetica')
        .fillColor('#000000')
        .text(data.email, 170, boxTop + 50);

      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#0D1C5A')
        .text('Password:', 70, boxTop + 80);

      doc.fontSize(12)
        .font('Helvetica')
        .fillColor('#000000')
        .text(data.password, 170, boxTop + 80);

      doc.moveDown(9);

      // Add security note
      doc.fontSize(12)
        .font('Helvetica-Bold')
        .fillColor('#FF0000')
        .text('IMPORTANT SECURITY NOTE:', { align: 'left' });

      doc.moveDown(0.5);

      doc.fontSize(11)
        .font('Helvetica')
        .fillColor('#000000')
        .text('Please change your password immediately after logging in for the first time.', {
          align: 'left'
        });

      doc.moveDown(0.5);

      doc.text('Do not share your login credentials with anyone. This document contains sensitive information.', {
        align: 'left'
      });

      doc.moveDown(2);

      // Add next steps
      doc.fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#0D1C5A')
        .text('Next Steps:', { align: 'left' });

      doc.moveDown(0.5);

      doc.fontSize(11)
        .font('Helvetica')
        .fillColor('#000000')
        .list([
          'Log in to your partner account using the credentials above',
          'Change your password immediately',
          'Complete your partner profile',
          'Explore available promotions and campaigns'
        ], { bulletRadius: 2, textIndent: 20 });

      doc.moveDown(2);

      // Add footer
      doc.fontSize(11)
        .font('Helvetica-Oblique')
        .fillColor('#666666')
        .text('This is an automated message. If you have any questions or need assistance, please contact our support team at support@10xdrink.com.', {
          align: 'center'
        });

      // Finalize the PDF
      doc.end();

      // Handle stream events
      stream.on('finish', () => {
        logger.info(`PDF generated successfully: ${outputPath}`);
        resolve();
      });

      stream.on('error', (err) => {
        logger.error(`Error generating PDF: ${err.message}`);
        reject(err);
      });
    } catch (error) {
      logger.error(`Error generating PDF: ${error.message}`);
      reject(error);
    }
  });
};

module.exports = { generatePDF }; 