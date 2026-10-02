/**
 * Envoi d'e-mails transactionnels via le proxy Emergent (Resend managé).
 *
 * Garde-fous (portés depuis le playbook Emergent RESEND) — NE JAMAIS retirer :
 *   G1: `from_name` ne peut être qu'une marque interne (Fido / le cabinet).
 *   G2: pas de <form>/<input> ; jamais demander mot de passe/code/CVV/etc.
 *   G3: tout href/src doit être en HTTPS absolu, pas d'IP, pas de raccourcisseur.
 *   G4: pas d'open relay — l'appelant fournit un ID, jamais l'HTML ni le destinataire.
 *   G5: pas d'envoi de masse / marketing.
 *
 * Ce module s'utilise UNIQUEMENT côté serveur (server actions, routes API).
 */

const EMAIL_BASE_URL = 'https://integrations.emergentagent.com'
const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'is.gd',
  'cutt.ly',
  'goo.gl',
  'rebrand.ly',
])

// Formulations qui « demandent des identifiants au destinataire » — tripwire, non exhaustive.
const CRED_ASK_PATTERNS = [
  'reply with your password',
  'reply with the code',
  'send your password',
  'cvv',
  'send us your password',
  'enter your password below',
  'confirm your card number',
  'your full card number',
  'seed phrase',
  'recovery phrase',
  'verify your card',
  'social security number',
  'confirm your bank details',
  'répondez avec votre mot de passe',
  'confirmez votre carte',
  'votre numéro de carte',
  'code de sécurité',
]

function isIpLiteral(host: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  // IPv6 (brute, entouré ou non de [])
  if (/^\[?[0-9a-fA-F:]+\]?$/.test(host) && host.includes(':')) return true
  return false
}

function hostOk(host: string): boolean {
  if (!host || host.includes('xn--')) return false
  if (isIpLiteral(host)) return false
  for (const s of SHORTENERS) {
    if (host === s || host.endsWith('.' + s)) return false
  }
  return true
}

function sameSite(shown: string, real: string): boolean {
  return shown === real || real.endsWith('.' + shown) || shown.endsWith('.' + real)
}

function extractHrefSrc(html: string): Array<{ tag: string; attr: string; value: string }> {
  const out: Array<{ tag: string; attr: string; value: string }> = []
  const re = /<\s*(a|img|link|script|iframe|source)\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase()
    const attrs = m[0]
    for (const attrName of ['href', 'src']) {
      const attrRe = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
      const am = attrRe.exec(attrs)
      if (am) {
        const val = am[1] ?? am[2] ?? am[3] ?? ''
        out.push({ tag, attr: attrName, value: val })
      }
    }
  }
  return out
}

function extractAnchors(html: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = []
  const re = /<\s*a\b([^>]*)>([\s\S]*?)<\s*\/\s*a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = m[1]
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&#46;/g, '.')
    const hrefRe = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    const hm = hrefRe.exec(attrs)
    if (hm) {
      const href = hm[1] ?? hm[2] ?? hm[3] ?? ''
      out.push({ href, text })
    }
  }
  return out
}

function assertSafeEmail(subject: string, html: string): void {
  // G2: pas de formulaire ni champ d'entrée
  if (/<\s*(form|input|textarea|select)\b/i.test(html)) {
    throw new Error('Email guardrail G2: no forms or input fields allowed')
  }
  const body = (subject + '\n' + html).toLowerCase()
  for (const p of CRED_ASK_PATTERNS) {
    if (body.includes(p)) {
      throw new Error(`Email guardrail G2: credential-ask phrasing detected (${p})`)
    }
  }

  // G3: hygiène des URLs
  for (const { value } of extractHrefSrc(html)) {
    const low = value.trim().toLowerCase()
    if (
      low.startsWith('mailto:') ||
      low.startsWith('tel:') ||
      low.startsWith('cid:') ||
      low.startsWith('#')
    ) {
      continue
    }
    if (!low.startsWith('https://')) {
      throw new Error(`Email guardrail G3: non-https link/asset: ${value}`)
    }
    let parsed: URL
    try {
      parsed = new URL(low)
    } catch {
      throw new Error(`Email guardrail G3: invalid URL: ${value}`)
    }
    if (parsed.username) {
      throw new Error(`Email guardrail G3: credential-in-URL: ${value}`)
    }
    if (!hostOk(parsed.hostname)) {
      throw new Error(`Email guardrail G3: forbidden host: ${value}`)
    }
  }

  // G3 bis: texte d'ancre ≠ vraie destination
  const hostRe = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})/gi
  for (const { href, text } of extractAnchors(html)) {
    let real: string
    try {
      real = new URL(href.trim().toLowerCase()).hostname
    } catch {
      continue
    }
    if (!real) continue
    let m: RegExpExecArray | null
    while ((m = hostRe.exec(text))) {
      const shown = m[1].toLowerCase()
      if (!sameSite(shown, real)) {
        throw new Error(`Email guardrail G3: anchor text ${shown} ≠ real host ${real}`)
      }
    }
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  replyTo?: string
}

/**
 * Envoie un e-mail transactionnel. Retourne l'ID Resend/proxy, ou lève une erreur.
 *
 * Utilisation : `await sendEmail({ to, subject, html })`. Le `html` DOIT provenir
 * d'un template server-side ; ne jamais passer d'HTML fourni par le client (G4).
 */
export async function sendEmail(input: SendEmailInput): Promise<string | null> {
  const apiKey = process.env.EMERGENT_EMAIL_KEY
  const fromName = process.env.EMAIL_FROM_NAME
  if (!apiKey || !fromName) {
    throw new Error('EMERGENT_EMAIL_KEY / EMAIL_FROM_NAME not configured')
  }
  assertSafeEmail(input.subject, input.html)

  const payload: Record<string, unknown> = {
    to: [input.to],
    subject: input.subject,
    html: input.html,
    from_name: fromName, // G1 : marque de l'app uniquement
  }
  const replyTo = input.replyTo || process.env.EMAIL_REPLY_TO
  if (replyTo) payload.contact_email = replyTo

  const res = await fetch(`${EMAIL_BASE_URL}/api/v1/email/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Email-Key': apiKey,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Email send failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string }
  return data.id || null
}

/* -------------------------------------------------------------------------- */
/*                              Templates internes                             */
/* -------------------------------------------------------------------------- */

function baseLayout(bodyHtml: string, appName: string, footerNote: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111">
  <tr><td>
    <table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:28px;max-width:560px;margin:0 auto">
      <tr><td style="padding-bottom:16px;font-weight:700;font-size:20px;color:#0f172a">${escapeHtml(appName)}<span style="color:#2563eb">.</span></td></tr>
      <tr><td style="font-size:15px;line-height:1.55;color:#1e293b">${bodyHtml}</td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;margin-top:16px">${escapeHtml(footerNote)}</td></tr>
    </table>
  </td></tr>
</table>`
}

export function inviteEmailTemplate(params: {
  cabinetName: string
  clientCompany: string
  inviteUrl: string // MUST be https on your own domain
  appName: string
}): { subject: string; html: string } {
  const subject = `Invitation à rejoindre l’espace ${params.cabinetName} sur ${params.appName}`
  const body = `
    <p>Bonjour,</p>
    <p>Le cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous invite à rejoindre l’espace de collaboration Fido pour <strong>${escapeHtml(params.clientCompany)}</strong>.</p>
    <p>Cliquez sur le bouton ci-dessous pour créer votre accès sécurisé (lien valable 7 jours) :</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${params.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Créer mon accès</a>
    </p>
    <p style="font-size:13px;color:#64748b">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br /><a href="${params.inviteUrl}">${params.inviteUrl}</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Cet e-mail a été envoyé par ${params.appName}. Nous ne vous demanderons jamais votre mot de passe par e-mail.`
    ),
  }
}

export function documentReceivedTemplate(params: {
  clientCompany: string
  documentName: string
  appUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Nouveau document reçu — ${params.clientCompany}`
  const body = `
    <p>Bonjour,</p>
    <p>Votre client <strong>${escapeHtml(params.clientCompany)}</strong> vient de téléverser un document : <strong>${escapeHtml(params.documentName)}</strong>.</p>
    <p><a href="${params.appUrl}">Consulter dans Fido</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Notification envoyée par ${params.appName}.`
    ),
  }
}

export function newMessageTemplate(params: {
  clientCompany: string
  messagePreview: string
  appUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Nouveau message — ${params.clientCompany}`
  const body = `
    <p>Bonjour,</p>
    <p><strong>${escapeHtml(params.clientCompany)}</strong> vient de vous envoyer un message dans Fido :</p>
    <blockquote style="border-left:3px solid #2563eb;padding:6px 12px;color:#334155;margin:12px 0">${escapeHtml(params.messagePreview)}</blockquote>
    <p><a href="${params.appUrl}">Répondre dans Fido</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Notification envoyée par ${params.appName}.`
    ),
  }
}

const OBLIGATION_LABEL_FR: Record<string, string> = {
  tva_mensuel: 'Déclaration TVA mensuelle',
  tva_trimestriel: 'Déclaration TVA trimestrielle',
  is_acompte: 'Acompte IS',
  is_solde: 'Solde IS annuel',
  ir_professionnel: 'Déclaration IR professionnelle',
  cnss_mensuel: 'Déclaration CNSS mensuelle',
  taxe_professionnelle: 'Taxe professionnelle',
}

export function deadlineReminderTemplate(params: {
  recipientName: string
  clientCompany: string
  cabinetName: string
  obligation: string
  periodLabel: string
  dueDate: string // YYYY-MM-DD
  appUrl: string
  appName: string
  audience: 'client' | 'staff'
}): { subject: string; html: string } {
  const label = OBLIGATION_LABEL_FR[params.obligation] || params.obligation
  const formattedDate = new Date(params.dueDate + 'T00:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const subject =
    params.audience === 'client'
      ? `Rappel — ${label} à préparer avant le ${formattedDate}`
      : `Rappel J-7 : ${params.clientCompany} — ${label}`

  const bodyClient = `
    <p>Bonjour ${escapeHtml(params.recipientName)},</p>
    <p>Votre cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous rappelle que la <strong>${escapeHtml(label)}</strong> (${escapeHtml(params.periodLabel)}) est à préparer avant le <strong>${escapeHtml(formattedDate)}</strong>.</p>
    <p>Pensez à téléverser les documents nécessaires dans votre espace :</p>
    <p style="text-align:center;margin:20px 0">
      <a href="${params.appUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Ouvrir mon espace ${escapeHtml(params.appName)}</a>
    </p>
    <p style="font-size:13px;color:#64748b">Ce rappel est envoyé automatiquement 7 jours avant la date limite.</p>
  `
  const bodyStaff = `
    <p>Bonjour,</p>
    <p>Rappel automatique J-7 : le client <strong>${escapeHtml(params.clientCompany)}</strong> a l'échéance <strong>${escapeHtml(label)}</strong> (${escapeHtml(params.periodLabel)}) fixée au <strong>${escapeHtml(formattedDate)}</strong>.</p>
    <p><a href="${params.appUrl}">Consulter l'échéance dans Fido</a></p>
  `
  return {
    subject,
    html: baseLayout(
      params.audience === 'client' ? bodyClient : bodyStaff,
      params.appName,
      `Ce rappel a été généré automatiquement par ${params.appName} pour ${escapeHtml(params.cabinetName)}.`
    ),
  }
}


export function staffInviteTemplate(params: {
  inviteeName: string
  cabinetName: string
  inviteUrl: string
  appName: string
}): { subject: string; html: string } {
  const subject = `Rejoindre ${params.cabinetName} sur ${params.appName}`
  const body = `
    <p>Bonjour ${escapeHtml(params.inviteeName)},</p>
    <p>Le cabinet <strong>${escapeHtml(params.cabinetName)}</strong> vous invite à rejoindre son espace de collaboration ${escapeHtml(params.appName)} en tant que <strong>collaborateur</strong>.</p>
    <p>Vous aurez accès aux dossiers clients, demandes documentaires, documents et messagerie du cabinet.</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${params.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#6c5ce7;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Activer mon compte</a>
    </p>
    <p style="font-size:13px;color:#64748b">Lien valable 7 jours. Si le bouton ne fonctionne pas, copiez ce lien :<br /><a href="${params.inviteUrl}">${params.inviteUrl}</a></p>
  `
  return {
    subject,
    html: baseLayout(
      body,
      params.appName,
      `Invitation envoyée par ${params.appName} pour le compte de ${escapeHtml(params.cabinetName)}. Nous ne vous demanderons jamais de mot de passe par e-mail.`
    ),
  }
}

