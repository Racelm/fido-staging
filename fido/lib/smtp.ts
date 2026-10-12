/**
 * Client SMTP minimal (sans dépendance) pour l'envoi transactionnel via une
 * boîte mail classique, p. ex. Hostinger (smtp.hostinger.com).
 *
 *   - Port 465 → TLS implicite (recommandé chez Hostinger)
 *   - Port 587 → STARTTLS obligatoire (on refuse d'envoyer le mot de passe en clair)
 *   - Authentification AUTH PLAIN / AUTH LOGIN
 *   - Corps HTML encodé en base64 (UTF-8), en-têtes encodés RFC 2047
 *
 * Usage serveur uniquement.
 */

import net from 'node:net'
import tls from 'node:tls'
import { randomBytes } from 'node:crypto'

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean // true = TLS implicite (465), false = STARTTLS (587)
  user: string
  pass: string
  /** Pour les tests uniquement (certificat auto-signé). */
  tlsOptions?: tls.ConnectionOptions
}

export type SmtpMessage = {
  fromName: string
  fromAddress: string
  to: string
  subject: string
  html: string
  replyTo?: string
}

const TIMEOUT_MS = 15_000

/** Lit la configuration SMTP depuis l'environnement, ou null si absente. */
export function smtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  const port = Number(process.env.SMTP_PORT || 465)
  const secureEnv = process.env.SMTP_SECURE
  const secure = secureEnv ? secureEnv === 'true' : port === 465
  return { host, port, secure, user, pass }
}

function assertNoCrlf(label: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`SMTP: invalid ${label} (line break)`)
}

function assertAddress(label: string, value: string): void {
  assertNoCrlf(label, value)
  if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(value)) {
    throw new Error(`SMTP: invalid ${label} address`)
  }
}

/** Encodage RFC 2047 (UTF-8 base64) si le texte n'est pas en ASCII simple. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function wrapBase64(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n')
}

export function buildMimeMessage(msg: SmtpMessage, now = new Date()): string {
  const domain = msg.fromAddress.split('@')[1] || 'localhost'
  const safeName = msg.fromName.replace(/["\\]/g, '')
  const headers = [
    `From: "${encodeHeader(safeName)}" <${msg.fromAddress}>`,
    `To: <${msg.to}>`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  if (msg.replyTo) headers.push(`Reply-To: <${msg.replyTo}>`)
  // base64 → aucune ligne ne commence par « . », pas besoin de dot-stuffing.
  return (
    headers.join('\r\n') +
    '\r\n\r\n' +
    wrapBase64(Buffer.from(msg.html, 'utf8').toString('base64'))
  )
}

type Reply = { code: number; lines: string[] }

/** Petite session SMTP : lit les réponses (multi-lignes) et envoie des commandes. */
class SmtpSession {
  private buffer = ''
  private pending: Reply['lines'] = []
  private waiter: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null
  private queue: Reply[] = []
  private failure: Error | null = null

  constructor(private socket: net.Socket) {
    this.attach(socket)
  }

  attach(socket: net.Socket): void {
    this.socket = socket
    socket.setEncoding('utf8')
    socket.setTimeout(TIMEOUT_MS)
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('timeout', () => this.fail(new Error('SMTP: timeout')))
    socket.on('error', (err) => this.fail(err))
    socket.on('close', () => this.fail(new Error('SMTP: connection closed')))
  }

  detach(): net.Socket {
    this.socket.removeAllListeners('data')
    this.socket.removeAllListeners('timeout')
    this.socket.removeAllListeners('error')
    this.socket.removeAllListeners('close')
    this.socket.setTimeout(0)
    return this.socket
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '')
      this.buffer = this.buffer.slice(idx + 1)
      this.pending.push(line)
      // « 250-… » = suite, « 250 … » = dernière ligne
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: this.pending }
        this.pending = []
        if (this.waiter) {
          const w = this.waiter
          this.waiter = null
          w.resolve(reply)
        } else {
          this.queue.push(reply)
        }
      }
    }
  }

  private fail(err: Error): void {
    if (this.failure) return
    this.failure = err
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w.reject(err)
    }
  }

  read(): Promise<Reply> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    if (this.failure) return Promise.reject(this.failure)
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject }
    })
  }

  async expect(codes: number[], what: string): Promise<Reply> {
    const reply = await this.read()
    if (!codes.includes(reply.code)) {
      // Ne jamais inclure d'identifiants dans l'erreur : seulement la réponse serveur.
      throw new Error(`SMTP ${what} failed (${reply.code}): ${reply.lines.join(' ').slice(0, 200)}`)
    }
    return reply
  }

  async command(line: string, codes: number[], what: string): Promise<Reply> {
    this.socket.write(line + '\r\n')
    return this.expect(codes, what)
  }

  write(data: string): void {
    this.socket.write(data)
  }

  close(): void {
    this.failure = this.failure || new Error('SMTP: closed')
    this.socket.end()
  }
}

function connectTls(opts: tls.ConnectionOptions): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tls.connect(opts, () => resolve(s))
    s.once('error', reject)
    s.setTimeout(TIMEOUT_MS, () => {
      s.destroy()
      reject(new Error('SMTP: TLS connect timeout'))
    })
  })
}

function connectPlain(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port }, () => resolve(s))
    s.once('error', reject)
    s.setTimeout(TIMEOUT_MS, () => {
      s.destroy()
      reject(new Error('SMTP: connect timeout'))
    })
  })
}

function ehloName(): string {
  try {
    const url = process.env.NEXT_PUBLIC_APP_URL
    if (url) return new URL(url).hostname
  } catch {
    /* ignore */
  }
  return 'localhost'
}

export async function sendSmtp(config: SmtpConfig, msg: SmtpMessage): Promise<string | null> {
  assertAddress('from', msg.fromAddress)
  assertAddress('to', msg.to)
  if (msg.replyTo) assertAddress('reply-to', msg.replyTo)
  assertNoCrlf('subject', msg.subject)
  assertNoCrlf('from name', msg.fromName)

  const tlsBase: tls.ConnectionOptions = {
    host: config.host,
    servername: config.host,
    port: config.port,
    minVersion: 'TLSv1.2',
    ...config.tlsOptions,
  }

  let session: SmtpSession
  if (config.secure) {
    const sock = await connectTls(tlsBase)
    session = new SmtpSession(sock)
  } else {
    const sock = await connectPlain(config.host, config.port)
    session = new SmtpSession(sock)
  }

  try {
    await session.expect([220], 'greeting')
    let ehlo = await session.command(`EHLO ${ehloName()}`, [250], 'EHLO')

    if (!config.secure) {
      const hasStartTls = ehlo.lines.some((l) => /STARTTLS/i.test(l))
      if (!hasStartTls) throw new Error('SMTP: server does not offer STARTTLS')
      await session.command('STARTTLS', [220], 'STARTTLS')
      const raw = session.detach()
      const secured = await connectTls({ ...tlsBase, socket: raw })
      session = new SmtpSession(secured)
      ehlo = await session.command(`EHLO ${ehloName()}`, [250], 'EHLO')
    }

    const authLine = ehlo.lines.find((l) => /AUTH/i.test(l)) || ''
    if (/PLAIN/i.test(authLine) || !/LOGIN/i.test(authLine)) {
      const token = Buffer.from(`\u0000${config.user}\u0000${config.pass}`, 'utf8').toString('base64')
      await session.command(`AUTH PLAIN ${token}`, [235], 'AUTH')
    } else {
      await session.command('AUTH LOGIN', [334], 'AUTH')
      await session.command(Buffer.from(config.user).toString('base64'), [334], 'AUTH')
      await session.command(Buffer.from(config.pass).toString('base64'), [235], 'AUTH')
    }

    await session.command(`MAIL FROM:<${msg.fromAddress}>`, [250], 'MAIL FROM')
    await session.command(`RCPT TO:<${msg.to}>`, [250, 251], 'RCPT TO')
    await session.command('DATA', [354], 'DATA')
    session.write(buildMimeMessage(msg) + '.\r\n')
    const done = await session.expect([250], 'message')
    session.write('QUIT\r\n')
    const idMatch = done.lines.join(' ').match(/(?:queued as|id[=: ]+)\s*([\w.-]+)/i)
    return idMatch ? idMatch[1] : null
  } finally {
    session.close()
  }
}
