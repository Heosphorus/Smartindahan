import nodemailer from 'nodemailer'
import { Resend } from 'resend'

import { env } from '../config/env.js'

export type EmailTemplate = {
  to: string
  subject: string
  html: string
  text: string
}

const transporter = nodemailer.createTransport({
  host: env.emailHost,
  port: env.emailPort,
  secure: false,
  auth:
    env.emailUser && env.emailPassword
      ? {
          user: env.emailUser,
          pass: env.emailPassword,
        }
      : undefined,
})

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null

export async function sendVerificationEmail(email: string, otp: string): Promise<void> {
  const message: EmailTemplate = {
    to: email,
    subject: 'Your SariSmart verification code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
        <h2 style="margin-bottom: 12px; color: #111827;">SariSmart</h2>
        <p style="font-size: 16px;">Verify your email address</p>
        <p>Hello,</p>
        <p>Thank you for creating your SariSmart account.</p>
        <p>Your verification code is:</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 24px 0; color: #0f172a;">${otp}</div>
        <p>This code will expire in 5 minutes.</p>
        <p>If you did not create a SariSmart account, you can safely ignore this email.</p>
        <p style="margin-top: 28px; font-weight: 600;">SariSmart</p>
        <p style="color: #475569;">Smarter Tools for Smarter Tindahan.</p>
      </div>
    `,
    text: `SariSmart\n\nVerify your email address\n\nYour verification code is: ${otp}\n\nThis code will expire in 5 minutes.`,
  }

  await sendEmail(message)
}

export async function sendPasswordResetEmail(email: string, otp: string): Promise<void> {
  const message: EmailTemplate = {
    to: email,
    subject: 'Your SariSmart password reset code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
        <h2 style="margin-bottom: 12px; color: #111827;">SariSmart</h2>
        <p>Reset your password</p>
        <p>Hello,</p>
        <p>We received a request to reset your password.</p>
        <p>Your reset code is:</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 24px 0; color: #0f172a;">${otp}</div>
        <p>This code will expire in 5 minutes.</p>
        <p>If you did not request this reset, you can ignore this email.</p>
      </div>
    `,
    text: `SariSmart\n\nReset your password\n\nYour reset code is: ${otp}\n\nThis code will expire in 5 minutes.`,
  }

  await sendEmail(message)
}

export async function sendLoginNotification(email: string): Promise<void> {
  const message: EmailTemplate = {
    to: email,
    subject: 'Your SariSmart login was detected',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
        <h2 style="margin-bottom: 12px; color: #111827;">SariSmart</h2>
        <p>Login detected</p>
        <p>Hello,</p>
        <p>This email confirms a successful login to your SariSmart account.</p>
      </div>
    `,
    text: 'A login was detected for your SariSmart account.',
  }

  await sendEmail(message)
}

async function sendEmail({ to, subject, html, text }: EmailTemplate): Promise<void> {
  if (env.emailMode === 'development') {
    console.info(`[Email Development] To: ${to} | Subject: ${subject}`)
    return
  }

  if (env.emailProvider === 'resend') {
    if (!resend) {
      throw new Error('Resend is not configured. Please set RESEND_API_KEY.')
    }

    const { error } = await resend.emails.send({
      from: env.emailFrom,
      to: [to],
      subject,
      html,
      text,
    })

    if (error) {
      throw new Error(`Resend email delivery failed: ${error.message}`)
    }

    return
  }

  if (!env.emailHost || !env.emailUser || !env.emailPassword) {
    throw new Error('SMTP email service is not configured. Please set EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD.')
  }

  await transporter.sendMail({
    from: env.emailFrom,
    to,
    subject,
    html,
    text,
  })
}
