// ── hello@k0-board.com, forwarded ────────────────────────────────────────────
// Mail sent to the site's contact address lands in Amazon SES, which stores the raw message in S3
// and then calls this function. It sends the message on to the person who runs k0, through Resend
// (the same sender the waitlist emails use), with the original attached and Reply-To set to whoever
// wrote, so answering from the inbox answers them.
//
// Runs on AWS Lambda's Node runtime, whose AWS SDK is built in: nothing is bundled. Where it goes
// and with which key are environment variables on the function — FORWARD_TO, RESEND_API_KEY,
// BUCKET, PREFIX — never in this file. Set up by hand once; see docs/cloud.md.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({})

/** One header from a raw message, unfolded. Enough to name the sender and the subject. */
function header(raw, name) {
  const head = raw.split(/\r?\n\r?\n/)[0]
  const m = new RegExp(`^${name}:([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, 'im').exec(head)
  return m ? m[1].replace(/\r?\n[ \t]+/g, ' ').trim() : ''
}

/** Encoded-word subjects (`=?UTF-8?B?…?=`) as people wrote them. */
function decodeWords(text) {
  return text.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64')
        : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
      return new TextDecoder(charset).decode(bytes)
    } catch {
      return data
    }
  })
}

/** The address inside `Name <address>`, for Reply-To. */
const address = (from) => (/<([^>]+)>/.exec(from)?.[1] || from).trim()

export async function handler(event) {
  const mail = event.Records?.[0]?.ses?.mail
  if (!mail) return { status: 'no mail in the event' }
  const key = `${process.env.PREFIX || ''}${mail.messageId}`
  const object = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: key }))
  const raw = Buffer.from(await object.Body.transformToByteArray())
  const text = raw.toString('utf8')
  const from = decodeWords(header(text, 'From')) || mail.source
  const subject = decodeWords(header(text, 'Subject')) || '(no subject)'
  const to = (mail.destination || []).join(', ')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'k0 inbox <inbox@mail.k0-board.com>',
      to: [process.env.FORWARD_TO],
      reply_to: address(from),
      subject: `[${to}] ${subject}`,
      text: `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\nThe original message is attached. Reply to this email to answer ${address(from)}.`,
      attachments: [{ filename: 'message.eml', content: raw.toString('base64') }],
    }),
  })
  if (!res.ok) throw new Error(`Resend said ${res.status}: ${await res.text()}`)
  return { status: 'forwarded', messageId: mail.messageId }
}
