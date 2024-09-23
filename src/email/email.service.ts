import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: any;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  async sendContactEmail(
    firstName: string,
    lastName: string,
    email: string,
    message: string,
  ) {
    const mailOptions = {
      from: `"${lastName} ${firstName}" <${email}>`,
      to: 'sleekyprogrammers@gmail.com',
      subject: 'New Contact Form Submission',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Contact Form Submission</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f4f4;
                    margin: 0;
                    padding: 0;
                }
                .email-container {
                    background-color: #ffffff;
                    margin: 0 auto;
                    padding: 20px;
                    max-width: 600px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    border-radius: 10px;
                }
                .header {
                    background-color: #2C3E50;
                    padding: 10px;
                    text-align: center;
                    color: #fff;
                    border-radius: 10px 10px 0 0;
                }
                .header h1 {
                    margin: 0;
                    font-size: 24px;
                }
                .content {
                    margin: 20px 0;
                    line-height: 1.6;
                    color: #333333;
                }
                .content p {
                    margin-bottom: 15px;
                }
                .footer {
                    margin-top: 20px;
                    text-align: center;
                    font-size: 14px;
                    color: #999999;
                }
                .footer a {
                    color: #2C3E50;
                    text-decoration: none;
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="header">
                <h1>New Contact Form Submission</h1>
                </div>
                <div class="content">
                    <p><strong>First Name:</strong> ${firstName}</p>
                    <p><strong>Last Name:</strong> ${lastName}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Message:</strong></p>
                    <p>${message}</p>
                </div>
                <div class="footer">
                    <p>This message was sent from your website's contact form.</p>
                    <p>&copy; ${new Date().getFullYear()} Sleeky Programmers Ltd. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>`,
    };

    return this.transporter.sendMail(mailOptions);
  }
}
