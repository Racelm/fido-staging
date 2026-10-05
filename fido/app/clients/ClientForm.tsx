'use client'

import { useActionState, useState } from 'react'
import { createClientRecord } from '@/app/actions/clients'

type Invitation = {
  inviteUrl: string
  emailSent: boolean
  emailVia?: 'emergent' | 'supabase' | 'none'
  emailError?: string
}

type State = {
  error: string
  success: boolean
  invitation?: Invitation
}
const initialState: State = { error: '', success: false }

export default function ClientForm() {
  const [copied, setCopied] = useState(false)
  const [state, action, pending] = useActionState(
    async (_state: State, formData: FormData) => {
      const result = await createClientRecord(formData)
      if (result.success) {
        setCopied(false)
        return {
          error: '',
          success: true,
          invitation: result.invitation,
        }
      }
      return { error: result.error || 'Une erreur est survenue.', success: false }
    },
    initialState
  )

  async function copyLink() {
    if (!state.invitation?.inviteUrl) return
    try {
      await navigator.clipboard.writeText(state.invitation.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* clipboard refused */
    }
  }

  return (
    <form action={action} className="client-form" data-testid="client-form">
      <input
        className="search auth-input"
        name="company_name"
        placeholder="Nom de l’entreprise *"
        required
        data-testid="client-company"
      />
      <input
        className="search auth-input"
        name="contact_name"
        placeholder="Nom du contact"
        data-testid="client-contact"
      />
      <input
        className="search auth-input"
        name="email"
        type="email"
        placeholder="E-mail du contact (recommandé)"
        data-testid="client-email"
      />
      <input
        className="search auth-input"
        name="phone"
        placeholder="Téléphone (+212...)"
        data-testid="client-phone"
      />

      <div className="grid-2">
        <input className="search auth-input" name="ice" placeholder="ICE" data-testid="client-ice" />
        <input
          className="search auth-input"
          name="if_number"
          placeholder="IF (identifiant fiscal)"
          data-testid="client-if"
        />
      </div>
      <div className="grid-2">
        <input
          className="search auth-input"
          name="rc_number"
          placeholder="Registre de commerce"
          data-testid="client-rc"
        />
        <input
          className="search auth-input"
          name="cnss_number"
          placeholder="N° CNSS"
          data-testid="client-cnss"
        />
      </div>
      <div className="grid-2">
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Période TVA</span>
          <select
            className="search"
            name="tva_period"
            defaultValue=""
            data-testid="client-tva"
          >
            <option value="">— non défini —</option>
            <option value="mensuel">Mensuelle</option>
            <option value="trimestriel">Trimestrielle</option>
            <option value="exonere">Exonéré</option>
          </select>
        </label>
        <label className="upload-label" style={{ margin: 0 }}>
          <span className="muted">Début d’exercice</span>
          <input
            className="search"
            name="fiscal_year_start"
            type="date"
            data-testid="client-fiscal-start"
          />
        </label>
      </div>

      {state.error && <p className="auth-error" data-testid="client-error">{state.error}</p>}

      {state.success && (
        <div
          className="auth-notice"
          data-testid="client-success"
          style={{ display: 'grid', gap: 10 }}
        >
          <strong>✅ Client créé.</strong>
          {state.invitation ? (
            state.invitation.emailSent ? (
              <span>
                Un e-mail d’invitation vient d’être envoyé
                {state.invitation.emailVia === 'supabase'
                  ? ' (via Supabase).'
                  : ' (via Resend).'}{' '}
                Le client reçoit un lien d’activation.
              </span>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <span>
                  L’envoi d’e-mail n’est pas configuré sur cette instance. Partagez le lien
                  d’invitation ci-dessous avec votre client&nbsp;:
                </span>
                <input
                  className="search auth-input"
                  readOnly
                  value={state.invitation.inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="client-invite-url"
                  style={{ fontSize: 12 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={copyLink}
                  data-testid="client-invite-copy"
                >
                  {copied ? '✓ Lien copié' : 'Copier le lien d’invitation'}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  Lien valable 7 jours. Vous pouvez le régénérer à tout moment depuis la fiche
                  client.
                </span>
              </div>
            )
          ) : (
            <span>Ajoutez une adresse e-mail pour générer un lien d’invitation.</span>
          )}
        </div>
      )}

      <button
        className="primary auth-submit"
        disabled={pending}
        data-testid="client-submit"
      >
        {pending ? 'Ajout en cours...' : 'Ajouter le client'}
      </button>
    </form>
  )
}
